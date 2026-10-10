import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';

export const EPHEMERAL = MessageFlags.Ephemeral;
/** Message sans son ni notification push (comme @silent) */
export const SILENT = MessageFlags.SuppressNotifications;

// Limites imposées par Discord
export const LIMITS = {
    choices: 25,
    message: 2000,
    embedDescription: 4096,
    embedField: 1024,
    customId: 100,
    label: 80,
    choiceName: 100,
};

/** Minuscules, sans accents ni underscores : pour comparer « volonte » et « Volonté ». */
export const normalize = (s: string): string =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/_/g, ' ').toLowerCase().trim();

export const matches = (value: string, query: string): boolean =>
    normalize(value).includes(normalize(query));

export const truncate = (s: string, max: number): string =>
    s.length <= max ? s : s.slice(0, max - 1) + '…';

/** Regroupe des lignes en blocs qui tiennent dans un message Discord. */
export const chunkLines = (lines: string[], max = LIMITS.message): string[] => {
    const chunks: string[] = [];
    let current = '';
    for (const raw of lines) {
        const line = truncate(raw, max);
        if (current && current.length + line.length + 1 > max) {
            chunks.push(current);
            current = '';
        }
        current = current ? `${current}\n${line}` : line;
    }
    if (current) chunks.push(current);
    return chunks;
};

export const isUrl = (s: string): boolean => /^https?:\/\/\S+$/i.test(s);

export const shareButton = (customId: string) =>
    new ButtonBuilder()
        .setCustomId(customId)
        .setLabel('Montrer à la table')
        .setEmoji('📣')
        .setStyle(ButtonStyle.Secondary);

/** Range des boutons par lignes de 5, dans la limite de `maxRows` lignes. */
export const buttonRows = (buttons: ButtonBuilder[], maxRows = 5): ActionRowBuilder<ButtonBuilder>[] => {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < buttons.length && rows.length < maxRows; i += 5) {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
    }
    return rows;
};
