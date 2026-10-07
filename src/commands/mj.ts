import { SlashCommandBuilder } from 'discord.js';
import { config, saveConfig } from '../data';
import { Command, SUPER_MJ_ID } from '../types';
import { EPHEMERAL } from '../util';

export const mj: Command = {
    data: new SlashCommandBuilder()
        .setName('mj')
        .setDescription('Gestion des MJ (Super MJ uniquement)')
        .addSubcommand(sub =>
            sub.setName('ajouter')
                .setDescription('Donne les droits MJ à un utilisateur')
                .addUserOption(o => o.setName('utilisateur').setDescription('Utilisateur').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('retirer')
                .setDescription('Retire les droits MJ à un utilisateur')
                .addUserOption(o => o.setName('utilisateur').setDescription('Utilisateur').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('liste')
                .setDescription('Liste les MJ actuels')),

    async execute(interaction) {
        if (interaction.user.id !== SUPER_MJ_ID) {
            return interaction.reply({ content: '❌ Seul le Super MJ peut gérer les droits MJ.', flags: EPHEMERAL });
        }
        const sub = interaction.options.getSubcommand();

        if (sub === 'ajouter') {
            const target = interaction.options.getUser('utilisateur', true);
            if (config.mj_ids.includes(target.id)) {
                return interaction.reply({ content: `ℹ️ ${target.username} est déjà MJ.`, flags: EPHEMERAL });
            }
            config.mj_ids.push(target.id);
            saveConfig();
            return interaction.reply({ content: `✅ **${target.username}** a été promu MJ.`, flags: EPHEMERAL });
        }

        if (sub === 'retirer') {
            const target = interaction.options.getUser('utilisateur', true);
            config.mj_ids = config.mj_ids.filter(id => id !== target.id);
            saveConfig();
            return interaction.reply({ content: `✅ Droits MJ retirés à **${target.username}**.`, flags: EPHEMERAL });
        }

        if (sub === 'liste') {
            const liste = config.mj_ids.length > 0
                ? config.mj_ids.map(id => `<@${id}>`).join(', ')
                : 'Aucun MJ supplémentaire.';
            return interaction.reply({ content: `👑 **MJ actuels :** ${liste}`, flags: EPHEMERAL });
        }
    },
};
