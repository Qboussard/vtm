import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { lores } from '../data';
import { Command } from '../types';
import { EPHEMERAL, isUrl, LIMITS, matches, truncate } from '../util';

export const lore: Command = {
    data: new SlashCommandBuilder()
        .setName('lore')
        .setDescription('Affiche un élément de lore')
        .addStringOption(o =>
            o.setName('categorie').setDescription('Catégorie de lore').setRequired(true).setAutocomplete(true))
        .addStringOption(o =>
            o.setName('sous_categorie').setDescription('Sous-catégorie de lore').setRequired(true).setAutocomplete(true)),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        const category = interaction.options.getString('categorie') ?? '';
        const source = focused.name === 'categorie' ? Object.keys(lores) : Object.keys(lores[category] ?? {});
        await interaction.respond(
            source.filter(k => matches(k, focused.value)).slice(0, LIMITS.choices).map(k => ({ name: truncate(k, LIMITS.choiceName), value: k })),
        );
    },

    async execute(interaction) {
        const category = interaction.options.getString('categorie', true);
        const subcategory = interaction.options.getString('sous_categorie', true);
        const entry = lores[category]?.[subcategory];
        if (!entry?.description) {
            return interaction.reply({ content: `❌ Lore introuvable pour « ${category} > ${subcategory} ».`, flags: EPHEMERAL });
        }
        const embed = new EmbedBuilder()
            .setTitle(`📜 ${subcategory}`)
            .setDescription(truncate(entry.description, LIMITS.embedDescription))
            .setColor(0x8B0000)
            .setFooter({ text: `Catégorie : ${category}` });
        if (entry.image && isUrl(entry.image)) embed.setImage(entry.image);
        return interaction.reply({ embeds: [embed] });
    },
};
