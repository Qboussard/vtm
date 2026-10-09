import * as fs from 'fs';
import * as path from 'path';

// Données livrées avec le code (règles, mémos) et valeurs initiales des données de campagne.
// Depuis src/ (ts-node) comme depuis dist/ (build), ce chemin pointe sur src/data.
const BUNDLED_DIR = path.join(__dirname, '..', 'src', 'data');

// Données de campagne modifiées par le bot. En production, pointer DATA_DIR vers un volume persistant.
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : BUNDLED_DIR;

export interface Pnj {
    clan: string;
    faction: string;
    rang: string;
    statut: string;
    description: string;
    description_mj: string;
    /** Partie de la page Notion lisible par les joueurs (hors sections 🔒) */
    description_joueurs?: string;
    image: string;
    relations: string[];
    /** Ce que les joueurs voient. Absent : déduit de l'ancien champ `connu`. */
    visibilite?: Visibilite;
    /** @deprecated remplacé par `visibilite` */
    connu?: boolean;
    /** Champs renseignés par la synchronisation Notion */
    notion_id?: string;
    edited?: string;
    /** Pages Notion mentionnées dans les notes MJ */
    mentions?: string[];
    /** Fichier du portrait téléchargé dans DATA_DIR/portraits */
    portrait?: string;
}

export type Visibilite = 'cache' | 'photo' | 'complet';

export const visibilityOf = (p: Pnj): Visibilite => p.visibilite ?? (p.connu === false ? 'cache' : 'complet');

export interface Session {
    numero: number;
    titre: string;
    date: string;
    /** Ce que les joueurs lisent : la page Notion hors sections 🔒 */
    resume: string;
    /** Les sections 🔒 de la page */
    notes_mj: string;
    /** Champs renseignés par la synchronisation Notion */
    notion_id?: string;
    edited?: string;
}

export interface Memo {
    titre: string;
    contenu: string;
}

export type Rules = Record<string, Record<string, string | Record<string, string>>>;

export interface Pouvoir {
    niveau: number;
    nom: string;
    /** Nom anglais du livre de base */
    vo: string;
    cout: string;
    jet: string;
    contre: string;
    description: string;
    /** Amalgame : autre Discipline requise */
    prerequis?: string;
}

export interface Discipline {
    vo: string;
    type: string;
    description: string;
    pouvoirs: Pouvoir[];
}

export interface Clan {
    vo: string;
    /** Disciplines de clan, par leur nom dans disciplines.json */
    disciplines: string[];
    /** Clans sans Disciplines de clan (Caitiff, Sang-clair) */
    note?: string;
}

const readBundled = <T>(file: string): T =>
    JSON.parse(fs.readFileSync(path.join(BUNDLED_DIR, file), 'utf-8'));

const readMutable = <T>(file: string): T => {
    const target = path.join(DATA_DIR, file);
    if (!fs.existsSync(target)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.copyFileSync(path.join(BUNDLED_DIR, file), target);
        console.log(`📁 ${file} initialisé dans ${DATA_DIR}`);
    }
    return JSON.parse(fs.readFileSync(target, 'utf-8'));
};

// Écriture atomique : un crash en cours d'écriture ne corrompt pas le fichier.
const write = (file: string, value: unknown) => {
    const target = path.join(DATA_DIR, file);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
    fs.renameSync(tmp, target);
};

export const rules = readBundled<Rules>('rules.json');
export const memos = readBundled<Memo[]>('memo.json');
export const disciplines = readBundled<Record<string, Discipline>>('disciplines.json');
export const clans = readBundled<Record<string, Clan>>('clans.json');

export const pnjs = readMutable<Record<string, Pnj>>('pnj.json');
export const sessions = readMutable<Session[]>('sessions.json');
export const config = readMutable<{ mj_ids: string[] }>('config.json');

export const savePnjs = () => write('pnj.json', pnjs);
export const saveSessions = () => write('sessions.json', sessions);
export const saveConfig = () => write('config.json', config);

/** Remplace les séances en gardant la même référence (importée par les commandes). */
export const replaceSessions = (next: Session[]) => {
    sessions.splice(0, sessions.length, ...next);
    saveSessions();
};

/** Remplace le contenu de `pnjs` en gardant la même référence (importée par les commandes). */
export const replacePnjs = (next: Record<string, Pnj>) => {
    for (const key of Object.keys(pnjs)) delete pnjs[key];
    Object.assign(pnjs, next);
    savePnjs();
};

console.log(`✅ Données chargées (campagne : ${DATA_DIR})`);
