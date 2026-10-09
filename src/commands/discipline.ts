import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';
import { disciplines, Pouvoir } from '../data';
import { Command } from '../types';
import { EPHEMERAL, LIMITS, normalize, shareButton, truncate } from '../util';

const DISCIPLINE_COLOR = 0x8B0000;
const NONE = '—';

interface PouvoirEntry extends Pouvoir {
    id: number;
    discipline: string;
    norm: string;
}

// Index à plat de tous les pouvoirs, pour la recherche et l'autocomplétion.
const entries: PouvoirEntry[] = [];
for (const [discipline, d] of Object.entries(disciplines)) {
    for (const pouvoir of d.pouvoirs) {
        entries.push({
            ...pouvoir,
            id: entries.length,
            discipline,
            norm: normalize(`${pouvoir.nom} ${pouvoir.vo} ${discipline}`),
        });
    }
}
const names = Object.keys(disciplines);

const dots = (niveau: number) => '●'.repeat(niveau);

const search = (query: string): PouvoirEntry[] => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return entries.filter(e => words.every(w => e.norm.includes(w)));
};

const filter = (discipline: string | null, niveau: number | null) =>
    entries.filter(e => (!discipline || e.discipline === discipline) && (!niveau || e.niveau === niveau));

const buildEmbed = (e: PouvoirEntry) => {
    const d = disciplines[e.discipline];
    return new EmbedBuilder()
        .setTitle(`🧛 ${e.nom}`)
        .setColor(DISCIPLINE_COLOR)
        .setDescription(`*${e.vo}*\n\n${truncate(e.description, LIMITS.embedDescription - 200)}`)
        .addFields(
            { name: 'Catégorie', value: e.discipline, inline: true },
            { name: 'Niveau', value: `${dots(e.niveau)} (${e.niveau})`, inline: true },
            { name: 'Coût', value: e.cout, inline: true },
            { name: 'Jet', value: e.jet, inline: true },
            { name: 'Jet contre', value: e.contre, inline: true },
            ...(e.prerequis ? [{ name: 'Amalgame', value: e.prerequis, inline: true }] : []),
        )
        .setFooter({ text: `${e.discipline} (${d.vo}) · Discipline ${d.type.toLowerCase()}` });
};

/** Une ligne de liste : nom, coût, puis jet et jet contre quand il y en a. */
const line = (e: PouvoirEntry, withDiscipline: boolean) => {
    const rolls = [
        e.jet !== NONE ? `🎲 ${e.jet}` : '',
        e.contre !== NONE ? `🛡️ ${e.contre}` : '',
    ].filter(Boolean).join(' · ');
    const where = withDiscipline ? ` · *${e.discipline}*` : '';
    return `${dots(e.niveau)} **${e.nom}**${where} — ${e.cout}${rolls ? `\n${rolls}` : ''}`;
};

const listTitle = (discipline: string | null, niveau: number | null) =>
    [discipline ?? 'Disciplines', niveau ? `niveau ${niveau}` : ''].filter(Boolean).join(' · ');

const buildListEmbed = (discipline: string | null, niveau: number | null) => {
    const list = filter(discipline, niveau);
    const intro = discipline ? `*${disciplines[discipline].vo}* · ${disciplines[discipline].type}\n${disciplines[discipline].description}\n\n` : '';
    return new EmbedBuilder()
        .setTitle(`🧛 ${listTitle(discipline, niveau)}`)
        .setColor(DISCIPLINE_COLOR)
        .setDescription(truncate(intro + list.map(e => line(e, !discipline)).join('\n\n'), LIMITS.embedDescription))
        .setFooter({ text: '🎲 jet · 🛡️ jet contre' });
};

const homeButton = () =>
    new ButtonBuilder().setCustomId('discipline:home').setLabel('Toutes les Disciplines').setEmoji('🧛').setStyle(ButtonStyle.Secondary);

/** Menus pour ouvrir un pouvoir, par tranches de 25 (limite Discord) : deux menus au plus. */
const pickMenus = (list: PouvoirEntry[]) => {
    const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
    for (let i = 0; i < list.length && rows.length < 2; i += LIMITS.choices) {
        const slice = list.slice(i, i + LIMITS.choices);
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                // Le customId doit être unique dans le message : la tranche passe en argument
                .setCustomId(`discipline:pick:${i}`)
                .setPlaceholder(list.length > LIMITS.choices
                    ? `Voir un pouvoir (${slice[0].nom} → ${slice[slice.length - 1].nom})`
                    : 'Voir un pouvoir')
                .addOptions(slice.map(e => ({
                    label: truncate(`${e.nom} (${e.niveau})`, 100),
                    description: truncate(`${e.discipline} · ${e.cout}`, 100),
                    value: String(e.id),
                }))),
        ));
    }
    return rows;
};

const disciplineMenu = () =>
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('discipline:list')
            .setPlaceholder('Choisir une Discipline')
            .addOptions(names.slice(0, LIMITS.choices).map(n => ({
                label: n,
                description: `${disciplines[n].type} · ${disciplines[n].pouvoirs.length} pouvoirs`,
                value: n,
            }))),
    );

const summaryView = () => ({
    embeds: [
        new EmbedBuilder()
            .setTitle('🧛 Disciplines')
            .setColor(DISCIPLINE_COLOR)
            .setDescription(
                names.map(n => `**${n}** · ${disciplines[n].type} · ${disciplines[n].pouvoirs.length} pouvoirs`).join('\n') +
                '\n\nAstuce : `/discipline pouvoir:` ouvre directement un pouvoir, `niveau:` filtre par niveau.',
            ),
    ],
    components: [disciplineMenu()],
});

const listView = (discipline: string | null, niveau: number | null) => ({
    embeds: [buildListEmbed(discipline, niveau)],
    components: [
        ...pickMenus(filter(discipline, niveau)),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            shareButton(`discipline:sharelist:${discipline ?? ''}:${niveau ?? ''}`),
            homeButton(),
        ),
    ],
});

const pouvoirView = (e: PouvoirEntry) => ({
    embeds: [buildEmbed(e)],
    components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            shareButton(`discipline:share:${e.id}`),
            new ButtonBuilder()
                .setCustomId(`discipline:list:${e.discipline}`)
                .setLabel(e.discipline)
                .setEmoji('📜')
                .setStyle(ButtonStyle.Secondary),
            homeButton(),
        ),
    ],
});

export const discipline: Command = {
    data: new SlashCommandBuilder()
        .setName('discipline')
        .setDescription('Pouvoirs des Disciplines : coût, jet, jet contre (sans argument : liste)')
        .addStringOption(o =>
            o.setName('pouvoir')
                .setDescription('Nom du pouvoir : Contraindre, Robustesse, Sonder l\'âme…')
                .setAutocomplete(true))
        .addStringOption(o =>
            o.setName('discipline')
                .setDescription('Lister les pouvoirs d\'une Discipline')
                .addChoices(...names.slice(0, LIMITS.choices).map(n => ({ name: n, value: n }))))
        .addIntegerOption(o =>
            o.setName('niveau').setDescription('Filtrer par niveau').setMinValue(1).setMaxValue(5))
        .addBooleanOption(o =>
            o.setName('public').setDescription('Afficher pour toute la table (privé par défaut)')),

    async autocomplete(interaction) {
        const value = interaction.options.getFocused();
        const list = value.trim() ? search(value) : entries;
        await interaction.respond(list.slice(0, LIMITS.choices).map(e => ({
            name: truncate(`${e.nom} · ${e.discipline} ${e.niveau}`, LIMITS.choiceName),
            value: String(e.id),
        })));
    },

    async execute(interaction) {
        const query = interaction.options.getString('pouvoir');
        const name = interaction.options.getString('discipline');
        const niveau = interaction.options.getInteger('niveau');
        const isPublic = interaction.options.getBoolean('public') ?? false;

        if (query) {
            // Une valeur choisie dans l'autocomplétion est l'id du pouvoir ; sinon c'est du texte libre.
            const direct = /^\d+$/.test(query) ? entries[Number(query)] : undefined;
            const results = direct ? [direct] : search(query);
            if (results.length === 0) {
                return interaction.reply({ content: `❌ Aucun pouvoir trouvé pour « ${query} ».`, flags: EPHEMERAL });
            }
            if (results.length > 1) {
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle(`🔍 « ${query} » : ${results.length} pouvoirs`)
                        .setColor(DISCIPLINE_COLOR)
                        .setDescription(truncate(results.map(e => line(e, true)).join('\n\n'), LIMITS.embedDescription))],
                    components: pickMenus(results),
                    flags: EPHEMERAL,
                });
            }
            return isPublic
                ? interaction.reply({ embeds: [buildEmbed(results[0])] })
                : interaction.reply({ ...pouvoirView(results[0]), flags: EPHEMERAL });
        }

        if (!name && !niveau) {
            return interaction.reply({ ...summaryView(), flags: EPHEMERAL });
        }
        return isPublic
            ? interaction.reply({ embeds: [buildListEmbed(name, niveau)] })
            : interaction.reply({ ...listView(name, niveau), flags: EPHEMERAL });
    },

    async component(interaction, action, arg) {
        if (action === 'home') {
            return interaction.update(summaryView());
        }
        if (action === 'list') {
            // Menu de Disciplines (valeur sélectionnée) ou bouton de retour (argument)
            const name = interaction.isStringSelectMenu() ? interaction.values[0] : arg;
            if (!disciplines[name]) return interaction.reply({ content: '❌ Discipline introuvable.', flags: EPHEMERAL });
            return interaction.update(listView(name, null));
        }
        if (action === 'pick' && interaction.isStringSelectMenu()) {
            const e = entries[Number(interaction.values[0])];
            if (!e) return interaction.reply({ content: '❌ Pouvoir introuvable.', flags: EPHEMERAL });
            return interaction.update(pouvoirView(e));
        }
        if (action === 'share') {
            const e = entries[Number(arg)];
            if (!e) return interaction.reply({ content: '❌ Pouvoir introuvable.', flags: EPHEMERAL });
            return interaction.reply({ content: `📣 Partagé par **${interaction.user.displayName}**`, embeds: [buildEmbed(e)] });
        }
        if (action === 'sharelist') {
            const [name, niveau] = arg.split(':');
            return interaction.reply({
                content: `📣 Partagé par **${interaction.user.displayName}**`,
                embeds: [buildListEmbed(disciplines[name] ? name : null, Number(niveau) || null)],
            });
        }
    },
};
