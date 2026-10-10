import {
    ActionRowBuilder,
    AutocompleteInteraction,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageComponentInteraction,
    SlashCommandBuilder,
} from 'discord.js';
import { Fiche, fiches, Pouvoir, saveFiches } from '../data';
import { decodeDice, encodeDice, evaluate, formatDice, d10, Roll, roll, rerollable, willpowerReroll } from '../dice';
import { damage, findTrait, getTrait, logToSheet, refreshSheet, TRAITS } from '../sheet';
import { Command } from '../types';
import { EPHEMERAL, LIMITS, normalize, SILENT, truncate } from '../util';

const ROLL_COLOR = 0x8B0000;

type Replyable = ChatInputCommandInteraction | MessageComponentInteraction;

export interface RollRequest {
    pool: number;
    hunger: number;
    difficulty: number | null;
    /** Ce qui est lancé : « Manipulation 3 + Persuasion 2 » */
    detail: string;
    reason?: string;
}

const rollEmbed = (userId: string, r: Roll, detail: string, reason: string | undefined, rerolled: boolean) => {
    const o = evaluate(r);
    const f = fiches[userId];
    return new EmbedBuilder()
        .setTitle(`${o.emoji} ${o.label}`)
        .setColor(ROLL_COLOR)
        .setAuthor({ name: f ? f.nom : 'Jet' })
        .setDescription([
            ...(reason ? [`*${reason}*`] : []),
            `**${detail}**${r.difficulty !== null ? ` · difficulté ${r.difficulty}` : ''}`,
            '',
            formatDice(r),
            ...(rerolled ? ['', '🔁 *Relance de Volonté (1 dégât superficiel de Volonté)*'] : []),
        ].join('\n'))
        .setFooter({ text: `${o.successes} réussite${o.successes > 1 ? 's' : ''} · gras = réussite · 💀 = 1 sur un dé de Soif` });
};

// Le bouton de relance transporte tout le jet : jet:wp:<joueur>:<difficulté>:<dés normaux>:<dés de Soif>
const rerollButton = (userId: string, r: Roll) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`jet:wp:${userId}:${r.difficulty ?? 'x'}:${encodeDice(r.normal)}:${encodeDice(r.hunger)}`)
            .setLabel('Relancer 3 dés (Volonté)')
            .setEmoji('🔁')
            .setStyle(ButtonStyle.Secondary),
    );

/** Lance les dés et répond publiquement, avec le bouton de relance de Volonté s'il sert à quelque chose. */
export const performRoll = async (interaction: Replyable, req: RollRequest) => {
    const r = roll(req.pool, req.hunger, req.difficulty);
    const userId = interaction.user.id;
    // Le customId est limité à 100 caractères : au-delà de ~40 dés, pas de bouton
    const canReroll = rerollable(r) && r.normal.length + r.hunger.length <= 40;
    const message = {
        embeds: [rollEmbed(userId, r, req.detail, req.reason, false)],
        components: canReroll ? [rerollButton(userId, r)] : [],
    };
    // Lancé depuis le fil privé de la fiche : le jet part dans le salon de jeu, pour toute la table
    const channel = interaction.channel;
    if (channel?.isThread() && channel.parent?.isTextBased()) {
        const sent = await channel.parent.send(message);
        return interaction.reply({ content: `🎲 Jet envoyé dans le salon : ${sent.url}`, flags: EPHEMERAL });
    }
    return interaction.reply(message);
};

/** Lance un pouvoir de Discipline avec la fiche du joueur : réserve tirée de son jet, Soif de la fiche. */
export const rollPower = async (interaction: Replyable, discipline: string, p: Pouvoir) => {
    const f = fiches[interaction.user.id];
    if (!f) return interaction.reply({ content: '❌ Aucune fiche liée à votre compte : `/fiche nom: clan:`.', flags: EPHEMERAL });
    const pool = poolFromFormula(f, p.jet);
    if (!pool) return interaction.reply({ content: `❌ Jet non calculable automatiquement (« ${p.jet} ») : utilisez \`/jet\`.`, flags: EPHEMERAL });
    return performRoll(interaction, {
        pool: pool.pool,
        hunger: f.soif,
        difficulty: null,
        detail: pool.detail,
        reason: `${p.nom} (${discipline} ${p.niveau})${p.contre !== '—' ? ` · contre ${p.contre}` : ''}${/exaltation/i.test(p.cout) ? ` · coût : ${p.cout}, /exaltation` : ''}`,
    });
};

/** Réserve tirée d'une formule de règle : « Manipulation ou Charisme + Animalisme » → meilleure option de chaque terme. */
export const poolFromFormula = (f: Fiche, formula: string): { pool: number; detail: string } | undefined => {
    // On garde le premier jet décrit, sans les précisions entre parenthèses
    const main = formula.split(' · ')[0].replace(/\([^)]*\)/g, '');
    const parts = main.split('+').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return undefined;
    let pool = 0;
    const detail: string[] = [];
    for (const part of parts) {
        const options = part.split(/\s+ou\s+/).map(o => findTrait(o.trim())).filter(t => t !== undefined);
        if (options.length === 0) return undefined;
        const best = options.reduce((a, b) => (getTrait(f, b) > getTrait(f, a) ? b : a));
        pool += getTrait(f, best);
        detail.push(`${best.name} ${getTrait(f, best)}`);
    }
    return { pool, detail: detail.join(' + ') };
};

const autocompleteTrait = async (interaction: AutocompleteInteraction, kinds: string[]) => {
    const q = normalize(interaction.options.getFocused());
    const f = fiches[interaction.user.id];
    await interaction.respond(
        TRAITS.filter(t => kinds.includes(t.kind) && normalize(t.name).includes(q))
            .slice(0, LIMITS.choices)
            .map(t => ({ name: f ? `${t.name} (${getTrait(f, t)})` : t.name, value: t.name })),
    );
};

export const jet: Command = {
    data: new SlashCommandBuilder()
        .setName('jet')
        .setDescription('Lancer les dés (V5) : réserve calculée depuis votre fiche, dés de Soif inclus')
        .addStringOption(o =>
            o.setName('attribut').setDescription('Force, Manipulation, Astuce…').setAutocomplete(true))
        .addStringOption(o =>
            o.setName('competence').setDescription('Compétence ou Discipline : Bagarre, Persuasion, Domination…').setAutocomplete(true))
        .addIntegerOption(o =>
            o.setName('reserve').setDescription('Nombre de dés fixe (ajouté à l\'attribut et à la compétence s\'il y en a)').setMinValue(0).setMaxValue(30))
        .addIntegerOption(o =>
            o.setName('bonus').setDescription('Dés en plus ou en moins (−2 pour un malus)').setMinValue(-10).setMaxValue(10))
        .addIntegerOption(o =>
            o.setName('difficulte').setDescription('Réussites à obtenir (sans : le résultat brut)').setMinValue(0).setMaxValue(15))
        .addIntegerOption(o =>
            o.setName('soif').setDescription('Forcer la Soif (par défaut : celle de votre fiche)').setMinValue(0).setMaxValue(5))
        .addStringOption(o =>
            o.setName('raison').setDescription('Ce que tente le personnage').setMaxLength(200)),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true).name;
        return autocompleteTrait(interaction, focused === 'attribut' ? ['attribut'] : ['competence', 'discipline']);
    },

    async execute(interaction) {
        const f = fiches[interaction.user.id];
        const attrName = interaction.options.getString('attribut');
        const skillName = interaction.options.getString('competence');
        const reserve = interaction.options.getInteger('reserve');
        const bonus = interaction.options.getInteger('bonus') ?? 0;

        if (!attrName && !skillName && reserve === null) {
            return interaction.reply({ content: '❌ Indiquez un attribut (et une compétence), ou une `reserve` de dés.', flags: EPHEMERAL });
        }
        if ((attrName || skillName) && !f) {
            return interaction.reply({ content: '❌ Aucune fiche liée à votre compte : `/fiche nom: clan:`, ou lancez avec `reserve:`.', flags: EPHEMERAL });
        }

        let pool = reserve ?? 0;
        const detail: string[] = reserve !== null ? [`${reserve} dés`] : [];
        for (const name of [attrName, skillName]) {
            if (!name) continue;
            const t = findTrait(name);
            if (!t) return interaction.reply({ content: `❌ « ${name} » n'existe pas sur une fiche.`, flags: EPHEMERAL });
            const value = getTrait(f, t);
            pool += value;
            detail.push(`${t.name} ${value}`);
        }
        if (bonus) {
            pool += bonus;
            detail.push(`${bonus > 0 ? '+' : '−'}${Math.abs(bonus)}`);
        }

        return performRoll(interaction, {
            pool,
            hunger: interaction.options.getInteger('soif') ?? f?.soif ?? 0,
            difficulty: interaction.options.getInteger('difficulte'),
            detail: detail.join(' + ').replace(/\+ ([+−])/g, '$1'),
            reason: interaction.options.getString('raison') ?? undefined,
        });
    },

    async component(interaction, action, arg) {
        if (action !== 'wp') return;
        const [userId, diff, normal, hunger] = arg.split(':');
        if (interaction.user.id !== userId) {
            return interaction.reply({ content: '❌ Seul le joueur qui a lancé peut dépenser sa Volonté.', flags: EPHEMERAL });
        }
        const before: Roll = { normal: decodeDice(normal), hunger: decodeDice(hunger), difficulty: diff === 'x' ? null : Number(diff) };
        const after = willpowerReroll(before);

        const f = fiches[userId];
        if (f) {
            damage(f, 'volonte', 'superficiel', 1);
            saveFiches();
        }
        // Le détail et la raison sont relus dans l'embed d'origine
        const old = interaction.message.embeds[0]?.description?.split('\n') ?? [];
        const reason = old[0]?.startsWith('*') ? old[0].replace(/^\*|\*$/g, '') : undefined;
        const detailLine = old.find(l => l.startsWith('**')) ?? '';
        const detail = detailLine.replace(/^\*\*(.*?)\*\*.*$/, '$1');
        await interaction.update({ embeds: [rollEmbed(userId, after, detail, reason, true)], components: [] });
        if (f) {
            await refreshSheet(interaction.client, userId);
            await logToSheet(interaction.client, userId, `🔁 Relance de Volonté : 1 dégât superficiel de Volonté.`);
        }
    },
};

/** Tests d'Exaltation : chaque dé sous 6 fait monter la Soif de 1. */
export const rouse = async (interaction: Replyable, userId: string, count: number, reason?: string) => {
    const f = fiches[userId];
    if (!f) {
        return interaction.reply({ content: '❌ Aucune fiche liée à ce compte : `/fiche nom: clan:`.', flags: EPHEMERAL });
    }
    const lines: string[] = [];
    const start = f.soif;
    for (let i = 0; i < count; i++) {
        if (f.soif >= 5) {
            lines.push('🐺 **Soif 5** : impossible, la Bête réclame du sang (risque de frénésie de faim).');
            break;
        }
        const v = d10();
        if (v >= 6) lines.push(`🎲 **${v}** : rien ne se passe.`);
        else {
            f.soif++;
            lines.push(`🎲 ${v} : la Soif monte à **${f.soif}**.`);
        }
    }
    saveFiches();
    const embed = new EmbedBuilder()
        .setTitle(f.soif > start ? `🩸 Soif ${start} → ${f.soif}` : `🩸 Soif inchangée (${f.soif})`)
        .setColor(ROLL_COLOR)
        .setAuthor({ name: f.nom })
        .setDescription(truncate([reason ? `*${reason}*\n` : '', ...lines].join('\n'), LIMITS.embedDescription));
    // Souvent lancé depuis le fil de la fiche : pas de son pour ça
    await interaction.reply({ embeds: [embed], flags: SILENT });
    await refreshSheet(interaction.client, userId);
};

export const exaltation: Command = {
    data: new SlashCommandBuilder()
        .setName('exaltation')
        .setDescription("Test d'Exaltation : 1 dé, de 1 à 5 la Soif monte (mise à jour de votre fiche)")
        .addIntegerOption(o =>
            o.setName('nombre').setDescription('Plusieurs tests à la suite (2 pour certains pouvoirs)').setMinValue(1).setMaxValue(5))
        .addStringOption(o =>
            o.setName('raison').setDescription('Pouvoir activé, réveil, guérison…').setMaxLength(200)),

    async execute(interaction) {
        return rouse(interaction, interaction.user.id, interaction.options.getInteger('nombre') ?? 1, interaction.options.getString('raison') ?? undefined);
    },

    async component(interaction, action, arg) {
        if (action !== 'roll') return;
        // Bouton de la fiche : seul son joueur l'utilise
        if (interaction.user.id !== arg) {
            return interaction.reply({ content: "❌ C'est la fiche d'un autre joueur.", flags: EPHEMERAL });
        }
        return rouse(interaction, arg, 1);
    },
};
