import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    EmbedBuilder,
    TextChannel,
} from 'discord.js';
import { config, disciplines, Fiche, fiches, Piste, rules, saveFiches } from './data';
import { SUPER_MJ_ID } from './types';
import { normalize } from './util';

const SHEET_COLOR = 0x8B0000;

export const ATTRIBUTS: Record<string, string[]> = {
    Physique: ['Force', 'Dextérité', 'Vigueur'],
    Social: ['Charisme', 'Manipulation', 'Sang-froid'],
    Mental: ['Intelligence', 'Astuce', 'Résolution'],
};

// Mêmes noms et même ordre que les fiches de règles
export const COMPETENCES: Record<string, string[]> = {
    Physiques: Object.keys(rules['Compétences physiques']),
    Sociales: Object.keys(rules['Compétences sociales']),
    Mentales: Object.keys(rules['Compétences mentales']),
};

const attributNames = Object.values(ATTRIBUTS).flat();
const competenceNames = Object.values(COMPETENCES).flat();
const disciplineNames = Object.keys(disciplines);

/** Valeurs de la fiche qui ne sont ni des attributs, ni des compétences, ni des Disciplines. */
const SCALARS = {
    'Soif': 'soif',
    'Humanité': 'humanite',
    'Taches': 'taches',
    'Puissance du sang': 'puissance',
    'Génération': 'generation',
} as const;

export type TraitKind = 'attribut' | 'competence' | 'discipline' | 'scalaire';
export interface Trait { name: string; kind: TraitKind }

export const TRAITS: Trait[] = [
    ...attributNames.map(name => ({ name, kind: 'attribut' as const })),
    ...competenceNames.map(name => ({ name, kind: 'competence' as const })),
    ...disciplineNames.map(name => ({ name, kind: 'discipline' as const })),
    ...Object.keys(SCALARS).map(name => ({ name, kind: 'scalaire' as const })),
];

const traitKey = (s: string) => normalize(s).replace(/[-'’]/g, ' ').replace(/\s+/g, ' ');

/** Retrouve un trait sans tenir compte de la casse, des accents ni des tirets (« volonte », « sang froid »). */
export const findTrait = (name: string): Trait | undefined =>
    TRAITS.find(t => traitKey(t.name) === traitKey(name));

export const getTrait = (f: Fiche, t: Trait): number => {
    if (t.kind === 'attribut') return f.attributs[t.name] ?? 1;
    if (t.kind === 'competence') return f.competences[t.name] ?? 0;
    if (t.kind === 'discipline') return f.disciplines[t.name] ?? 0;
    return f[SCALARS[t.name as keyof typeof SCALARS]];
};

export const setTrait = (f: Fiche, t: Trait, value: number) => {
    if (t.kind === 'attribut') f.attributs[t.name] = value;
    else if (t.kind === 'competence') f.competences[t.name] = value;
    else if (t.kind === 'discipline') {
        if (value > 0) f.disciplines[t.name] = value;
        else delete f.disciplines[t.name];
    } else f[SCALARS[t.name as keyof typeof SCALARS]] = value;
};

/** Bornes de chaque trait, pour refuser une saisie absurde. */
export const traitRange = (t: Trait): [number, number] => {
    if (t.kind === 'attribut') return [1, 5];
    if (t.name === 'Génération') return [4, 16];
    if (t.name === 'Humanité') return [0, 10];
    if (t.name === 'Taches') return [0, 10];
    return [0, 5];
};

export const newFiche = (nom: string, clan: string): Fiche => ({
    nom,
    clan,
    generation: 13,
    puissance: 1,
    humanite: 7,
    taches: 0,
    soif: 1,
    attributs: Object.fromEntries(attributNames.map(a => [a, 1])),
    competences: {},
    disciplines: {},
    sante: { superficiel: 0, aggrave: 0 },
    volonte: { superficiel: 0, aggrave: 0 },
});

// Santé = Vigueur + 3, plus la Force d'âme (Résilience) ; Volonté = Sang-froid + Résolution
export const maxSante = (f: Fiche) => (f.attributs['Vigueur'] ?? 1) + 3 + (f.disciplines["Force d'âme"] ?? 0);
export const maxVolonte = (f: Fiche) => (f.attributs['Sang-froid'] ?? 1) + (f.attributs['Résolution'] ?? 1);

export type PisteName = 'sante' | 'volonte';
export type DamageType = 'superficiel' | 'aggrave';

const maxOf = (f: Fiche, piste: PisteName) => (piste === 'sante' ? maxSante(f) : maxVolonte(f));

/**
 * Inflige des dégâts selon les règles V5 : une case vide se remplit ; quand la piste est pleine,
 * un dégât (même superficiel) transforme une case superficielle en aggravée.
 */
export const damage = (f: Fiche, piste: PisteName, type: DamageType, amount: number) => {
    const p = f[piste];
    const max = maxOf(f, piste);
    for (let i = 0; i < amount; i++) {
        if (p.superficiel + p.aggrave < max) p[type]++;
        else if (p.superficiel > 0) { p.superficiel--; p.aggrave++; }
    }
    p.aggrave = Math.min(p.aggrave, max);
};

export const heal = (f: Fiche, piste: PisteName, type: DamageType, amount: number) => {
    f[piste][type] = Math.max(0, f[piste][type] - amount);
};

/** La piste est pleine : −2 dés aux jets concernés (physiques pour la Santé, sociaux et mentaux pour la Volonté). */
export const isImpaired = (f: Fiche, piste: PisteName) =>
    f[piste].superficiel + f[piste].aggrave >= maxOf(f, piste);

export const dots = (value: number, max = 5) => '●'.repeat(Math.min(value, max)) + '○'.repeat(Math.max(0, max - value));

const boxes = (p: Piste, max: number) => {
    const agg = Math.min(p.aggrave, max);
    const sup = Math.min(p.superficiel, max - agg);
    return '🟥'.repeat(agg) + '🟧'.repeat(sup) + '⬛'.repeat(max - agg - sup);
};

const pisteLine = (f: Fiche, piste: PisteName) => {
    const max = maxOf(f, piste);
    const p = f[piste];
    let state = '';
    if (piste === 'sante' && p.aggrave >= max) state = ' · 💀 **Torpeur ou mort**';
    else if (isImpaired(f, piste)) state = ' · ⚠️ **Affaibli** (−2 dés)';
    return `${boxes(p, max)}${state}`;
};

const traitLines = (names: string[], value: (n: string) => number) =>
    names.map(n => `${n} ${value(n) > 0 ? dots(value(n)) : '—'}`).join('\n');

export const buildSheetEmbed = (userId: string, f: Fiche) => {
    const hunger = '🩸'.repeat(f.soif) + '○'.repeat(5 - f.soif);
    const disc = Object.entries(f.disciplines)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([n, v]) => `**${n}** ${dots(v)}`)
        .join('\n');
    return new EmbedBuilder()
        .setTitle(`🧛 ${f.nom}`)
        .setColor(SHEET_COLOR)
        .setDescription([
            `**${f.clan}** · ${f.generation}e génération · Puissance du sang ${f.puissance} · <@${userId}>`,
            '',
            `**Soif** ${hunger}${f.soif >= 5 ? ' · la Bête réclame du sang' : ''}`,
            `**Humanité** ${'■'.repeat(f.humanite)}${'□'.repeat(10 - f.humanite)}${f.taches ? ` · ${f.taches} Tache${f.taches > 1 ? 's' : ''}` : ''}`,
            `**Santé** ${pisteLine(f, 'sante')}`,
            `**Volonté** ${pisteLine(f, 'volonte')}`,
        ].join('\n'))
        .addFields(
            ...Object.entries(ATTRIBUTS).map(([cat, names]) => ({
                name: cat,
                value: traitLines(names, n => f.attributs[n] ?? 1),
                inline: true,
            })),
            ...Object.entries(COMPETENCES).map(([cat, names]) => ({
                name: `Compétences ${cat.toLowerCase()}`,
                value: traitLines(names, n => f.competences[n] ?? 0),
                inline: true,
            })),
            { name: 'Disciplines', value: disc || '*Aucune*' },
        )
        .setFooter({ text: '🟥 aggravé · 🟧 superficiel · /jet pour lancer · /fiche modifier pour changer une valeur' });
};

export const sheetButtons = (userId: string) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`exaltation:roll:${userId}`)
            .setLabel("Test d'Exaltation")
            .setEmoji('🩸')
            .setStyle(ButtonStyle.Danger),
    );

export const sheetMessage = (userId: string, f: Fiche) => ({
    embeds: [buildSheetEmbed(userId, f)],
    components: [sheetButtons(userId)],
});

/** Les MJ ont accès à toutes les fiches. */
const mjIds = () => [...new Set([SUPER_MJ_ID, ...config.mj_ids])];

/** Crée le fil privé du joueur dans `channel`, y ajoute le joueur et les MJ, et y poste la fiche. */
export const createSheetThread = async (channel: TextChannel, userId: string, f: Fiche) => {
    const thread = await channel.threads.create({
        name: `📜 ${f.nom}`,
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: `Fiche de ${f.nom}`,
    });
    for (const id of [userId, ...mjIds()]) {
        await thread.members.add(id).catch(error => console.error(`⚠️ Impossible d'ajouter ${id} au fil :`, error));
    }
    const message = await thread.send(sheetMessage(userId, f));
    await message.pin().catch(() => {});
    f.fil = { threadId: thread.id, messageId: message.id };
    saveFiches();
    return thread;
};

const threadOf = async (client: Client, f: Fiche) => {
    if (!f.fil) return undefined;
    const thread = await client.channels.fetch(f.fil.threadId).catch(() => null);
    return thread?.isThread() ? thread : undefined;
};

/** Met à jour le message de la fiche dans son fil. Sans fil, rien à faire. */
export const refreshSheet = async (client: Client, userId: string) => {
    const f = fiches[userId];
    const thread = f && await threadOf(client, f);
    if (!thread || !f.fil) return;
    try {
        if (thread.archived) await thread.setArchived(false);
        const message = await thread.messages.fetch(f.fil.messageId);
        await message.edit(sheetMessage(userId, f));
    } catch (error) {
        console.error(`⚠️ Fiche de ${f.nom} non mise à jour :`, error);
    }
};

/** Garde une trace des changements dans le fil, pour que le joueur et le MJ voient l'historique. */
export const logToSheet = async (client: Client, userId: string, text: string) => {
    const f = fiches[userId];
    const thread = f && await threadOf(client, f);
    await thread?.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
};

export const sheetLink = (f: Fiche) => (f.fil ? `<#${f.fil.threadId}>` : '');
