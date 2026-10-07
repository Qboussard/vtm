import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';
import { rules } from '../data';
import { Command } from '../types';
import { EPHEMERAL, LIMITS, normalize, shareButton, truncate } from '../util';

const RULE_COLOR = 0x8B0000;

interface RuleEntry {
    id: number;
    category: string;
    title: string;
    content: string;
    fields: [string, string][];
    normTitle: string;
    normCategory: string;
    normContent: string;
}

// Index à plat de toutes les règles et Disciplines, pour la recherche et l'autocomplétion.
const entries: RuleEntry[] = [];
for (const [category, items] of Object.entries(rules)) {
    for (const [title, value] of Object.entries(items)) {
        const content = typeof value === 'string' ? value : value['Description'] ?? '';
        const fields = typeof value === 'string'
            ? []
            : Object.entries(value).filter(([k]) => k !== 'Description') as [string, string][];
        entries.push({
            id: entries.length,
            category,
            title,
            content,
            fields,
            normTitle: normalize(title),
            normCategory: normalize(category),
            normContent: normalize([content, ...fields.flat()].join(' ')),
        });
    }
}
const categories = Object.keys(rules);

const score = (e: RuleEntry, q: string): number => {
    if (e.normTitle === q) return 100;
    if (e.normTitle.startsWith(q)) return 80;
    if (e.normTitle.includes(q)) return 60;
    // Chaque mot de la requête doit apparaître quelque part
    const words = q.split(/\s+/).filter(Boolean);
    const all = `${e.normTitle} ${e.normCategory} ${e.normContent}`;
    if (!words.every(w => all.includes(w))) return 0;
    if (words.every(w => e.normTitle.includes(w))) return 50;
    if (words.every(w => e.normCategory.includes(w))) return 30;
    return 10;
};

const search = (query: string): RuleEntry[] => {
    const q = normalize(query);
    return entries
        .map(e => ({ e, s: score(e, q) }))
        .filter(r => r.s > 0)
        .sort((a, b) => b.s - a.s || a.e.id - b.e.id)
        .map(r => r.e);
};

const buildEmbed = (e: RuleEntry) => {
    const embed = new EmbedBuilder()
        .setTitle(`${e.category === 'Disciplines' ? '🧛' : '📖'} ${e.title}`)
        .setColor(RULE_COLOR)
        .setFooter({ text: e.category });
    if (e.content) embed.setDescription(truncate(e.content, LIMITS.embedDescription));
    if (e.fields.length > 0) {
        embed.addFields(e.fields.slice(0, 25).map(([name, value]) => ({
            name: truncate(name, 256),
            value: truncate(value, LIMITS.embedField),
        })));
    }
    return embed;
};

const homeButton = () =>
    new ButtonBuilder().setCustomId('regle:home').setLabel('Sommaire').setEmoji('📚').setStyle(ButtonStyle.Secondary);

const entryView = (e: RuleEntry, withHome: boolean) => ({
    embeds: [buildEmbed(e)],
    components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            shareButton(`regle:share:${e.id}`),
            ...(withHome ? [homeButton()] : []),
        ),
    ],
});

const pickMenu = (list: RuleEntry[], placeholder: string) =>
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('regle:pick')
            .setPlaceholder(placeholder)
            .addOptions(list.slice(0, LIMITS.choices).map(e => ({
                label: truncate(e.title, 100),
                description: truncate(e.category, 100),
                value: String(e.id),
            }))),
    );

const summaryView = () => ({
    embeds: [
        new EmbedBuilder()
            .setTitle('📚 Règles')
            .setColor(RULE_COLOR)
            .setDescription(
                categories.map(c => `**${c}** · ${Object.keys(rules[c]).length}`).join('\n') +
                '\n\nAstuce : `/regle recherche:` trouve directement une règle ou une Discipline.',
            ),
    ],
    components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('regle:cat')
                .setPlaceholder('Choisir une catégorie')
                .addOptions(categories.slice(0, LIMITS.choices).map(c => ({ label: truncate(c, 100), value: c }))),
        ),
    ],
});

const categoryView = (category: string) => {
    const list = entries.filter(e => e.category === category);
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle(`📚 ${category}`)
                .setColor(RULE_COLOR)
                .setDescription(truncate(list.map(e => `• ${e.title}`).join('\n'), LIMITS.embedDescription)),
        ],
        components: [
            pickMenu(list, 'Choisir une règle'),
            new ActionRowBuilder<ButtonBuilder>().addComponents(homeButton()),
        ],
    };
};

export const regle: Command = {
    data: new SlashCommandBuilder()
        .setName('regle')
        .setDescription('Retrouver une règle ou une Discipline (sans argument : sommaire)')
        .addStringOption(o =>
            o.setName('recherche')
                .setDescription('Nom ou mot-clé : frénésie, esquive, domination…')
                .setAutocomplete(true))
        .addBooleanOption(o =>
            o.setName('public').setDescription('Afficher pour toute la table (privé par défaut)')),

    async autocomplete(interaction) {
        const value = interaction.options.getFocused();
        const list = value.trim() ? search(value) : entries;
        await interaction.respond(list.slice(0, LIMITS.choices).map(e => ({
            name: truncate(`${e.title} · ${e.category}`, LIMITS.choiceName),
            value: String(e.id),
        })));
    },

    async execute(interaction) {
        const query = interaction.options.getString('recherche');
        const isPublic = interaction.options.getBoolean('public') ?? false;

        if (!query) {
            return interaction.reply({ ...summaryView(), flags: EPHEMERAL });
        }

        // Une valeur choisie dans l'autocomplétion est l'id de la règle ; sinon c'est du texte libre.
        const direct = /^\d+$/.test(query) ? entries[Number(query)] : undefined;
        const results = direct ? [direct] : search(query);

        if (results.length === 0) {
            return interaction.reply({ content: `❌ Aucune règle trouvée pour « ${query} ».`, flags: EPHEMERAL });
        }
        if (results.length === 1) {
            const e = results[0];
            return isPublic
                ? interaction.reply({ embeds: [buildEmbed(e)] })
                : interaction.reply({ ...entryView(e, false), flags: EPHEMERAL });
        }

        const embed = new EmbedBuilder()
            .setTitle(`🔍 « ${query} » : ${results.length} résultats`)
            .setColor(RULE_COLOR)
            .setDescription(truncate(
                results.slice(0, 10).map(e => `**${e.title}** · *${e.category}*`).join('\n'),
                LIMITS.embedDescription,
            ));
        if (results.length > LIMITS.choices) {
            embed.setFooter({ text: `Seuls les ${LIMITS.choices} premiers sont dans le menu, affinez la recherche.` });
        }
        return interaction.reply({ embeds: [embed], components: [pickMenu(results, 'Choisir un résultat')], flags: EPHEMERAL });
    },

    async component(interaction, action, arg) {
        if (action === 'home') {
            return interaction.update(summaryView());
        }
        if (action === 'cat' && interaction.isStringSelectMenu()) {
            return interaction.update(categoryView(interaction.values[0]));
        }
        if (action === 'pick' && interaction.isStringSelectMenu()) {
            const e = entries[Number(interaction.values[0])];
            if (!e) return interaction.reply({ content: '❌ Règle introuvable.', flags: EPHEMERAL });
            return interaction.update(entryView(e, true));
        }
        if (action === 'share') {
            const e = entries[Number(arg)];
            if (!e) return interaction.reply({ content: '❌ Règle introuvable.', flags: EPHEMERAL });
            return interaction.reply({ content: `📣 Partagé par **${interaction.user.displayName}**`, embeds: [buildEmbed(e)] });
        }
    },
};
