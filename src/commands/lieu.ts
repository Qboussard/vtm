import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { lieux, pnjs, saveLieux } from '../data';
import { Command, isMJ } from '../types';
import { chunkLines, EPHEMERAL, isUrl, LIMITS, matches, truncate } from '../util';

const nameOption = (o: import('discord.js').SlashCommandStringOption) =>
    o.setName('nom').setDescription('Nom du lieu').setRequired(true).setAutocomplete(true);

export const lieu: Command = {
    data: new SlashCommandBuilder()
        .setName('lieu')
        .setDescription('Lieux de la campagne')
        .addSubcommand(sub =>
            sub.setName('voir')
                .setDescription("Affiche la fiche d'un lieu")
                .addStringOption(nameOption))
        .addSubcommand(sub =>
            sub.setName('ajouter')
                .setDescription('Ajoute un lieu (MJ)')
                .addStringOption(o => o.setName('nom').setDescription('Nom du lieu').setRequired(true).setMaxLength(80))
                .addStringOption(o => o.setName('type').setDescription('Type de lieu (bar, église, Élysium…)'))
                .addStringOption(o => o.setName('quartier').setDescription('Quartier ou zone'))
                .addStringOption(o => o.setName('description').setDescription('Description publique'))
                .addStringOption(o => o.setName('image').setDescription("URL de l'image (https://…)")))
        .addSubcommand(sub =>
            sub.setName('secret')
                .setDescription("Remplace les notes secrètes d'un lieu (MJ)")
                .addStringOption(nameOption)
                .addStringOption(o => o.setName('texte').setDescription('Notes secrètes MJ').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('liste')
                .setDescription('Liste tous les lieux')),

    async autocomplete(interaction) {
        const value = interaction.options.getFocused();
        await interaction.respond(
            Object.keys(lieux).filter(n => matches(n, value)).slice(0, LIMITS.choices)
                .map(n => ({ name: truncate(n, LIMITS.choiceName), value: n })),
        );
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (sub === 'voir') {
            const nom = interaction.options.getString('nom', true);
            const l = lieux[nom];
            if (!l) return interaction.reply({ content: `❌ Lieu « ${nom} » introuvable.`, flags: EPHEMERAL });

            const embed = new EmbedBuilder().setTitle(`🗺️ ${nom}`).setColor(0x2C3E50);
            const infos = [l.type && `**Type :** ${l.type}`, l.quartier && `**Quartier :** ${l.quartier}`].filter(Boolean).join('\n');
            if (infos) embed.addFields({ name: 'Informations', value: truncate(infos, LIMITS.embedField) });
            if (l.description) embed.setDescription(truncate(l.description, LIMITS.embedDescription));
            // Les PNJ pas encore rencontrés restent cachés
            const linked = (l.pnj_lies ?? []).filter(n => !pnjs[n] || pnjs[n].connu !== false);
            if (linked.length > 0) embed.addFields({ name: 'PNJ liés', value: truncate(linked.join(', '), LIMITS.embedField) });
            if (isUrl(l.image)) embed.setImage(l.image);

            await interaction.reply({ embeds: [embed] });
            if (isMJ(userId) && l.description_mj) {
                await interaction.followUp({
                    content: truncate(`🔒 **Notes MJ — ${nom} :**\n${l.description_mj}`, LIMITS.message),
                    flags: EPHEMERAL,
                });
            }
            return;
        }

        if (sub === 'ajouter') {
            if (!isMJ(userId)) return interaction.reply({ content: '❌ Seuls les MJ peuvent ajouter des lieux.', flags: EPHEMERAL });
            const nom = interaction.options.getString('nom', true).trim();
            if (lieux[nom]) return interaction.reply({ content: `❌ Un lieu nommé « ${nom} » existe déjà.`, flags: EPHEMERAL });
            const image = interaction.options.getString('image')?.trim() ?? '';
            if (image && !isUrl(image)) {
                return interaction.reply({ content: "❌ L'image doit être une URL commençant par http:// ou https://.", flags: EPHEMERAL });
            }
            lieux[nom] = {
                type: interaction.options.getString('type') ?? '',
                quartier: interaction.options.getString('quartier') ?? '',
                description: interaction.options.getString('description') ?? '',
                description_mj: '',
                image,
                pnj_lies: [],
            };
            saveLieux();
            return interaction.reply({ content: `✅ Lieu **${nom}** ajouté.`, flags: EPHEMERAL });
        }

        if (sub === 'secret') {
            if (!isMJ(userId)) return interaction.reply({ content: '❌ Seuls les MJ peuvent modifier les notes secrètes.', flags: EPHEMERAL });
            const nom = interaction.options.getString('nom', true);
            if (!lieux[nom]) return interaction.reply({ content: `❌ Lieu « ${nom} » introuvable.`, flags: EPHEMERAL });
            lieux[nom].description_mj = interaction.options.getString('texte', true);
            saveLieux();
            return interaction.reply({ content: `✅ Notes secrètes de **${nom}** mises à jour.`, flags: EPHEMERAL });
        }

        if (sub === 'liste') {
            const noms = Object.keys(lieux);
            if (noms.length === 0) return interaction.reply({ content: 'Aucun lieu enregistré.', flags: EPHEMERAL });
            const lines = noms.map(n => {
                const l = lieux[n];
                return `🗺️ **${n}**${l.type ? ` — ${l.type}` : ''}${l.quartier ? ` · ${l.quartier}` : ''}`;
            });
            const [first, ...rest] = chunkLines(['📋 **Lieux de la campagne :**', ...lines]);
            await interaction.reply({ content: first });
            for (const chunk of rest) await interaction.followUp({ content: chunk });
        }
    },
};
