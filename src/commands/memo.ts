import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { memos } from '../data';
import { Command } from '../types';
import { EPHEMERAL, LIMITS, shareButton, truncate } from '../util';

const MEMO_COLOR = 0x8B0000;

const buildEmbed = (index: number) =>
    new EmbedBuilder()
        .setTitle(memos[index].titre)
        .setColor(MEMO_COLOR)
        .setDescription(truncate(memos[index].contenu, LIMITS.embedDescription))
        .setFooter({ text: `Mémo ${index + 1}/${memos.length} · /regle pour le détail` });

const view = (index: number) => ({
    embeds: [buildEmbed(index)],
    components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            memos.slice(0, 5).map((m, i) =>
                new ButtonBuilder()
                    .setCustomId(`memo:show:${i}`)
                    .setLabel(truncate(m.titre, LIMITS.label))
                    .setStyle(i === index ? ButtonStyle.Primary : ButtonStyle.Secondary)
                    .setDisabled(i === index)),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(shareButton(`memo:share:${index}`)),
    ],
});

export const memo: Command = {
    data: new SlashCommandBuilder()
        .setName('memo')
        .setDescription('Fiches mémo pour la session : jets, combat, Soif, Volonté')
        .addIntegerOption(o =>
            o.setName('fiche')
                .setDescription('Fiche à ouvrir')
                .addChoices(...memos.slice(0, LIMITS.choices).map((m, i) => ({ name: m.titre, value: i }))))
        .addBooleanOption(o =>
            o.setName('public').setDescription('Afficher pour toute la table (privé par défaut)')),

    async execute(interaction) {
        const index = interaction.options.getInteger('fiche') ?? 0;
        if (interaction.options.getBoolean('public')) {
            return interaction.reply({ embeds: [buildEmbed(index)] });
        }
        return interaction.reply({ ...view(index), flags: EPHEMERAL });
    },

    async component(interaction, action, arg) {
        const index = Number(arg);
        if (!memos[index]) return interaction.reply({ content: '❌ Fiche introuvable.', flags: EPHEMERAL });
        if (action === 'show') return interaction.update(view(index));
        if (action === 'share') {
            return interaction.reply({ content: `📣 Partagé par **${interaction.user.displayName}**`, embeds: [buildEmbed(index)] });
        }
    },
};
