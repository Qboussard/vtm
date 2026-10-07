import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';
import { lieux, Pnj, pnjs, saveLieux, savePnjs } from '../data';
import { Command, isMJ } from '../types';
import { buttonRows, EPHEMERAL, isUrl, LIMITS, matches, normalize, shareButton, truncate } from '../util';

const STATUTS = ['Actif', 'Disparu', 'Torpeur', 'Mort', 'Inconnu'];
const NAME_MAX = 80; // garde de la place dans les customId (« pnj:delok: » + nom ≤ 100)

const isKnown = (p: Pnj) => p.connu !== false;
const canSee = (p: Pnj, userId: string) => isKnown(p) || isMJ(userId);

const statusColor = (statut: string) => {
    const s = normalize(statut);
    if (s.includes('mort')) return 0x2C2C2C;
    if (s.includes('dispar')) return 0x4B0082;
    if (s.includes('torpeur')) return 0x5C4033;
    if (s.includes('inconnu')) return 0x1A3A5C;
    return 0x8B0000;
};

const statusEmoji = (statut: string) => {
    const s = normalize(statut);
    if (s.includes('mort')) return '💀';
    if (s.includes('dispar')) return '❔';
    if (s.includes('torpeur')) return '💤';
    return '🧛';
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Retrouve la clé exacte d'un PNJ, sans tenir compte de la casse ni des accents. */
const findName = (nom: string): string | undefined =>
    pnjs[nom] ? nom : Object.keys(pnjs).find(n => normalize(n) === normalize(nom));

const publicEmbed = (nom: string, p: Pnj) => {
    const embed = new EmbedBuilder()
        .setTitle(`${statusEmoji(p.statut)} ${nom}`)
        .setColor(statusColor(p.statut));
    const infos: [string, string][] = [
        ['Clan', p.clan],
        ['Faction', p.faction],
        ['Rang', p.rang],
        ['Statut', capitalize(p.statut)],
    ];
    const fields = infos.filter(([, v]) => v).map(([name, value]) => ({ name, value: truncate(value, LIMITS.embedField), inline: true }));
    if (fields.length > 0) embed.addFields(fields);
    if (p.description) embed.setDescription(truncate(p.description, LIMITS.embedDescription));
    if (isUrl(p.image)) embed.setImage(p.image);
    return embed;
};

const mjEmbed = (p: Pnj) =>
    new EmbedBuilder()
        .setTitle('🔒 Notes MJ')
        .setColor(0x1A1A1A)
        .setDescription(truncate(p.description_mj || '*Aucune note.*', LIMITS.embedDescription))
        .setFooter({ text: isKnown(p) ? 'Connu des joueurs' : 'Inconnu des joueurs : /pnj montrer pour le révéler' });

/** Un bouton par relation visible ; un clic ouvre la fiche du PNJ lié. */
const relationButtons = (p: Pnj, viewerIsMJ: boolean) =>
    p.relations
        .filter(r => pnjs[r] && (viewerIsMJ || isKnown(pnjs[r])))
        .filter(r => `pnj:open:${r}`.length <= LIMITS.customId)
        .map(r => new ButtonBuilder()
            .setCustomId(`pnj:open:${r}`)
            .setLabel(truncate(r, LIMITS.label))
            .setEmoji('🔗')
            .setStyle(ButtonStyle.Secondary));

/** Fiche privée : notes MJ si besoin, relations et bouton de partage. */
const privateSheet = (nom: string, userId: string) => {
    const p = pnjs[nom];
    const mj = isMJ(userId);
    const embeds = [publicEmbed(nom, p)];
    if (mj) embeds.push(mjEmbed(p));
    return {
        embeds,
        components: [
            ...buttonRows(relationButtons(p, mj), 4),
            new ActionRowBuilder<ButtonBuilder>().addComponents(shareButton(`pnj:share:${nom}`)),
        ],
        flags: EPHEMERAL,
    } as const;
};

/** Fiche publique : seules les relations connues des joueurs apparaissent. */
const publicSheet = (nom: string) => ({
    embeds: [publicEmbed(nom, pnjs[nom])],
    components: buttonRows(relationButtons(pnjs[nom], false), 5),
});

const reveal = (nom: string) => {
    if (!isKnown(pnjs[nom])) {
        pnjs[nom].connu = true;
        savePnjs();
    }
};

/** Renomme (ou supprime si `to` est null) un PNJ dans les relations et les lieux. */
const updateReferences = (from: string, to: string | null) => {
    for (const p of Object.values(pnjs)) {
        p.relations = p.relations
            .map(r => (r === from ? to : r))
            .filter((r, i, arr): r is string => r !== null && arr.indexOf(r) === i);
    }
    let lieuxChanged = false;
    for (const l of Object.values(lieux)) {
        if (!l.pnj_lies?.includes(from)) continue;
        l.pnj_lies = l.pnj_lies.map(n => (n === from ? to : n)).filter((n): n is string => n !== null);
        lieuxChanged = true;
    }
    if (lieuxChanged) saveLieux();
};

const denyIfNotMJ = async (interaction: ChatInputCommandInteraction): Promise<boolean> => {
    if (isMJ(interaction.user.id)) return false;
    await interaction.reply({ content: '❌ Réservé aux MJ.', flags: EPHEMERAL });
    return true;
};

const nameOption = (o: import('discord.js').SlashCommandStringOption) =>
    o.setName('nom').setDescription('Nom du PNJ').setRequired(true).setAutocomplete(true);

const statutChoices = STATUTS.map(s => ({ name: s, value: s }));

export const pnj: Command = {
    data: new SlashCommandBuilder()
        .setName('pnj')
        .setDescription('Personnages non-joueurs')
        .addSubcommand(sub =>
            sub.setName('voir')
                .setDescription("Ouvre la fiche d'un PNJ (privé par défaut)")
                .addStringOption(nameOption)
                .addBooleanOption(o => o.setName('public').setDescription('Afficher pour toute la table')))
        .addSubcommand(sub =>
            sub.setName('montrer')
                .setDescription('Montre un PNJ à la table et le rend connu des joueurs (MJ)')
                .addStringOption(nameOption)
                .addBooleanOption(o => o.setName('photo_seule').setDescription('Uniquement le nom et le portrait')))
        .addSubcommand(sub =>
            sub.setName('liste')
                .setDescription('Galerie des PNJ')
                .addStringOption(o => o.setName('faction').setDescription('Filtrer par faction'))
                .addStringOption(o => o.setName('clan').setDescription('Filtrer par clan'))
                .addBooleanOption(o => o.setName('public').setDescription('Afficher pour toute la table')))
        .addSubcommand(sub =>
            sub.setName('ajouter')
                .setDescription('Ajoute un PNJ (MJ)')
                .addStringOption(o => o.setName('nom').setDescription('Nom du PNJ').setRequired(true).setMaxLength(NAME_MAX))
                .addStringOption(o => o.setName('clan').setDescription('Clan'))
                .addStringOption(o => o.setName('faction').setDescription('Faction'))
                .addStringOption(o => o.setName('rang').setDescription('Rang ou titre'))
                .addStringOption(o => o.setName('statut').setDescription('Statut (Actif par défaut)').addChoices(...statutChoices))
                .addStringOption(o => o.setName('description').setDescription('Description publique'))
                .addStringOption(o => o.setName('image').setDescription("URL de l'image (https://…)"))
                .addBooleanOption(o => o.setName('connu').setDescription('Déjà connu des joueurs (non par défaut)')))
        .addSubcommand(sub =>
            sub.setName('modifier')
                .setDescription('Modifie un PNJ (MJ)')
                .addStringOption(nameOption)
                .addStringOption(o => o.setName('nouveau_nom').setDescription('Renommer le PNJ').setMaxLength(NAME_MAX))
                .addStringOption(o => o.setName('clan').setDescription('Clan'))
                .addStringOption(o => o.setName('faction').setDescription('Faction'))
                .addStringOption(o => o.setName('rang').setDescription('Rang ou titre'))
                .addStringOption(o => o.setName('statut').setDescription('Statut').addChoices(...statutChoices))
                .addStringOption(o => o.setName('description').setDescription('Description publique'))
                .addStringOption(o => o.setName('image').setDescription("URL de l'image (https://…)"))
                .addBooleanOption(o => o.setName('connu').setDescription('Connu des joueurs'))
                .addStringOption(o => o.setName('relation_ajouter').setDescription('Ajouter une relation').setAutocomplete(true))
                .addStringOption(o => o.setName('relation_retirer').setDescription('Retirer une relation').setAutocomplete(true)))
        .addSubcommand(sub =>
            sub.setName('secret')
                .setDescription("Remplace les notes secrètes d'un PNJ (MJ)")
                .addStringOption(nameOption)
                .addStringOption(o => o.setName('texte').setDescription('Notes secrètes MJ').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('supprimer')
                .setDescription('Supprime un PNJ (MJ)')
                .addStringOption(nameOption)),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        const userId = interaction.user.id;
        const mj = isMJ(userId);
        let names: string[];

        if (focused.name === 'relation_retirer') {
            const current = findName(interaction.options.getString('nom') ?? '');
            names = current ? pnjs[current].relations : [];
        } else if (focused.name === 'relation_ajouter') {
            const current = findName(interaction.options.getString('nom') ?? '');
            names = Object.keys(pnjs).filter(n => n !== current && !(current && pnjs[current].relations.includes(n)));
        } else {
            names = Object.keys(pnjs).filter(n => canSee(pnjs[n], userId));
        }

        const filtered = names.filter(n => matches(n, focused.value)).slice(0, LIMITS.choices);
        await interaction.respond(filtered.map(n => {
            const p = pnjs[n];
            const details = p ? [p.clan, mj && !isKnown(p) ? '🔒 inconnu' : ''].filter(Boolean).join(' · ') : '';
            return { name: truncate(details ? `${n} · ${details}` : n, LIMITS.choiceName), value: n };
        }));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const opt = (name: string) => interaction.options.getString(name)?.trim() ?? null;

        if (sub === 'liste') {
            const isPublic = interaction.options.getBoolean('public') ?? false;
            const faction = opt('faction');
            const clan = opt('clan');
            // En public, on ne montre jamais les PNJ inconnus, même si c'est un MJ qui liste.
            const names = Object.keys(pnjs)
                .filter(n => (isPublic ? isKnown(pnjs[n]) : canSee(pnjs[n], userId)))
                .filter(n => !faction || matches(pnjs[n].faction, faction))
                .filter(n => !clan || matches(pnjs[n].clan, clan))
                .sort((a, b) => a.localeCompare(b, 'fr'));

            if (names.length === 0) {
                return interaction.reply({ content: 'Aucun PNJ ne correspond.', flags: EPHEMERAL });
            }

            const byFaction = new Map<string, string[]>();
            for (const n of names) {
                const p = pnjs[n];
                const line = `${statusEmoji(p.statut)} **${n}**${p.clan ? ` · ${p.clan}` : ''}${p.rang ? ` · ${p.rang}` : ''}${isKnown(p) ? '' : ' 🔒'}`;
                const key = p.faction || 'Sans faction';
                byFaction.set(key, [...(byFaction.get(key) ?? []), line]);
            }
            const description = [...byFaction.entries()]
                .map(([f, lines]) => `__**${f}**__\n${lines.join('\n')}`)
                .join('\n\n');

            const embed = new EmbedBuilder()
                .setTitle(`📋 PNJ de la campagne · ${names.length}`)
                .setColor(0x8B0000)
                .setDescription(truncate(description, LIMITS.embedDescription));
            if (names.length > LIMITS.choices) {
                embed.setFooter({ text: `Le menu affiche les ${LIMITS.choices} premiers : filtrez par faction ou clan.` });
            }
            const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('pnj:pick')
                    .setPlaceholder('Ouvrir une fiche')
                    .addOptions(names.slice(0, LIMITS.choices).map(n => ({
                        label: truncate(n, 100),
                        description: truncate([pnjs[n].clan, pnjs[n].faction].filter(Boolean).join(' · ') || '—', 100),
                        value: n,
                    }))),
            );
            return interaction.reply({ embeds: [embed], components: [menu], ...(isPublic ? {} : { flags: EPHEMERAL }) });
        }

        if (sub === 'ajouter') {
            if (await denyIfNotMJ(interaction)) return;
            const nom = opt('nom')!;
            const existing = findName(nom);
            if (existing) {
                return interaction.reply({ content: `❌ Un PNJ nommé « ${existing} » existe déjà.`, flags: EPHEMERAL });
            }
            const image = opt('image') ?? '';
            if (image && !isUrl(image)) {
                return interaction.reply({ content: "❌ L'image doit être une URL commençant par http:// ou https://.", flags: EPHEMERAL });
            }
            pnjs[nom] = {
                clan: opt('clan') ?? '',
                faction: opt('faction') ?? '',
                rang: opt('rang') ?? '',
                statut: opt('statut') ?? 'Actif',
                description: opt('description') ?? '',
                description_mj: '',
                image,
                relations: [],
                connu: interaction.options.getBoolean('connu') ?? false,
            };
            savePnjs();
            const sheet = privateSheet(nom, userId);
            return interaction.reply({ ...sheet, content: `✅ PNJ **${nom}** ajouté.` });
        }

        // Toutes les autres sous-commandes portent sur un PNJ existant
        const nom = findName(opt('nom') ?? '');
        if (!nom || !canSee(pnjs[nom], userId)) {
            return interaction.reply({ content: `❌ PNJ « ${opt('nom')} » introuvable.`, flags: EPHEMERAL });
        }
        const p = pnjs[nom];

        if (sub === 'voir') {
            if (!interaction.options.getBoolean('public')) {
                return interaction.reply(privateSheet(nom, userId));
            }
            reveal(nom);
            await interaction.reply(publicSheet(nom));
            if (isMJ(userId) && p.description_mj) {
                await interaction.followUp({ embeds: [mjEmbed(p)], flags: EPHEMERAL });
            }
            return;
        }

        if (sub === 'montrer') {
            if (await denyIfNotMJ(interaction)) return;
            reveal(nom);
            if (interaction.options.getBoolean('photo_seule') && isUrl(p.image)) {
                const embed = new EmbedBuilder().setTitle(nom).setColor(statusColor(p.statut)).setImage(p.image);
                return interaction.reply({ embeds: [embed] });
            }
            return interaction.reply(publicSheet(nom));
        }

        if (sub === 'secret') {
            if (await denyIfNotMJ(interaction)) return;
            p.description_mj = opt('texte') ?? '';
            savePnjs();
            return interaction.reply({ content: `✅ Notes secrètes de **${nom}** mises à jour.`, flags: EPHEMERAL });
        }

        if (sub === 'supprimer') {
            if (await denyIfNotMJ(interaction)) return;
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`pnj:delok:${nom}`).setLabel('Supprimer').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('pnj:delno').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
            );
            return interaction.reply({
                content: `⚠️ Supprimer définitivement **${nom}** ? Il sera aussi retiré des relations et des lieux.`,
                components: [row],
                flags: EPHEMERAL,
            });
        }

        if (sub === 'modifier') {
            if (await denyIfNotMJ(interaction)) return;
            const changes: string[] = [];
            const errors: string[] = [];

            for (const field of ['clan', 'faction', 'rang', 'statut', 'description'] as const) {
                const value = opt(field);
                if (value !== null) {
                    p[field] = value;
                    changes.push(field);
                }
            }

            const image = opt('image');
            if (image !== null) {
                if (image && !isUrl(image)) errors.push("l'image doit être une URL http(s)");
                else { p.image = image; changes.push('image'); }
            }

            const connu = interaction.options.getBoolean('connu');
            if (connu !== null) { p.connu = connu; changes.push(connu ? 'connu' : 'inconnu'); }

            const toAdd = opt('relation_ajouter');
            if (toAdd !== null) {
                const target = findName(toAdd);
                if (!target) errors.push(`PNJ « ${toAdd} » introuvable`);
                else if (target === nom) errors.push('un PNJ ne peut pas être en relation avec lui-même');
                else if (!p.relations.includes(target)) { p.relations.push(target); changes.push(`+ relation ${target}`); }
            }

            const toRemove = opt('relation_retirer');
            if (toRemove !== null) {
                const before = p.relations.length;
                p.relations = p.relations.filter(r => normalize(r) !== normalize(toRemove));
                if (p.relations.length < before) changes.push(`− relation ${toRemove}`);
                else errors.push(`« ${toRemove} » n'est pas dans les relations`);
            }

            let finalName = nom;
            const newName = opt('nouveau_nom');
            if (newName !== null && newName !== nom) {
                const clash = findName(newName);
                if (clash && clash !== nom) errors.push(`un PNJ nommé « ${clash} » existe déjà`);
                else {
                    delete pnjs[nom];
                    pnjs[newName] = p;
                    updateReferences(nom, newName);
                    finalName = newName;
                    changes.push(`renommé en ${newName}`);
                }
            }

            if (changes.length > 0) savePnjs();
            const summary = [
                changes.length > 0 ? `✅ **${finalName}** modifié : ${changes.join(', ')}.` : 'ℹ️ Aucune modification.',
                ...errors.map(e => `⚠️ ${e}`),
            ].join('\n');
            return interaction.reply({ ...privateSheet(finalName, userId), content: truncate(summary, LIMITS.message) });
        }
    },

    async component(interaction, action, arg) {
        const userId = interaction.user.id;

        if (action === 'open' || action === 'pick') {
            const nom = action === 'pick' && interaction.isStringSelectMenu() ? interaction.values[0] : arg;
            if (!pnjs[nom] || !canSee(pnjs[nom], userId)) {
                return interaction.reply({ content: '❌ PNJ introuvable.', flags: EPHEMERAL });
            }
            return interaction.reply(privateSheet(nom, userId));
        }

        if (action === 'share') {
            if (!pnjs[arg] || !canSee(pnjs[arg], userId)) {
                return interaction.reply({ content: '❌ PNJ introuvable.', flags: EPHEMERAL });
            }
            reveal(arg);
            return interaction.reply({ ...publicSheet(arg), content: `📣 Partagé par **${interaction.user.displayName}**` });
        }

        if (action === 'delok') {
            if (!isMJ(userId)) return interaction.reply({ content: '❌ Réservé aux MJ.', flags: EPHEMERAL });
            if (!pnjs[arg]) return interaction.update({ content: '❌ Ce PNJ a déjà été supprimé.', components: [] });
            delete pnjs[arg];
            updateReferences(arg, null);
            savePnjs();
            return interaction.update({ content: `🗑️ **${arg}** supprimé.`, components: [] });
        }

        if (action === 'delno') {
            return interaction.update({ content: 'Suppression annulée.', components: [] });
        }
    },
};
