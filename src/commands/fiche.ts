import { ChannelType, ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { clans, fiches, saveFiches } from '../data';
import {
    createSheetThread,
    damage,
    DamageType,
    findTrait,
    getTrait,
    heal,
    logToSheet,
    newFiche,
    PisteName,
    refreshSheet,
    setTrait,
    sheetLink,
    sheetMessage,
    TRAITS,
    traitRange,
} from '../sheet';
import { Command, isMJ } from '../types';
import { EPHEMERAL, LIMITS, normalize } from '../util';

const PISTES: Record<PisteName, string> = { sante: 'Santé', volonte: 'Volonté' };
const TYPES: Record<DamageType, string> = { superficiel: 'superficiel', aggrave: 'aggravé' };

/**
 * Fiche visée : celle de l'auteur, ou celle de `joueur` pour un MJ.
 * Renvoie un message d'erreur à la place si l'accès est refusé.
 */
const target = (interaction: ChatInputCommandInteraction): { userId: string } | { error: string } => {
    const other = interaction.options.getUser('joueur');
    if (other && other.id !== interaction.user.id && !isMJ(interaction.user.id)) {
        return { error: '❌ Seuls les MJ peuvent toucher à la fiche d\'un autre joueur.' };
    }
    const userId = other?.id ?? interaction.user.id;
    if (!fiches[userId]) {
        return { error: other ? `❌ <@${userId}> n'a pas de fiche.` : '❌ Vous n\'avez pas encore de fiche : `/fiche creer`.' };
    }
    return { userId };
};

const joueurOption = (description: string) => (o: any) => o.setName('joueur').setDescription(description);

const pisteOptions = (sub: any) =>
    sub.addStringOption((o: any) =>
        o.setName('piste').setDescription('Santé ou Volonté').setRequired(true)
            .addChoices(...Object.entries(PISTES).map(([value, name]) => ({ name, value }))))
        .addStringOption((o: any) =>
            o.setName('type').setDescription('Superficiel ou aggravé').setRequired(true)
                .addChoices(...Object.entries(TYPES).map(([value, name]) => ({ name, value }))))
        .addIntegerOption((o: any) =>
            o.setName('nombre').setDescription('Nombre de cases (1 par défaut)').setMinValue(1).setMaxValue(20))
        .addUserOption(joueurOption('MJ : fiche d\'un joueur'));

export const fiche: Command = {
    data: new SlashCommandBuilder()
        .setName('fiche')
        .setDescription('Fiches de personnage : création, valeurs, dégâts')
        .addSubcommand(sub =>
            sub.setName('creer')
                .setDescription('Crée une fiche et son fil privé dans ce salon')
                .addStringOption(o => o.setName('nom').setDescription('Nom du personnage').setRequired(true).setMaxLength(80))
                .addStringOption(o =>
                    o.setName('clan').setDescription('Clan').setRequired(true)
                        .addChoices(...Object.keys(clans).slice(0, LIMITS.choices).map(c => ({ name: c, value: c }))))
                .addUserOption(joueurOption('MJ : créer la fiche pour ce joueur (par défaut : vous)')))
        .addSubcommand(sub =>
            sub.setName('voir')
                .setDescription('Affiche une fiche (pour vous seul)')
                .addUserOption(joueurOption('MJ : fiche d\'un joueur')))
        .addSubcommand(sub =>
            sub.setName('modifier')
                .setDescription('Change une valeur : attribut, compétence, Discipline, Soif, Humanité…')
                .addStringOption(o => o.setName('trait').setDescription('Force, Persuasion, Domination, Humanité…').setRequired(true).setAutocomplete(true))
                .addIntegerOption(o => o.setName('valeur').setDescription('Nouvelle valeur').setRequired(true).setMinValue(0).setMaxValue(16))
                .addUserOption(joueurOption('MJ : fiche d\'un joueur')))
        .addSubcommand(sub =>
            sub.setName('identite')
                .setDescription('Change le nom ou le clan du personnage')
                .addStringOption(o => o.setName('nom').setDescription('Nouveau nom').setMaxLength(80))
                .addStringOption(o =>
                    o.setName('clan').setDescription('Nouveau clan')
                        .addChoices(...Object.keys(clans).slice(0, LIMITS.choices).map(c => ({ name: c, value: c }))))
                .addUserOption(joueurOption('MJ : fiche d\'un joueur')))
        .addSubcommand(sub => pisteOptions(sub.setName('degats').setDescription('Inflige des dégâts (Santé ou Volonté)')))
        .addSubcommand(sub => pisteOptions(sub.setName('soin').setDescription('Retire des dégâts (Santé ou Volonté)')))
        .addSubcommand(sub =>
            sub.setName('lier')
                .setDescription('MJ : rattache une fiche à un autre compte Discord')
                .addUserOption(o => o.setName('de').setDescription('Compte qui a la fiche aujourd\'hui').setRequired(true))
                .addUserOption(o => o.setName('vers').setDescription('Joueur qui doit la recevoir').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('fil')
                .setDescription('Recrée le fil privé de la fiche dans ce salon (s\'il a été supprimé)')
                .addUserOption(joueurOption('MJ : fiche d\'un joueur'))),

    async autocomplete(interaction) {
        const q = normalize(interaction.options.getFocused());
        const f = fiches[interaction.user.id];
        await interaction.respond(
            TRAITS.filter(t => normalize(t.name).includes(q))
                .slice(0, LIMITS.choices)
                .map(t => ({ name: f ? `${t.name} (${getTrait(f, t)})` : t.name, value: t.name })),
        );
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const client = interaction.client;

        if (sub === 'creer') {
            const other = interaction.options.getUser('joueur');
            if (other && other.id !== interaction.user.id && !isMJ(interaction.user.id)) {
                return interaction.reply({ content: '❌ Seuls les MJ peuvent créer la fiche d\'un autre joueur.', flags: EPHEMERAL });
            }
            const userId = other?.id ?? interaction.user.id;
            if (fiches[userId]) {
                return interaction.reply({ content: `❌ Ce compte a déjà une fiche : **${fiches[userId].nom}** ${sheetLink(fiches[userId])}.`, flags: EPHEMERAL });
            }
            if (interaction.channel?.type !== ChannelType.GuildText) {
                return interaction.reply({ content: '❌ Lancez la commande dans un salon textuel (pas dans un fil) : le fil privé y sera créé.', flags: EPHEMERAL });
            }
            await interaction.deferReply({ flags: EPHEMERAL });
            fiches[userId] = newFiche(interaction.options.getString('nom', true), interaction.options.getString('clan', true));
            saveFiches();
            const thread = await createSheetThread(interaction.channel as TextChannel, userId, fiches[userId]);
            return interaction.editReply(`✅ Fiche créée : ${thread}. Remplissez-la avec \`/fiche modifier\` (attributs à 1, compétences à 0 au départ).`);
        }

        if (sub === 'lier') {
            if (!isMJ(interaction.user.id)) return interaction.reply({ content: '❌ Réservé aux MJ.', flags: EPHEMERAL });
            const from = interaction.options.getUser('de', true);
            const to = interaction.options.getUser('vers', true);
            const f = fiches[from.id];
            if (!f) return interaction.reply({ content: `❌ <@${from.id}> n'a pas de fiche.`, flags: EPHEMERAL });
            if (fiches[to.id]) return interaction.reply({ content: `❌ <@${to.id}> a déjà une fiche (**${fiches[to.id].nom}**).`, flags: EPHEMERAL });
            fiches[to.id] = f;
            delete fiches[from.id];
            saveFiches();
            // Le nouveau joueur rejoint le fil, et les boutons de la fiche pointent sur son compte
            if (f.fil) {
                const thread = await client.channels.fetch(f.fil.threadId).catch(() => null);
                if (thread?.isThread()) await thread.members.add(to.id).catch(() => {});
            }
            await refreshSheet(client, to.id);
            await logToSheet(client, to.id, `🔗 Fiche rattachée à <@${to.id}> (avant : <@${from.id}>).`);
            return interaction.reply({ content: `✅ **${f.nom}** appartient maintenant à <@${to.id}> : ses jets utilisent cette fiche.`, flags: EPHEMERAL });
        }

        const t = target(interaction);
        if ('error' in t) return interaction.reply({ content: t.error, flags: EPHEMERAL });
        const { userId } = t;
        const f = fiches[userId];
        const by = userId === interaction.user.id ? '' : ` (par <@${interaction.user.id}>)`;

        if (sub === 'voir') {
            return interaction.reply({ ...sheetMessage(userId, f), content: sheetLink(f) || undefined, flags: EPHEMERAL });
        }

        if (sub === 'fil') {
            if (interaction.channel?.type !== ChannelType.GuildText) {
                return interaction.reply({ content: '❌ Lancez la commande dans un salon textuel (pas dans un fil).', flags: EPHEMERAL });
            }
            await interaction.deferReply({ flags: EPHEMERAL });
            const thread = await createSheetThread(interaction.channel as TextChannel, userId, f);
            return interaction.editReply(`✅ Nouveau fil : ${thread}.`);
        }

        if (sub === 'modifier') {
            const name = interaction.options.getString('trait', true);
            const trait = findTrait(name);
            if (!trait) return interaction.reply({ content: `❌ « ${name} » n'existe pas sur une fiche.`, flags: EPHEMERAL });
            const value = interaction.options.getInteger('valeur', true);
            const [min, max] = traitRange(trait);
            if (value < min || value > max) {
                return interaction.reply({ content: `❌ ${trait.name} va de ${min} à ${max}.`, flags: EPHEMERAL });
            }
            const before = getTrait(f, trait);
            setTrait(f, trait, value);
            saveFiches();
            await interaction.reply({ content: `✅ ${f.nom} : ${trait.name} ${before} → ${value}`, flags: EPHEMERAL });
            await refreshSheet(client, userId);
            return logToSheet(client, userId, `✏️ ${trait.name} : ${before} → ${value}${by}`);
        }

        if (sub === 'identite') {
            const nom = interaction.options.getString('nom');
            const clan = interaction.options.getString('clan');
            if (!nom && !clan) return interaction.reply({ content: '❌ Indiquez un nom ou un clan.', flags: EPHEMERAL });
            const changes = [nom && `nom : ${f.nom} → ${nom}`, clan && `clan : ${f.clan} → ${clan}`].filter(Boolean).join(', ');
            if (nom) f.nom = nom;
            if (clan) f.clan = clan;
            saveFiches();
            await interaction.reply({ content: `✅ ${changes}`, flags: EPHEMERAL });
            if (nom && f.fil) {
                const thread = await client.channels.fetch(f.fil.threadId).catch(() => null);
                if (thread?.isThread()) await thread.setName(`📜 ${nom}`).catch(() => {});
            }
            await refreshSheet(client, userId);
            return logToSheet(client, userId, `✏️ ${changes}${by}`);
        }

        if (sub === 'degats' || sub === 'soin') {
            const piste = interaction.options.getString('piste', true) as PisteName;
            const type = interaction.options.getString('type', true) as DamageType;
            const n = interaction.options.getInteger('nombre') ?? 1;
            if (sub === 'degats') damage(f, piste, type, n);
            else heal(f, piste, type, n);
            saveFiches();
            const text = `${sub === 'degats' ? '💔' : '💚'} ${f.nom} : ${sub === 'degats' ? '' : 'soin de '}${n} ${TYPES[type]}${n > 1 ? 's' : ''} en ${PISTES[piste]}${by}`;
            await interaction.reply({ content: `✅ ${text}`, flags: EPHEMERAL });
            await refreshSheet(client, userId);
            return logToSheet(client, userId, text);
        }
    },
};
