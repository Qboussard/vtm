import * as fs from 'fs';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    SlashCommandBuilder,
    SlashCommandStringOption,
    StringSelectMenuBuilder,
} from 'discord.js';
import { Pnj, pnjs, savePnjs, Visibilite, visibilityOf } from '../data';
import { notionEnabled, portraitPath, setVisibilityInNotion, syncPnjs, syncSessions } from '../notion';
import { Command, isMJ } from '../types';
import { buttonRows, EPHEMERAL, isUrl, LIMITS, matches, normalize, shareButton, truncate } from '../util';

// Ce que les joueurs voient : rien, le nom et la photo, ou toute la fiche.
const LEVELS: Visibilite[] = ['cache', 'photo', 'complet'];
const LEVEL_LABELS: Record<Visibilite, string> = {
    cache: '🔒 Caché aux joueurs',
    photo: '📷 Photo seule pour les joueurs',
    complet: '👁️ Fiche complète pour les joueurs',
};
const canSee = (p: Pnj, userId: string) => visibilityOf(p) !== 'cache' || isMJ(userId);

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

/** Portrait : fichier téléchargé depuis Notion (joint au message) ou lien externe. */
const portrait = (p: Pnj): { url?: string; files: AttachmentBuilder[] } => {
    if (p.portrait && fs.existsSync(portraitPath(p.portrait))) {
        return { url: `attachment://${p.portrait}`, files: [new AttachmentBuilder(portraitPath(p.portrait), { name: p.portrait })] };
    }
    return { url: isUrl(p.image) ? p.image : undefined, files: [] };
};

const buildEmbed = (nom: string, p: Pnj, imageUrl?: string) => {
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
    // La partie joueurs de la page (hors sections 🔒), à défaut la colonne « Description publique »
    const text = p.description_joueurs || p.description;
    if (text) embed.setDescription(truncate(text, LIMITS.embedDescription));
    if (imageUrl) embed.setImage(imageUrl);
    return embed;
};

const mjEmbed = (p: Pnj) =>
    new EmbedBuilder()
        .setTitle('🔒 Notes MJ')
        .setColor(0x1A1A1A)
        .setDescription(truncate(p.description_mj || '*Aucune note.*', LIMITS.embedDescription))
        .setFooter({ text: `${LEVEL_LABELS[visibilityOf(p)]} · /pnj montrer pour révéler` });

/** Nom et portrait seulement : pour un PNJ croisé mais pas encore joué. */
const photoEmbed = (nom: string, imageUrl?: string) => {
    const embed = new EmbedBuilder().setTitle(nom).setColor(0x2C2F33);
    if (imageUrl) embed.setImage(imageUrl);
    else embed.setDescription('*Vous n\'en savez pas plus.*');
    return embed;
};

/** La fiche telle que les joueurs ont le droit de la voir. */
const playerEmbed = (nom: string, p: Pnj, imageUrl?: string) =>
    visibilityOf(p) === 'complet' ? buildEmbed(nom, p, imageUrl) : photoEmbed(nom, imageUrl);

/** Un bouton par PNJ lié (mentionné dans les notes) : réservé aux MJ, ces liens sont des secrets. */
const relationButtons = (p: Pnj) =>
    p.relations
        .filter(r => pnjs[r] && `pnj:open:${r}`.length <= LIMITS.customId)
        .map(r => new ButtonBuilder()
            .setCustomId(`pnj:open:${r}`)
            .setLabel(truncate(r, LIMITS.label))
            .setEmoji('🔗')
            .setStyle(ButtonStyle.Secondary));

/** Fiche privée : notes et liens pour les MJ, bouton de partage pour tous. */
const privateSheet = (nom: string, userId: string) => {
    const p = pnjs[nom];
    const mj = isMJ(userId);
    const { url, files } = portrait(p);
    return {
        embeds: mj ? [buildEmbed(nom, p, url), mjEmbed(p)] : [playerEmbed(nom, p, url)],
        files,
        components: [
            ...(mj ? buttonRows(relationButtons(p), 4) : []),
            new ActionRowBuilder<ButtonBuilder>().addComponents(shareButton(`pnj:share:${nom}`)),
        ],
        flags: EPHEMERAL,
    } as const;
};

/** Fiche publique : uniquement ce que les joueurs peuvent savoir. */
const publicSheet = (nom: string) => {
    const p = pnjs[nom];
    const { url, files } = portrait(p);
    return { embeds: [playerEmbed(nom, p, url)], files };
};

/** Monte la visibilité d'un PNJ (jamais vers le bas) et la reporte dans Notion. */
const reveal = (nom: string, to: Visibilite) => {
    const p = pnjs[nom];
    if (LEVELS.indexOf(visibilityOf(p)) >= LEVELS.indexOf(to)) return;
    p.visibilite = to;
    savePnjs();
    if (p.notion_id) {
        setVisibilityInNotion(p.notion_id, to).catch(error => console.error(`❌ Impossible de mettre à jour la visibilité de ${nom} dans Notion :`, error));
    }
};

const nameOption = (o: SlashCommandStringOption) =>
    o.setName('nom').setDescription('Nom du PNJ').setRequired(true).setAutocomplete(true);

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
                .setDescription('Montre un PNJ à la table et le révèle aux joueurs (MJ)')
                .addStringOption(nameOption)
                .addBooleanOption(o => o.setName('photo_seule').setDescription('Révéler seulement le nom et le portrait')))
        .addSubcommand(sub =>
            sub.setName('liste')
                .setDescription('Galerie des PNJ')
                .addStringOption(o => o.setName('faction').setDescription('Filtrer par faction'))
                .addStringOption(o => o.setName('clan').setDescription('Filtrer par clan'))
                .addBooleanOption(o => o.setName('public').setDescription('Afficher pour toute la table')))
        .addSubcommand(sub =>
            sub.setName('sync')
                .setDescription('Recharge les PNJ et les séances depuis Notion (MJ)')),

    async autocomplete(interaction) {
        const value = interaction.options.getFocused();
        const userId = interaction.user.id;
        const mj = isMJ(userId);
        const names = Object.keys(pnjs)
            .filter(n => canSee(pnjs[n], userId) && matches(n, value))
            .sort((a, b) => a.localeCompare(b, 'fr'))
            .slice(0, LIMITS.choices);
        await interaction.respond(names.map(n => {
            const level = visibilityOf(pnjs[n]);
            const details = mj
                ? [pnjs[n].clan, level === 'cache' ? '🔒 caché' : level === 'photo' ? '📷 photo seule' : ''].filter(Boolean).join(' · ')
                : level === 'complet' ? pnjs[n].clan : '';
            return { name: truncate(details ? `${n} · ${details}` : n, LIMITS.choiceName), value: n };
        }));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (sub === 'sync') {
            if (!isMJ(userId)) return interaction.reply({ content: '❌ Réservé aux MJ.', flags: EPHEMERAL });
            if (!notionEnabled) {
                return interaction.reply({ content: '❌ Notion n\'est pas configuré (NOTION_TOKEN / NOTION_DATABASE_ID).', flags: EPHEMERAL });
            }
            await interaction.deferReply({ flags: EPHEMERAL });
            const r = await syncPnjs();
            const seances = await syncSessions().catch(() => null);
            const errors = r.errors.length ? `\n⚠️ ${r.errors.join('\n⚠️ ')}` : '';
            const s = seances === null ? '' : ` ${seances} séance(s).`;
            return interaction.editReply(truncate(`🔄 ${r.total} PNJ synchronisés depuis Notion, ${r.updated} mis à jour.${s}${errors}`, LIMITS.message));
        }

        if (sub === 'liste') {
            const isPublic = interaction.options.getBoolean('public') ?? false;
            const faction = interaction.options.getString('faction');
            const clan = interaction.options.getString('clan');
            // Vue MJ privée : tout. Sinon (joueur, ou liste publique) : seulement ce que les joueurs savent.
            const fullView = isMJ(userId) && !isPublic;
            const showsAll = (p: Pnj) => fullView || visibilityOf(p) === 'complet';
            const names = Object.keys(pnjs)
                .filter(n => fullView || visibilityOf(pnjs[n]) !== 'cache')
                // Les filtres ne portent que sur des infos visibles, pour ne rien laisser deviner
                .filter(n => !faction || (showsAll(pnjs[n]) && matches(pnjs[n].faction, faction)))
                .filter(n => !clan || (showsAll(pnjs[n]) && matches(pnjs[n].clan, clan)))
                .sort((a, b) => a.localeCompare(b, 'fr'));

            if (names.length === 0) {
                return interaction.reply({ content: 'Aucun PNJ ne correspond.', flags: EPHEMERAL });
            }

            const byFaction = new Map<string, string[]>();
            for (const n of names) {
                const p = pnjs[n];
                const level = visibilityOf(p);
                const marker = fullView && level !== 'complet' ? (level === 'cache' ? ' 🔒' : ' 📷') : '';
                const line = showsAll(p)
                    ? `${statusEmoji(p.statut)} **${n}**${p.clan ? ` · ${p.clan}` : ''}${p.rang ? ` · ${p.rang}` : ''}${marker}`
                    : `📷 **${n}**`;
                const key = showsAll(p) ? p.faction || 'Sans faction' : 'Visages croisés';
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
                        description: truncate((showsAll(pnjs[n]) && [pnjs[n].clan, pnjs[n].faction].filter(Boolean).join(' · ')) || '—', 100),
                        value: n,
                    }))),
            );
            return interaction.reply({ embeds: [embed], components: [menu], ...(isPublic ? {} : { flags: EPHEMERAL }) });
        }

        const input = interaction.options.getString('nom', true);
        const nom = findName(input);
        if (!nom || !canSee(pnjs[nom], userId)) {
            return interaction.reply({ content: `❌ PNJ « ${input} » introuvable.`, flags: EPHEMERAL });
        }

        if (sub === 'voir') {
            if (!interaction.options.getBoolean('public')) {
                return interaction.reply(privateSheet(nom, userId));
            }
            reveal(nom, 'photo');
            await interaction.reply(publicSheet(nom));
            if (isMJ(userId) && pnjs[nom].description_mj) {
                await interaction.followUp({ embeds: [mjEmbed(pnjs[nom])], flags: EPHEMERAL });
            }
            return;
        }

        if (sub === 'montrer') {
            if (!isMJ(userId)) return interaction.reply({ content: '❌ Réservé aux MJ.', flags: EPHEMERAL });
            reveal(nom, interaction.options.getBoolean('photo_seule') ? 'photo' : 'complet');
            return interaction.reply(publicSheet(nom));
        }
    },

    async component(interaction, action, arg) {
        const userId = interaction.user.id;
        const nom = action === 'pick' && interaction.isStringSelectMenu() ? interaction.values[0] : arg;
        if (!pnjs[nom] || !canSee(pnjs[nom], userId)) {
            return interaction.reply({ content: '❌ PNJ introuvable.', flags: EPHEMERAL });
        }

        if (action === 'open' || action === 'pick') {
            return interaction.reply(privateSheet(nom, userId));
        }

        if (action === 'share') {
            reveal(nom, 'photo');
            return interaction.reply({ ...publicSheet(nom), content: `📣 Partagé par **${interaction.user.displayName}**` });
        }
    },
};
