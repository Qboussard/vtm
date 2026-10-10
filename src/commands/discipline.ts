import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';
import { clans, disciplines, fiches, Pouvoir } from '../data';
import { performRoll, poolFromFormula } from './jet';
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
const clanNames = Object.keys(clans);

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

/** Ligne courte, quand la liste complète dépasse les limites d'un embed. */
const shortLine = (e: PouvoirEntry) => `${dots(e.niveau)} **${e.nom}** — ${e.cout}`;

const buildClanEmbed = (clan: string, niveau: number | null) => {
    const c = clans[clan];
    const embed = new EmbedBuilder()
        .setTitle(`🧛 ${clan}${niveau ? ` · niveau ${niveau}` : ''}`)
        .setColor(DISCIPLINE_COLOR)
        .setDescription(c.note ?? `*${c.vo}* · Disciplines de clan : **${c.disciplines.join(', ')}**`)
        .setFooter({ text: '🎲 jet · 🛡️ jet contre' });
    if (c.disciplines.length === 0) return embed;

    const groups = c.disciplines.map(name => ({ name, list: filter(name, niveau) }));
    const full = groups.map(g => g.list.map(e => line(e, false)).join('\n\n'));
    // Un embed : 1024 caractères par champ, 6000 en tout
    const fits = full.every(v => v.length <= LIMITS.embedField) && full.join('').length <= 5000;
    return embed.addFields(groups.map((g, i) => ({
        name: `${g.name} · ${disciplines[g.name].type}`,
        value: truncate((fits ? full[i] : g.list.map(shortLine).join('\n')) || '*Aucun pouvoir à ce niveau.*', LIMITS.embedField),
    })));
};

const clanPowers = (clan: string, niveau: number | null) =>
    clans[clan].disciplines.flatMap(name => filter(name, niveau));

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
                '\n\nAstuce : `/discipline pouvoir:` ouvre directement un pouvoir, `clan:` liste les Disciplines d\'un clan, `niveau:` filtre par niveau.',
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

const clanView = (clan: string, niveau: number | null) => ({
    embeds: [buildClanEmbed(clan, niveau)],
    components: [
        ...pickMenus(clanPowers(clan, niveau)),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            shareButton(`discipline:shareclan:${clan}:${niveau ?? ''}`),
            ...clans[clan].disciplines.map(name =>
                new ButtonBuilder()
                    .setCustomId(`discipline:list:${name}`)
                    .setLabel(name)
                    .setEmoji('📜')
                    .setStyle(ButtonStyle.Secondary)),
            homeButton(),
        ),
    ],
});

const pouvoirView = (e: PouvoirEntry) => ({
    embeds: [buildEmbed(e)],
    components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...(e.jet !== NONE ? [new ButtonBuilder()
                .setCustomId(`discipline:roll:${e.id}`)
                .setLabel('Lancer')
                .setEmoji('🎲')
                .setStyle(ButtonStyle.Primary)] : []),
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
        .addStringOption(o =>
            o.setName('clan')
                .setDescription('Lister les Disciplines de clan : Ventru, Brujah…')
                .addChoices(...clanNames.slice(0, LIMITS.choices).map(n => ({ name: n, value: n }))))
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
        const clan = interaction.options.getString('clan');
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

        // Une Discipline précise l'emporte sur le clan
        if (clan && !name && clans[clan]) {
            return isPublic
                ? interaction.reply({ embeds: [buildClanEmbed(clan, niveau)] })
                : interaction.reply({ ...clanView(clan, niveau), flags: EPHEMERAL });
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
        if (action === 'roll') {
            const e = entries[Number(arg)];
            const f = fiches[interaction.user.id];
            if (!e) return interaction.reply({ content: '❌ Pouvoir introuvable.', flags: EPHEMERAL });
            if (!f) return interaction.reply({ content: '❌ Aucune fiche liée à votre compte : `/fiche creer`.', flags: EPHEMERAL });
            const pool = poolFromFormula(f, e.jet);
            if (!pool) return interaction.reply({ content: `❌ Jet non calculable automatiquement (« ${e.jet} ») : utilisez \`/jet\`.`, flags: EPHEMERAL });
            return performRoll(interaction, {
                pool: pool.pool,
                hunger: f.soif,
                difficulty: null,
                detail: pool.detail,
                reason: `${e.nom} (${e.discipline} ${e.niveau})${e.contre !== NONE ? ` · contre ${e.contre}` : ''}${/exaltation/i.test(e.cout) ? ` · coût : ${e.cout}, /exaltation` : ''}`,
            });
        }
        if (action === 'share') {
            const e = entries[Number(arg)];
            if (!e) return interaction.reply({ content: '❌ Pouvoir introuvable.', flags: EPHEMERAL });
            return interaction.reply({ content: `📣 Partagé par **${interaction.user.displayName}**`, embeds: [buildEmbed(e)] });
        }
        if (action === 'shareclan') {
            const [clan, niveau] = arg.split(':');
            if (!clans[clan]) return interaction.reply({ content: '❌ Clan introuvable.', flags: EPHEMERAL });
            return interaction.reply({
                content: `📣 Partagé par **${interaction.user.displayName}**`,
                embeds: [buildClanEmbed(clan, Number(niveau) || null)],
            });
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
