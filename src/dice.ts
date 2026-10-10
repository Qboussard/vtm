// Jets de Vampire V5 : d10, réussite sur 6+, chaque paire de 10 vaut 4 réussites,
// les dés de Soif remplacent des dés normaux et peuvent rendre le résultat messianique ou bestial.

export interface Roll {
    normal: number[];
    hunger: number[];
    /** Difficulté connue : le résultat est alors tranché (réussite, échec, bestial…) */
    difficulty: number | null;
}

export const d10 = () => Math.floor(Math.random() * 10) + 1;

export const roll = (pool: number, hunger: number, difficulty: number | null): Roll => {
    const size = Math.max(1, pool);
    const hungerCount = Math.min(Math.max(0, hunger), size);
    return {
        normal: Array.from({ length: size - hungerCount }, d10),
        hunger: Array.from({ length: hungerCount }, d10),
        difficulty,
    };
};

export interface Outcome {
    successes: number;
    critical: boolean;
    messy: boolean;
    /** Au moins un 1 sur un dé de Soif : un échec devient bestial */
    bestialRisk: boolean;
    label: string;
    emoji: string;
}

export const evaluate = (r: Roll): Outcome => {
    const all = [...r.normal, ...r.hunger];
    const tens = all.filter(v => v === 10).length;
    const pairs = Math.floor(tens / 2);
    const successes = all.filter(v => v >= 6).length + pairs * 2;
    const critical = pairs > 0;
    const messy = critical && r.hunger.includes(10);
    const bestialRisk = r.hunger.includes(1);

    if (r.difficulty === null) {
        const parts = [`${successes} réussite${successes > 1 ? 's' : ''}`];
        if (messy) parts.push('critique **messianique** si le jet réussit');
        else if (critical) parts.push('critique si le jet réussit');
        if (bestialRisk) parts.push('**bestial** si le jet échoue');
        if (successes === 0) return { successes, critical, messy, bestialRisk, label: bestialRisk ? 'Échec bestial' : 'Échec total', emoji: bestialRisk ? '🐺' : '💥' };
        return { successes, critical, messy, bestialRisk, label: parts.join(' · '), emoji: messy ? '🩸' : critical ? '✨' : '🎲' };
    }

    const margin = successes - r.difficulty;
    if (margin >= 0) {
        const marge = `marge ${margin}`;
        if (messy) return { successes, critical, messy, bestialRisk, label: `Réussite messianique (${marge})`, emoji: '🩸' };
        if (critical) return { successes, critical, messy, bestialRisk, label: `Réussite critique (${marge})`, emoji: '✨' };
        return { successes, critical, messy, bestialRisk, label: `Réussite (${marge})`, emoji: '✅' };
    }
    if (bestialRisk) return { successes, critical, messy, bestialRisk, label: 'Échec bestial', emoji: '🐺' };
    if (successes === 0) return { successes, critical, messy, bestialRisk, label: 'Échec total', emoji: '💥' };
    return { successes, critical, messy, bestialRisk, label: `Échec (il manquait ${-margin})`, emoji: '❌' };
};

const face = (v: number) => (v >= 6 ? `**${v}**` : `${v}`);

export const formatDice = (r: Roll) => {
    const parts = [];
    if (r.normal.length) parts.push(`🎲 ${r.normal.map(face).join(' ')}`);
    if (r.hunger.length) parts.push(`🩸 ${r.hunger.map(v => (v === 1 ? '💀' : face(v))).join(' ')}`);
    return parts.join('  ·  ');
};

/** Relance de Volonté : jusqu'à 3 dés normaux en échec. Les dés de Soif ne se relancent jamais. */
export const rerollable = (r: Roll) => r.normal.filter(v => v < 6).length > 0;

export const willpowerReroll = (r: Roll): Roll => {
    let left = 3;
    return {
        ...r,
        normal: r.normal.map(v => (v < 6 && left-- > 0 ? d10() : v)),
    };
};

// Les dés voyagent dans le customId du bouton de relance : un caractère par dé (0 = 10).
export const encodeDice = (dice: number[]) => dice.map(v => String(v % 10)).join('') || '-';
export const decodeDice = (s: string) => (s === '-' ? [] : [...s].map(c => Number(c) || 10));
