import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, Pnj, pnjs, replacePnjs } from './data';

// Synchronisation des PNJ depuis la base Notion « Personnages ».
// Notion est la source de vérité ; pnj.json n'est qu'une copie locale qui permet de démarrer hors ligne.

const API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const PORTRAITS_DIR = path.join(DATA_DIR, 'portraits');

const token = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;

export const notionEnabled = Boolean(token && databaseId);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const request = async (method: string, endpoint: string, body?: unknown, attempt = 0): Promise<Json> => {
    const res = await fetch(`${API}${endpoint}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    // Limite de débit Notion (~3 requêtes/s) : on attend et on réessaie
    if (res.status === 429 && attempt < 5) {
        await sleep(Number(res.headers.get('retry-after') ?? 1) * 1000);
        return request(method, endpoint, body, attempt + 1);
    }
    if (!res.ok) {
        throw new Error(`Notion ${method} ${endpoint} → ${res.status} ${await res.text()}`);
    }
    return res.json();
};

const plain = (richText: Json[] = []) => richText.map(t => t.plain_text).join('');

/** « 💀 **Cassandra Blackwood** » → « Cassandra Blackwood » */
const cleanName = (raw: string) => raw.replace(/\*/g, '').replace(/^[^\p{L}\p{N}]+/u, '').trim();

const queryPnjPages = async (): Promise<Json[]> => {
    const pages: Json[] = [];
    let cursor: string | undefined;
    do {
        const data = await request('POST', `/databases/${databaseId}/query`, {
            filter: { property: 'Type', select: { equals: 'PNJ' } },
            start_cursor: cursor,
            page_size: 100,
        });
        pages.push(...data.results);
        cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    return pages;
};

const listChildren = async (blockId: string): Promise<Json[]> => {
    const blocks: Json[] = [];
    let cursor: string | undefined;
    do {
        const query = `page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
        const data = await request('GET', `/blocks/${blockId}/children?${query}`);
        blocks.push(...data.results);
        cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    return blocks;
};

interface PageContent {
    notes: string;
    image?: { url: string; hosted: boolean };
    mentions: string[];
}

/** Convertit le contenu d'une page en texte Discord, et repère la première image et les pages mentionnées. */
const readContent = async (pageId: string): Promise<PageContent> => {
    const content: PageContent = { notes: '', mentions: [] };
    const lines: string[] = [];

    const walk = async (blockId: string, depth: number) => {
        for (const block of await listChildren(blockId)) {
            const value = block[block.type] ?? {};
            if (block.type === 'image') {
                const url = value.type === 'external' ? value.external?.url : value.file?.url;
                if (url) content.image ??= { url, hosted: value.type === 'file' };
                continue;
            }
            for (const t of value.rich_text ?? []) {
                if (t.type === 'mention' && t.mention?.type === 'page') content.mentions.push(t.mention.page.id);
            }
            const text = plain(value.rich_text);
            const indent = '  '.repeat(depth);
            switch (block.type) {
                case 'heading_1':
                case 'heading_2':
                case 'heading_3':
                    lines.push(`${indent}**${text}**`);
                    break;
                case 'bulleted_list_item':
                case 'numbered_list_item':
                    lines.push(`${indent}• ${text}`);
                    break;
                case 'to_do':
                    lines.push(`${indent}${value.checked ? '☑' : '☐'} ${text}`);
                    break;
                case 'toggle':
                    lines.push(`${indent}▸ ${text}`);
                    break;
                case 'quote':
                    lines.push(`${indent}> ${text}`);
                    break;
                case 'divider':
                    lines.push('───');
                    break;
                default:
                    if (text) lines.push(`${indent}${text}`);
            }
            // Le contenu des titres dépliables n'ajoute pas d'indentation
            const childDepth = block.type.startsWith('heading') ? depth : depth + 1;
            if (block.has_children && depth < 3) await walk(block.id, childDepth);
        }
    };

    await walk(pageId, 0);
    content.notes = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return content;
};

const extensionOf = (url: string) => {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.png';
};

/** Télécharge le portrait : les URL des fichiers Notion expirent au bout d'une heure. */
const downloadPortrait = async (pageId: string, url: string): Promise<string> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Portrait ${pageId} → ${res.status}`);
    fs.mkdirSync(PORTRAITS_DIR, { recursive: true });
    const file = `${pageId.replace(/-/g, '')}${extensionOf(url)}`;
    fs.writeFileSync(path.join(PORTRAITS_DIR, file), Buffer.from(await res.arrayBuffer()));
    return file;
};

export const portraitPath = (file: string) => path.join(PORTRAITS_DIR, file);

let running: Promise<SyncResult> | null = null;

export interface SyncResult {
    total: number;
    updated: number;
    errors: string[];
}

const runSync = async (): Promise<SyncResult> => {
    const pages = await queryPnjPages();
    const previous = new Map(Object.values(pnjs).filter(p => p.notion_id).map(p => [p.notion_id!, p]));
    const next: Record<string, Pnj> = {};
    const nameById = new Map<string, string>();
    const result: SyncResult = { total: pages.length, updated: 0, errors: [] };

    for (const page of pages) {
        const props = page.properties;
        const name = cleanName(plain(props.Nom?.title));
        if (!name) continue;
        nameById.set(page.id, name);

        const old = previous.get(page.id);
        const pnj: Pnj = {
            clan: props.Clan?.select?.name ?? '',
            faction: props.Affiliation?.select?.name ?? '',
            rang: plain(props.Rang?.rich_text),
            statut: props.Statut?.select?.name ?? 'Actif',
            description: plain(props['Description publique']?.rich_text),
            description_mj: old?.description_mj ?? '',
            image: old?.image ?? '',
            relations: [],
            connu: props.Connu?.checkbox ?? false,
            notion_id: page.id,
            edited: page.last_edited_time,
            portrait: old?.portrait,
        };

        // Le contenu de la page n'est relu que s'il a changé depuis la dernière synchronisation
        const portraitMissing = pnj.portrait && !fs.existsSync(portraitPath(pnj.portrait));
        if (!old || old.edited !== page.last_edited_time || portraitMissing) {
            try {
                const content = await readContent(page.id);
                pnj.description_mj = content.notes;
                pnj.mentions = content.mentions;
                pnj.portrait = undefined;
                pnj.image = '';
                if (content.image?.hosted) {
                    pnj.portrait = await downloadPortrait(page.id, content.image.url);
                } else if (content.image) {
                    pnj.image = content.image.url; // lien externe stable
                }
                result.updated++;
            } catch (error) {
                result.errors.push(`${name} : ${(error as Error).message}`);
            }
        } else {
            pnj.mentions = old.mentions ?? [];
        }
        next[name] = pnj;
    }

    // Les PNJ mentionnés dans les notes deviennent des liens (visibles seulement des MJ)
    for (const [name, pnj] of Object.entries(next)) {
        const linked = (pnj.mentions ?? []).map(id => nameById.get(id)).filter((n): n is string => Boolean(n) && n !== name);
        pnj.relations = [...new Set(linked)];
    }

    replacePnjs(next);
    return result;
};

/** Lance une synchronisation (une seule à la fois). */
export const syncPnjs = (): Promise<SyncResult> => {
    running ??= runSync().finally(() => { running = null; });
    return running;
};

/** Coche « Connu » dans Notion quand un PNJ est montré à la table. */
export const markKnownInNotion = async (pageId: string) => {
    if (!notionEnabled) return;
    await request('PATCH', `/pages/${pageId}`, { properties: { Connu: { checkbox: true } } });
};

export const startNotionSync = () => {
    if (!notionEnabled) {
        console.log('ℹ️ NOTION_TOKEN ou NOTION_DATABASE_ID absent : PNJ lus depuis pnj.json uniquement.');
        return;
    }
    const minutes = Number(process.env.NOTION_SYNC_MINUTES ?? 10);
    const tick = async () => {
        try {
            const r = await syncPnjs();
            console.log(`🔄 Notion : ${r.total} PNJ, ${r.updated} mis à jour${r.errors.length ? `, ${r.errors.length} erreur(s)` : ''}`);
            for (const e of r.errors) console.error(`   ⚠️ ${e}`);
        } catch (error) {
            console.error('❌ Synchronisation Notion impossible, on garde la copie locale :', error);
        }
    };
    void tick();
    setInterval(tick, Math.max(1, minutes) * 60_000);
};
