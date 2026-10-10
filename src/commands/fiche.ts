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
import { clans, disciplines, Fiche, fiches, pjTemplates, saveFiches } from '../data';
import { rollPower } from './jet';
import {
    createSheetThread,
    damage,
    DamageType,
    findPower,
    getTrait,
    heal,
    knownPowers,
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
import { buttonRows, EPHEMERAL, LIMITS, normalize, truncate } from '../util';

const PISTES: Record<PisteName, string> = { sante: 'Santé', volonte: 'Volonté' };
const TYPES: Record<DamageType, string> = { superficiel: 'superficiel', aggrave: 'aggravé' };

/** Le joueur gère sa fiche ; les MJ gèrent toutes les fiches. */
const canEdit = (clickerId: string, ownerId: string) => clickerId === ownerId || isMJ(clickerId);

/** « (par @MJ) » quand quelqu'un d'autre que le joueur touche à la fiche. */
const byWhom = (clickerId: string, ownerId: string) => (clickerId === ownerId ? '' : ` (par <@${clickerId}>)`);

/** Modèle prérempli dont le nom correspond, s'il n'a pas déjà servi. */
const findTemplate = (nom: string) => {
    const key = Object.keys(pjTemplates).find(n => normalize(n) === normalize(nom));
    if (!key || Object.values(fiches).some(f => normalize(f.nom) === normalize(key))) return undefined;
    return pjTemplates[key];
};

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

const textInput = (id: string, label: string, value: string, max: number, required = true) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short)
            .setMaxLength(max).setRequired(required).setValue(value),
    );

const identityModal = (ownerId: string, f: Fiche) =>
    new ModalBuilder()
        .setCustomId(`fiche:identity:${ownerId}`)
        .setTitle('Profil')
        .addComponents(
            textInput('nom', 'Nom du personnage', f.nom, 80),
            textInput('clan', 'Clan', f.clan, 40),
            textInput('predation', 'Type de prédation', f.predation ?? '', 60, false),
            textInput('xp_total', 'Expérience gagnée (total)', String(f.xp?.total ?? 0), 5),
            textInput('xp_depense', 'Expérience dépensée', String(f.xp?.depense ?? 0), 5),
        );

const meritText = (r?: Record<string, number>) =>
    Object.entries(r ?? {}).map(([n, v]) => (v > 0 ? `${n} ${v}` : n)).join('\n');

/** « Splendide 4 », « Ressources : 2 », « Ennemi ●● » ou « Proie taboue » : une ligne par élément. */
const parseMerits = (text: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const m = line.match(/^(.*?)[\s:]*(\d+|●+)$/);
        const name = (m ? m[1] : line).trim();
        if (!name) continue;
        out[name] = m ? (/^\d+$/.test(m[2]) ? Math.min(Number(m[2]), 5) : m[2].length) : 0;
    }
    return out;
};

const meritsModal = (ownerId: string, f: Fiche) =>
    new ModalBuilder()
        .setCustomId(`fiche:merits:${ownerId}`)
        .setTitle('Avantages et handicaps')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId('avantages').setLabel('Avantages : un par ligne, « Nom points »')
                    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)
                    .setPlaceholder('Ressources 2\nSplendide 4').setValue(meritText(f.avantages)),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId('handicaps').setLabel('Handicaps : un par ligne, « Nom points »')
                    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)
                    .setPlaceholder('Ennemi 1\nProie taboue 1').setValue(meritText(f.handicaps)),
            ),
        );

/** Disciplines où choisir des pouvoirs : celles de la fiche, et celles des pouvoirs déjà connus. */
const powerDisciplines = (f: Fiche) =>
    [...new Set([...Object.keys(f.disciplines), ...knownPowers(f).map(p => p.discipline)])].sort((a, b) => a.localeCompare(b));

const powersPanel = (ownerId: string, notice = '') => {
    const f = fiches[ownerId];
    const list = powerDisciplines(f);
    if (list.length === 0) {
        return { content: `${notice ? `${notice}\n` : ''}✨ Aucune Discipline sur la fiche : ajoutez-en une avec « ✏️ Modifier… → Disciplines ».`, components: [] };
    }
    return {
        content: `${notice ? `${notice}\n` : ''}✨ **Pouvoirs connus** · ${f.nom} : choisissez une Discipline.`,
        components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`fiche:powdisc:${ownerId}`)
                    .setPlaceholder('Choisir une Discipline…')
                    .addOptions(list.slice(0, LIMITS.choices).map(n => ({
                        label: `${n} ${f.disciplines[n] ?? 0}`,
                        description: truncate(knownPowers(f).filter(p => p.discipline === n).map(p => p.pouvoir.nom).join(' · ') || 'Aucun pouvoir choisi', 100),
                        value: n,
                    }))),
            ),
        ],
    };
};

/** Choix multiple des pouvoirs d'une Discipline, jusqu'au niveau de la fiche (les pouvoirs déjà connus restent proposés). */
const powerPickPanel = (ownerId: string, discipline: string) => {
    const f = fiches[ownerId];
    const level = f.disciplines[discipline] ?? 0;
    const known = new Set(f.pouvoirs ?? []);
    const options = disciplines[discipline].pouvoirs.filter(p => p.niveau <= level || known.has(p.nom));
    if (options.length === 0) {
        return { content: `✨ ${discipline} ${level} : aucun pouvoir accessible à ce niveau.`, components: [] };
    }
    return {
        content: `✨ **${discipline} ${level}** · cochez les pouvoirs connus de ${f.nom}.`,
        components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`fiche:powset:${ownerId}:${discipline}`)
                    .setPlaceholder('Aucun pouvoir')
                    .setMinValues(0)
                    .setMaxValues(Math.min(options.length, LIMITS.choices))
                    .addOptions(options.slice(0, LIMITS.choices).map(p => ({
                        label: truncate(`${p.nom} (${p.niveau})`, 100),
                        description: truncate(`${p.cout} · ${p.jet}`, 100),
                        value: p.nom,
                        default: known.has(p.nom),
                    }))),
            ),
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`fiche:pouvoirs:${ownerId}`).setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
            ),
        ],
    };
};

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
        const template = nom ? findTemplate(nom) : undefined;
        if (!template && (!nom || !clan)) {
            return interaction.reply({ content: '📜 Pas encore de fiche : `/fiche nom: clan:` pour la créer.', flags: EPHEMERAL });
        }
        // Copie profonde : le modèle reste intact
        fiches[ownerId] = template ? JSON.parse(JSON.stringify(template)) : newFiche(nom!, clan!);
        saveFiches();
    }
    // Fiche neuve, ou fil supprimé : on (re)crée le fil ici
    await interaction.deferReply({ flags: EPHEMERAL });
    const thread = await createSheetThread(interaction.channel as TextChannel, ownerId, fiches[ownerId]);
    return interaction.editReply(f
        ? `✅ Nouveau fil pour la fiche : ${thread}.`
        : `✅ Fiche créée : ${thread}. Vérifiez-la, et corrigez avec le menu « ✏️ Modifier une valeur » sous la fiche.`);
};

export const fiche: Command = {
    data: new SlashCommandBuilder()
        .setName('fiche')
        .setDescription('Votre fiche de personnage : la crée (nom, clan) ou l\'ouvre')
        .addStringOption(o => o.setName('nom').setDescription('Création : nom du personnage (les fiches reprises de Roll20 sont proposées)').setMaxLength(80).setAutocomplete(true))
        .addStringOption(o =>
            o.setName('clan').setDescription('Création : clan')
                .addChoices(...Object.keys(clans).slice(0, LIMITS.choices).map(c => ({ name: c, value: c }))))
        .addUserOption(o => o.setName('joueur').setDescription('MJ : fiche d\'un joueur (la créer pour lui, ou l\'ouvrir)')),

    async autocomplete(interaction) {
        const q = normalize(interaction.options.getFocused());
        const free = Object.keys(pjTemplates).filter(n => findTemplate(n) && normalize(n).includes(q));
        await interaction.respond(free.slice(0, LIMITS.choices).map(n => ({ name: `📜 ${n} (fiche préremplie)`, value: n })));
    },

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
            const key = interaction.values[0];
            if (key === 'merits') return interaction.showModal(meritsModal(ownerId, f));
            if (key === 'pouvoirs') return interaction.reply({ ...powersPanel(ownerId), flags: EPHEMERAL });
            return interaction.reply({ ...groupPanel(ownerId, key), flags: EPHEMERAL });
        }
        if (action === 'pouvoirs') {
            return interaction.update(powersPanel(ownerId));
        }
        if (action === 'powdisc' && interaction.isStringSelectMenu()) {
            return interaction.update(powerPickPanel(ownerId, interaction.values[0]));
        }
        if (action === 'powset' && interaction.isStringSelectMenu()) {
            const discipline = rest.join(':');
            const inDiscipline = new Set(disciplines[discipline]?.pouvoirs.map(p => p.nom) ?? []);
            const before = (f.pouvoirs ?? []).filter(n => inDiscipline.has(n));
            const chosen = interaction.values;
            f.pouvoirs = [...(f.pouvoirs ?? []).filter(n => !inDiscipline.has(n)), ...chosen];
            saveFiches();
            const added = chosen.filter(n => !before.includes(n));
            const removed = before.filter(n => !chosen.includes(n));
            const text = [added.length ? `+ ${added.join(', ')}` : '', removed.length ? `− ${removed.join(', ')}` : ''].filter(Boolean).join(' · ');
            await interaction.update(powersPanel(ownerId, text ? `✅ ${discipline} : ${text}` : '✅ Rien n\'a changé.'));
            if (!text) return;
            await refreshSheet(client, ownerId);
            return logToSheet(client, ownerId, `✨ ${discipline} : ${text}${by}`);
        }
        if (action === 'roll' && interaction.isStringSelectMenu()) {
            // Le jet utilise la fiche de celui qui clique : seul le joueur lance ses pouvoirs
            if (interaction.user.id !== ownerId) {
                return interaction.reply({ content: '❌ Seul le joueur de cette fiche lance ses pouvoirs.', flags: EPHEMERAL });
            }
            const found = findPower(interaction.values[0]);
            if (!found) return interaction.reply({ content: '❌ Pouvoir introuvable.', flags: EPHEMERAL });
            await rollPower(interaction, found.discipline, found.pouvoir);
            // Remet le menu à zéro (sinon il reste sur le dernier pouvoir choisi)
            return refreshSheet(client, ownerId);
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
        const ownerId = arg;
        const f = fiches[ownerId];
        if (!f) return interaction.reply({ content: '❌ Cette fiche n\'existe plus.', flags: EPHEMERAL });
        if (!canEdit(interaction.user.id, ownerId)) {
            return interaction.reply({ content: '❌ C\'est la fiche d\'un autre joueur.', flags: EPHEMERAL });
        }
        const client = interaction.client;
        const by = byWhom(interaction.user.id, ownerId);
        const field = (id: string) => interaction.fields.getTextInputValue(id).trim();

        if (action === 'merits') {
            f.avantages = parseMerits(field('avantages'));
            f.handicaps = parseMerits(field('handicaps'));
            saveFiches();
            await interaction.reply({ content: '✅ Avantages et handicaps enregistrés.', flags: EPHEMERAL });
            await refreshSheet(client, ownerId);
            return logToSheet(client, ownerId, `🎭 Avantages et handicaps mis à jour${by}`);
        }

        if (action !== 'identity') return;
        const nom = field('nom');
        // Un clan connu reprend son orthographe officielle ; sinon on garde la saisie (clan maison…)
        const clan = findClan(field('clan')) ?? field('clan');
        const predation = field('predation');
        const total = Number(field('xp_total'));
        const depense = Number(field('xp_depense'));
        if (!Number.isInteger(total) || !Number.isInteger(depense) || total < 0 || depense < 0) {
            return interaction.reply({ content: '❌ L\'expérience doit être un nombre entier positif.', flags: EPHEMERAL });
        }
        const changes = [
            nom && nom !== f.nom ? `nom : ${f.nom} → ${nom}` : '',
            clan && clan !== f.clan ? `clan : ${f.clan} → ${clan}` : '',
            predation !== (f.predation ?? '') ? `prédation : ${predation || '—'}` : '',
            total !== (f.xp?.total ?? 0) || depense !== (f.xp?.depense ?? 0) ? `XP : ${total} gagnés, ${depense} dépensés` : '',
        ].filter(Boolean).join(', ');
        if (!changes) return interaction.reply({ content: 'Rien n\'a changé.', flags: EPHEMERAL });
        if (nom) f.nom = nom;
        if (clan) f.clan = clan;
        f.predation = predation || undefined;
        f.xp = { total, depense };
        saveFiches();
        await interaction.reply({ content: `✅ ${changes}`, flags: EPHEMERAL });
        if (nom && f.fil) {
            const thread = await client.channels.fetch(f.fil.threadId).catch(() => null);
            if (thread?.isThread()) await thread.setName(`📜 ${nom}`).catch(() => {});
        }
        await refreshSheet(client, ownerId);
        return logToSheet(client, ownerId, `✏️ ${changes}${by}`);
    },
};
