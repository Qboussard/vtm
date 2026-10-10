import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ChatInputCommandInteraction,
    Client,
    ModalBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    TextChannel,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
} from 'discord.js';
import { clans, Fiche, fiches, saveFiches } from '../data';
import {
    createSheetThread,
    damage,
    DamageType,
    getTrait,
    heal,
    logToSheet,
    maxSante,
    maxVolonte,
    newFiche,
    PisteName,
    refreshSheet,
    setTrait,
    sheetLink,
    sheetMessage,
    TRAIT_GROUPS,
    TRAITS,
    traitRange,
} from '../sheet';
import { Command, isMJ } from '../types';
import { buttonRows, EPHEMERAL, LIMITS, normalize } from '../util';

const PISTES: Record<PisteName, string> = { sante: 'Santé', volonte: 'Volonté' };
const TYPES: Record<DamageType, string> = { superficiel: 'superficiel', aggrave: 'aggravé' };

/** Le joueur gère sa fiche ; les MJ gèrent toutes les fiches. */
const canEdit = (clickerId: string, ownerId: string) => clickerId === ownerId || isMJ(clickerId);

/** « (par @MJ) » quand quelqu'un d'autre que le joueur touche à la fiche. */
const byWhom = (clickerId: string, ownerId: string) => (clickerId === ownerId ? '' : ` (par <@${clickerId}>)`);

const findClan = (name: string) => Object.keys(clans).find(c => normalize(c) === normalize(name));

const threadAlive = async (client: Client, f: Fiche) => {
    if (!f.fil) return false;
    const thread = await client.channels.fetch(f.fil.threadId).catch(() => null);
    return Boolean(thread?.isThread());
};

// --- Panneaux éphémères ouverts depuis la fiche ---

const groupPanel = (ownerId: string, groupKey: string, notice = '') => {
    const f = fiches[ownerId];
    const group = TRAIT_GROUPS.find(g => g.key === groupKey)!;
    return {
        content: `${notice ? `${notice}\n` : ''}${group.emoji} **${group.label}** · ${f.nom} : choisissez la valeur à changer.`,
        components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`fiche:trait:${ownerId}:${groupKey}`)
                    .setPlaceholder('Choisir…')
                    .addOptions(group.traits.slice(0, LIMITS.choices).map(t => ({
                        label: `${t.name} : ${getTrait(f, t)}`,
                        value: String(TRAITS.indexOf(t)),
                    }))),
            ),
        ],
    };
};

const valuePanel = (ownerId: string, groupKey: string, traitIndex: number) => {
    const f = fiches[ownerId];
    const t = TRAITS[traitIndex];
    const [min, max] = traitRange(t);
    const current = getTrait(f, t);
    const buttons = Array.from({ length: max - min + 1 }, (_, i) => min + i).map(v =>
        new ButtonBuilder()
            .setCustomId(`fiche:set:${ownerId}:${groupKey}:${traitIndex}:${v}`)
            .setLabel(String(v))
            .setStyle(v === current ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(v === current));
    return {
        content: `**${t.name}** · ${f.nom} : actuellement **${current}**. Nouvelle valeur ?`,
        components: [
            ...buttonRows(buttons, 4),
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`fiche:back:${ownerId}:${groupKey}`).setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
            ),
        ],
    };
};

const trackLine = (f: Fiche, piste: PisteName) => {
    const max = piste === 'sante' ? maxSante(f) : maxVolonte(f);
    const p = f[piste];
    return `**${PISTES[piste]}** ${p.superficiel} superficiel · ${p.aggrave} aggravé · ${max} cases`;
};

const tracksPanel = (ownerId: string, notice = '') => {
    const f = fiches[ownerId];
    const row = (piste: PisteName) =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...(['superficiel', 'aggrave'] as DamageType[]).map(type =>
                new ButtonBuilder()
                    .setCustomId(`fiche:dmg:${ownerId}:${piste}:${type}:1`)
                    .setLabel(`${PISTES[piste]} +1 ${TYPES[type]}`)
                    .setEmoji(type === 'aggrave' ? '🟥' : '🟧')
                    .setStyle(ButtonStyle.Secondary)),
            ...(['superficiel', 'aggrave'] as DamageType[]).map(type =>
                new ButtonBuilder()
                    .setCustomId(`fiche:dmg:${ownerId}:${piste}:${type}:-1`)
                    .setLabel(`Soigner 1 ${TYPES[type]}`)
                    .setEmoji('💚')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(f[piste][type] === 0)),
        );
    return {
        content: [
            notice,
            `💔 **${f.nom}** · un clic = une case (dégâts superficiels déjà divisés par deux).`,
            trackLine(f, 'sante'),
            trackLine(f, 'volonte'),
        ].filter(Boolean).join('\n'),
        components: [row('sante'), row('volonte')],
    };
};

const identityModal = (ownerId: string, f: Fiche) =>
    new ModalBuilder()
        .setCustomId(`fiche:identity:${ownerId}`)
        .setTitle('Nom et clan')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId('nom').setLabel('Nom du personnage').setStyle(TextInputStyle.Short).setMaxLength(80).setValue(f.nom),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId('clan').setLabel(`Clan (${Object.keys(clans).slice(0, 6).join(', ')}…)`.slice(0, 45))
                    .setStyle(TextInputStyle.Short).setMaxLength(40).setValue(f.clan),
            ),
        );

/** Création ou ouverture de la fiche, avec son fil privé dans le salon courant. */
const openSheet = async (interaction: ChatInputCommandInteraction) => {
    const other = interaction.options.getUser('joueur');
    if (other && other.id !== interaction.user.id && !isMJ(interaction.user.id)) {
        return interaction.reply({ content: '❌ Seuls les MJ peuvent ouvrir la fiche d\'un autre joueur.', flags: EPHEMERAL });
    }
    const ownerId = other?.id ?? interaction.user.id;
    const f = fiches[ownerId];
    const inTextChannel = interaction.channel?.type === ChannelType.GuildText;

    if (f && await threadAlive(interaction.client, f)) {
        return interaction.reply({ ...sheetMessage(ownerId, f), content: `📜 Fiche à jour dans ${sheetLink(f)}`, flags: EPHEMERAL });
    }
    if (!inTextChannel) {
        return interaction.reply({ content: '❌ Lancez `/fiche` dans un salon textuel (pas dans un fil) : le fil privé y sera créé.', flags: EPHEMERAL });
    }

    if (!f) {
        const nom = interaction.options.getString('nom');
        const clan = interaction.options.getString('clan');
        if (!nom || !clan) {
            return interaction.reply({ content: '📜 Pas encore de fiche : `/fiche nom: clan:` pour la créer.', flags: EPHEMERAL });
        }
        fiches[ownerId] = newFiche(nom, clan);
        saveFiches();
    }
    // Fiche neuve, ou fil supprimé : on (re)crée le fil ici
    await interaction.deferReply({ flags: EPHEMERAL });
    const thread = await createSheetThread(interaction.channel as TextChannel, ownerId, fiches[ownerId]);
    return interaction.editReply(f
        ? `✅ Nouveau fil pour la fiche : ${thread}.`
        : `✅ Fiche créée : ${thread}. Remplissez-la avec le menu « ✏️ Modifier une valeur » sous la fiche.`);
};

export const fiche: Command = {
    data: new SlashCommandBuilder()
        .setName('fiche')
        .setDescription('Votre fiche de personnage : la crée (nom, clan) ou l\'ouvre')
        .addStringOption(o => o.setName('nom').setDescription('Création : nom du personnage').setMaxLength(80))
        .addStringOption(o =>
            o.setName('clan').setDescription('Création : clan')
                .addChoices(...Object.keys(clans).slice(0, LIMITS.choices).map(c => ({ name: c, value: c }))))
        .addUserOption(o => o.setName('joueur').setDescription('MJ : fiche d\'un joueur (la créer pour lui, ou l\'ouvrir)')),

    execute: openSheet,

    async component(interaction, action, arg) {
        const [ownerId, ...rest] = arg.split(':');
        const f = fiches[ownerId];
        if (!f) return interaction.reply({ content: '❌ Cette fiche n\'existe plus.', flags: EPHEMERAL });
        if (!canEdit(interaction.user.id, ownerId)) {
            return interaction.reply({ content: '❌ C\'est la fiche d\'un autre joueur.', flags: EPHEMERAL });
        }
        const client = interaction.client;
        const by = byWhom(interaction.user.id, ownerId);

        if (action === 'group' && interaction.isStringSelectMenu()) {
            return interaction.reply({ ...groupPanel(ownerId, interaction.values[0]), flags: EPHEMERAL });
        }
        if (action === 'back') {
            return interaction.update(groupPanel(ownerId, rest[0]));
        }
        if (action === 'trait' && interaction.isStringSelectMenu()) {
            return interaction.update(valuePanel(ownerId, rest[0], Number(interaction.values[0])));
        }
        if (action === 'set') {
            const [groupKey, index, value] = rest;
            const t = TRAITS[Number(index)];
            const v = Number(value);
            const [min, max] = traitRange(t);
            if (!t || v < min || v > max) return interaction.reply({ content: '❌ Valeur invalide.', flags: EPHEMERAL });
            const before = getTrait(f, t);
            setTrait(f, t, v);
            saveFiches();
            await interaction.update(groupPanel(ownerId, groupKey, `✅ ${t.name} : ${before} → ${v}`));
            await refreshSheet(client, ownerId);
            return logToSheet(client, ownerId, `✏️ ${t.name} : ${before} → ${v}${by}`);
        }
        if (action === 'tracks') {
            return interaction.reply({ ...tracksPanel(ownerId), flags: EPHEMERAL });
        }
        if (action === 'dmg') {
            const [piste, type, sign] = rest as [PisteName, DamageType, string];
            const text = sign === '1'
                ? `💔 ${PISTES[piste]} : 1 dégât ${TYPES[type]}${by}`
                : `💚 ${PISTES[piste]} : 1 dégât ${TYPES[type]} soigné${by}`;
            if (sign === '1') damage(f, piste, type, 1);
            else heal(f, piste, type, 1);
            saveFiches();
            await interaction.update(tracksPanel(ownerId, `✅ ${text}`));
            await refreshSheet(client, ownerId);
            return logToSheet(client, ownerId, text);
        }
        if (action === 'identity') {
            return interaction.showModal(identityModal(ownerId, f));
        }
        if (action === 'owner') {
            if (!isMJ(interaction.user.id)) return interaction.reply({ content: '❌ Réservé aux MJ.', flags: EPHEMERAL });
            return interaction.reply({
                content: `🔗 À quel joueur rattacher **${f.nom}** ? Ses jets utiliseront cette fiche.`,
                components: [
                    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
                        new UserSelectMenuBuilder().setCustomId(`fiche:transfer:${ownerId}`).setPlaceholder('Choisir un joueur'),
                    ),
                ],
                flags: EPHEMERAL,
            });
        }
        if (action === 'transfer' && interaction.isUserSelectMenu()) {
            if (!isMJ(interaction.user.id)) return interaction.reply({ content: '❌ Réservé aux MJ.', flags: EPHEMERAL });
            const to = interaction.values[0];
            if (to === ownerId) return interaction.update({ content: '✅ Déjà rattachée à ce joueur.', components: [] });
            if (fiches[to]) return interaction.update({ content: `❌ <@${to}> a déjà une fiche (**${fiches[to].nom}**).`, components: [] });
            fiches[to] = f;
            delete fiches[ownerId];
            saveFiches();
            if (f.fil) {
                const thread = await client.channels.fetch(f.fil.threadId).catch(() => null);
                if (thread?.isThread()) await thread.members.add(to).catch(() => {});
            }
            await interaction.update({ content: `✅ **${f.nom}** appartient maintenant à <@${to}>.`, components: [] });
            // Les boutons de la fiche portent l'identifiant du joueur : on les régénère
            await refreshSheet(client, to);
            return logToSheet(client, to, `🔗 Fiche rattachée à <@${to}> (avant : <@${ownerId}>)${by}`);
        }
    },

    async modal(interaction, action, arg) {
        if (action !== 'identity') return;
        const ownerId = arg;
        const f = fiches[ownerId];
        if (!f) return interaction.reply({ content: '❌ Cette fiche n\'existe plus.', flags: EPHEMERAL });
        if (!canEdit(interaction.user.id, ownerId)) {
            return interaction.reply({ content: '❌ C\'est la fiche d\'un autre joueur.', flags: EPHEMERAL });
        }
        const nom = interaction.fields.getTextInputValue('nom').trim();
        const clanInput = interaction.fields.getTextInputValue('clan').trim();
        // Un clan connu reprend son orthographe officielle ; sinon on garde la saisie (clan maison, Sang-clair…)
        const clan = findClan(clanInput) ?? clanInput;
        const changes = [
            nom && nom !== f.nom ? `nom : ${f.nom} → ${nom}` : '',
            clan && clan !== f.clan ? `clan : ${f.clan} → ${clan}` : '',
        ].filter(Boolean).join(', ');
        if (!changes) return interaction.reply({ content: 'Rien n\'a changé.', flags: EPHEMERAL });
        if (nom) f.nom = nom;
        if (clan) f.clan = clan;
        saveFiches();
        await interaction.reply({ content: `✅ ${changes}`, flags: EPHEMERAL });
        if (nom && f.fil) {
            const thread = await interaction.client.channels.fetch(f.fil.threadId).catch(() => null);
            if (thread?.isThread()) await thread.setName(`📜 ${nom}`).catch(() => {});
        }
        await refreshSheet(interaction.client, ownerId);
        return logToSheet(interaction.client, ownerId, `✏️ ${changes}${byWhom(interaction.user.id, ownerId)}`);
    },
};
