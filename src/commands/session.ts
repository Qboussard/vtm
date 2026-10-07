import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { saveSessions, Session, sessions } from '../data';
import { Command, isMJ } from '../types';
import { chunkLines, EPHEMERAL, LIMITS, truncate } from '../util';

const buildEmbed = (s: Session) => {
    const embed = new EmbedBuilder()
        .setTitle(truncate(`📖 Session ${s.numero} — ${s.titre}`, 256))
        .setColor(0x4B0082)
        .setFooter({ text: s.date });
    if (s.resume) embed.setDescription(truncate(s.resume, LIMITS.embedDescription));
    return embed;
};

export const session: Command = {
    data: new SlashCommandBuilder()
        .setName('session')
        .setDescription('Journal des sessions de campagne')
        .addSubcommand(sub =>
            sub.setName('ajouter')
                .setDescription('Ajoute un résumé de session (MJ)')
                .addStringOption(o => o.setName('titre').setDescription('Titre de la session').setRequired(true))
                .addStringOption(o => o.setName('resume').setDescription('Résumé public de la session').setRequired(true))
                .addStringOption(o => o.setName('notes_mj').setDescription('Notes privées MJ')))
        .addSubcommand(sub =>
            sub.setName('voir')
                .setDescription('Affiche une session')
                .addIntegerOption(o => o.setName('numero').setDescription('Numéro de session').setRequired(true).setMinValue(1)))
        .addSubcommand(sub =>
            sub.setName('derniere')
                .setDescription('Affiche la dernière session'))
        .addSubcommand(sub =>
            sub.setName('liste')
                .setDescription('Liste toutes les sessions')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        const show = async (s: Session) => {
            await interaction.reply({ embeds: [buildEmbed(s)] });
            if (isMJ(userId) && s.notes_mj) {
                await interaction.followUp({
                    content: truncate(`🔒 **Notes MJ — Session ${s.numero} :**\n${s.notes_mj}`, LIMITS.message),
                    flags: EPHEMERAL,
                });
            }
        };

        if (sub === 'ajouter') {
            if (!isMJ(userId)) return interaction.reply({ content: '❌ Seuls les MJ peuvent ajouter des sessions.', flags: EPHEMERAL });
            const numero = sessions.reduce((max, s) => Math.max(max, s.numero), 0) + 1;
            const newSession: Session = {
                numero,
                titre: interaction.options.getString('titre', true),
                date: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                resume: interaction.options.getString('resume', true),
                notes_mj: interaction.options.getString('notes_mj') ?? '',
            };
            sessions.push(newSession);
            saveSessions();
            return interaction.reply({ content: `✅ Session ${numero} enregistrée !`, embeds: [buildEmbed(newSession)] });
        }

        if (sub === 'voir') {
            const numero = interaction.options.getInteger('numero', true);
            const s = sessions.find(x => x.numero === numero);
            if (!s) return interaction.reply({ content: `❌ Session ${numero} introuvable.`, flags: EPHEMERAL });
            return show(s);
        }

        if (sessions.length === 0) {
            return interaction.reply({ content: 'Aucune session enregistrée.', flags: EPHEMERAL });
        }

        if (sub === 'derniere') {
            return show(sessions[sessions.length - 1]);
        }

        if (sub === 'liste') {
            const lines = sessions.map(s => `📖 **Session ${s.numero}** — ${s.titre} *(${s.date})*`);
            const [first, ...rest] = chunkLines(['📋 **Journal de campagne :**', ...lines]);
            await interaction.reply({ content: first });
            for (const chunk of rest) await interaction.followUp({ content: chunk });
        }
    },
};
