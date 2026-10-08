import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, Pnj, pnjs, replacePnjs, replaceSessions, Session, sessions, Visibilite } from './data';

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

const VISIBILITY_LABELS: Record<Visibilite, string> = { cache: 'Caché', photo: 'Photo seule', complet: 'Complet' };

/** Colonne « Visibilité » ; à défaut l'ancienne case « Connu ». Vide = caché, par prudence. */
const readVisibility = (props: Json): Visibilite => {
    const label = props['Visibilité']?.select?.name;
    const found = (Object.keys(VISIBILITY_LABELS) as Visibilite[]).find(v => VISIBILITY_LABELS[v] === label);
    if (found) return found;
    return props.Connu?.checkbox ? 'complet' : 'cache';
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
    /** Notes réservées au MJ : les sections 🔒, ou toute la page si elle n'en a aucune. */
    notes: string;
    /** Ce que les joueurs peuvent lire : la page hors sections 🔒 (vide si la page n'en a aucune). */
    joueurs: string;
    image?: { url: string; hosted: boolean };
    mentions: string[];
}

const HEADING_LEVEL: Record<string, number> = { heading_1: 1, heading_2: 2, heading_3: 3 };

/**
 * Convertit le contenu d'une page en texte Discord, et repère la première image et les pages mentionnées.
 * Un bloc qui commence par 🔒 est réservé au MJ : un titre jusqu'au prochain titre de même niveau ou plus haut,
 * un bloc dépliable avec son contenu, sinon le bloc seul.
 */
const readContent = async (pageId: string): Promise<PageContent> => {
    const content: PageContent = { notes: '', joueurs: '', mentions: [] };
    const lines: { text: string; secret: boolean }[] = [];
    let split = false;
    let secretLevel: number | null = null;

    const walk = async (blockId: string, depth: number, inSecret: boolean) => {
        for (const block of await listChildren(blockId)) {
            const value = block[block.type] ?? {};
            const level = HEADING_LEVEL[block.type];
            const locked = /^\s*🔒/u.test(plain(value.rich_text));
            if (level && secretLevel !== null && level <= secretLevel) secretLevel = null;
            if (level && locked && secretLevel === null) secretLevel = level;
            if (locked) split = true;
            const secret = inSecret || secretLevel !== null || locked;
            const push = (text: string) => lines.push({ text, secret });
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
                    push(`${indent}**${text}**`);
                    break;
                case 'bulleted_list_item':
                case 'numbered_list_item':
                    push(`${indent}• ${text}`);
                    break;
                case 'to_do':
                    push(`${indent}${value.checked ? '☑' : '☐'} ${text}`);
                    break;
                case 'toggle':
                    push(`${indent}▸ ${text}`);
                    break;
                case 'quote':
                    push(`${indent}> ${text}`);
                    break;
                case 'divider':
                    push('───');
                    break;
                default:
                    if (text) push(`${indent}${text}`);
            }
            // Le contenu des titres dépliables n'ajoute pas d'indentation
            const childDepth = block.type.startsWith('heading') ? depth : depth + 1;
            if (block.has_children && depth < 3) await walk(block.id, childDepth, inSecret || (locked && !level));
        }
    };

    await walk(pageId, 0, false);
    const text = (xs: typeof lines) => xs.map(l => l.text).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    content.notes = text(split ? lines.filter(l => l.secret) : lines);
    content.joueurs = split ? text(lines.filter(l => !l.secret)) : '';
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
            description_joueurs: old?.description_joueurs ?? '',
            image: old?.image ?? '',
            relations: [],
            visibilite: readVisibility(props),
            notion_id: page.id,
            edited: page.last_edited_time,
            portrait: old?.portrait,
        };

        // Le contenu de la page n'est relu que s'il a changé depuis la dernière synchronisation
        const portraitMissing = pnj.portrait && !fs.existsSync(portraitPath(pnj.portrait));
        // (description_joueurs absent : copie d'avant le découpage joueurs / MJ, à relire une fois)
        if (!old || old.edited !== page.last_edited_time || portraitMissing || old.description_joueurs === undefined) {
            try {
                const content = await readContent(page.id);
                pnj.description_mj = content.notes;
                pnj.description_joueurs = content.joueurs;
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

// Séances : base Notion « Séances (Vampire) », remplie depuis le Bilan du Codex (« Clore la séance »).
// Son id vient de NOTION_SESSIONS_DATABASE_ID, sinon d'une recherche par titre (même intégration Notion).
const SESSIONS_TITLE = 'Séances (Vampire)';
let sessionsDb: string | undefined = process.env.NOTION_SESSIONS_DATABASE_ID;

const findSessionsDb = async (): Promise<string | undefined> => {
    if (sessionsDb) return sessionsDb;
    const found = await request('POST', '/search', { query: SESSIONS_TITLE, filter: { property: 'object', value: 'database' } });
    sessionsDb = found.results.find((d: Json) => plain(d.title) === SESSIONS_TITLE)?.id;
    return sessionsDb;
};

const frDate = (iso?: string) => iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

/** Relit les séances ; le contenu d'une page n'est relu que s'il a changé. Sans base trouvée, garde la copie locale. */
const runSessionsSync = async (): Promise<number | null> => {
    const db = await findSessionsDb();
    if (!db) return null;
    const pages: Json[] = [];
    let cursor: string | undefined;
    do {
        const data = await request('POST', `/databases/${db}/query`, { sorts: [{ property: 'Numéro', direction: 'ascending' }], start_cursor: cursor, page_size: 100 });
        pages.push(...data.results);
        cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    const previous = new Map(sessions.filter(s => s.notion_id).map(s => [s.notion_id!, s]));
    const next: Session[] = [];
    for (const page of pages) {
        const props = page.properties;
        const old = previous.get(page.id);
        const s: Session = {
            numero: props['Numéro']?.number ?? next.length + 1,
            titre: plain(props['Séance']?.title),
            date: frDate(props['Date']?.date?.start ?? page.created_time),
            resume: old?.resume ?? '',
            notes_mj: old?.notes_mj ?? '',
            notion_id: page.id,
            edited: page.last_edited_time,
        };
        if (!old || old.edited !== page.last_edited_time) {
            const content = await readContent(page.id);
            s.resume = content.joueurs;
            s.notes_mj = content.notes;
        }
        next.push(s);
    }
    replaceSessions(next);
    return next.length;
};

/** Lance une synchronisation (une seule à la fois). */
export const syncPnjs = (): Promise<SyncResult> => {
    running ??= runSync().finally(() => { running = null; });
    return running;
};

let sessionsRunning: Promise<number | null> | null = null;

/** Synchronise les séances (une seule à la fois). */
export const syncSessions = (): Promise<number | null> => {
    sessionsRunning ??= runSessionsSync().finally(() => { sessionsRunning = null; });
    return sessionsRunning;
};

/** Met à jour la colonne « Visibilité » quand un PNJ est montré à la table. */
export const setVisibilityInNotion = async (pageId: string, visibility: Visibilite) => {
    if (!notionEnabled) return;
    await request('PATCH', `/pages/${pageId}`, { properties: { 'Visibilité': { select: { name: VISIBILITY_LABELS[visibility] } } } });
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
        try {
            const n = await syncSessions();
            console.log(n === null ? `ℹ️ Base « ${SESSIONS_TITLE} » introuvable : séances lues depuis sessions.json.` : `🔄 Notion : ${n} séance(s)`);
        } catch (error) {
            console.error('❌ Synchronisation des séances impossible, on garde la copie locale :', error);
        }
    };
    void tick();
    setInterval(tick, Math.max(1, minutes) * 60_000);
};
