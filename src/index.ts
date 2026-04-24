import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

if (!process.env.BOT_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID || !process.env.SUPER_MJ_ID) {
    throw new Error("BOT_TOKEN, CLIENT_ID, GUILD_ID ou SUPER_MJ_ID manquant dans le fichier .env");
}

const SUPER_MJ_ID = process.env.SUPER_MJ_ID as string;

// Chargement des fichiers JSON
const dataDir = path.join(__dirname, '..', 'src');
const rulesPath = path.join(dataDir, 'rules.json');
const lorePath = path.join(dataDir, 'lore.json');
const pnjPath = path.join(dataDir, 'pnj.json');
const lieuxPath = path.join(dataDir, 'lieux.json');
const sessionsPath = path.join(dataDir, 'sessions.json');
const configPath = path.join(dataDir, 'config.json');

interface Session {
    numero: number;
    titre: string;
    date: string;
    resume: string;
    notes_mj: string;
}

let rules: any = {};
let lores: any = {};
let pnjs: Record<string, any> = {};
let lieux: Record<string, any> = {};
let sessions: Session[] = [];
let config: { mj_ids: string[] } = { mj_ids: [] };

try {
    rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    lores = JSON.parse(fs.readFileSync(lorePath, 'utf-8'));
    pnjs = JSON.parse(fs.readFileSync(pnjPath, 'utf-8'));
    lieux = JSON.parse(fs.readFileSync(lieuxPath, 'utf-8'));
    sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    console.log("✅ Fichiers chargés !");
} catch (error) {
    console.error("❌ Erreur lors de la lecture des fichiers JSON :", error);
}

const saveConfig = () => fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
const savePnjs = () => fs.writeFileSync(pnjPath, JSON.stringify(pnjs, null, 2), 'utf-8');
const saveLieux = () => fs.writeFileSync(lieuxPath, JSON.stringify(lieux, null, 2), 'utf-8');
const saveSessions = () => fs.writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2), 'utf-8');

const isMJ = (userId: string): boolean =>
    userId === SUPER_MJ_ID || config.mj_ids.includes(userId);

const RULE_COLOR = 0x8B0000;

const buildRuleEmbed = (category: string, subcategory: string, content: string) =>
    new EmbedBuilder()
        .setTitle(`📖 ${subcategory}`)
        .setDescription(content)
        .setColor(RULE_COLOR)
        .setFooter({ text: category });

const searchRules = (query: string, rulesObj: any): { category: string; subcategory: string; content: string }[] => {
    const results: { category: string; subcategory: string; content: string }[] = [];
    const q = query.toLowerCase();
    for (const category in rulesObj) {
        if (category === 'Disciplines') continue;
        for (const subcategory in rulesObj[category]) {
            const content = rulesObj[category][subcategory];
            if (
                subcategory.toLowerCase().includes(q) ||
                category.toLowerCase().includes(q) ||
                (typeof content === 'string' && content.toLowerCase().includes(q))
            ) {
                results.push({ category, subcategory, content });
            }
        }
    }
    return results;
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ],
});

const commands = [
    new SlashCommandBuilder()
        .setName('regle')
        .setDescription('Consulter les règles du jeu')
        .addSubcommand(sub =>
            sub.setName('voir')
                .setDescription('Affiche une règle spécifique')
                .addStringOption(o =>
                    o.setName('categorie').setDescription('Catégorie').setRequired(true).setAutocomplete(true))
                .addStringOption(o =>
                    o.setName('sous_categorie').setDescription('Sous-catégorie').setRequired(true).setAutocomplete(true)))
        .addSubcommand(sub =>
            sub.setName('chercher')
                .setDescription('Recherche dans toutes les règles')
                .addStringOption(o =>
                    o.setName('mot_cle').setDescription('Mot-clé à rechercher').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('liste')
                .setDescription('Liste toutes les catégories et règles disponibles'))
        .addSubcommand(sub =>
            sub.setName('discipline')
                .setDescription("Affiche les détails d'une discipline")
                .addStringOption(o =>
                    o.setName('nom').setDescription('Nom de la discipline').setRequired(true).setAutocomplete(true))),
    new SlashCommandBuilder()
        .setName('lore')
        .setDescription('Affiche un lore spécifique')
        .addStringOption(option =>
            option.setName('categorie')
                .setDescription('Catégorie de lore')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(option =>
            option.setName('sous_categorie')
                .setDescription('Sous-catégorie de lore')
                .setRequired(true)
                .setAutocomplete(true)),
    new SlashCommandBuilder()
        .setName('pnj')
        .setDescription('Gestion des personnages non-joueurs')
        .addSubcommand(sub =>
            sub.setName('voir')
                .setDescription('Affiche la fiche d\'un PNJ')
                .addStringOption(option =>
                    option.setName('nom')
                        .setDescription('Nom du PNJ')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(sub =>
            sub.setName('ajouter')
                .setDescription('Ajoute un nouveau PNJ (MJ uniquement)')
                .addStringOption(o => o.setName('nom').setDescription('Nom du PNJ').setRequired(true))
                .addStringOption(o => o.setName('clan').setDescription('Clan').setRequired(true))
                .addStringOption(o => o.setName('faction').setDescription('Faction').setRequired(true))
                .addStringOption(o => o.setName('rang').setDescription('Rang ou titre').setRequired(false))
                .addStringOption(o => o.setName('description').setDescription('Description publique').setRequired(false))
                .addStringOption(o => o.setName('image').setDescription('URL de l\'image').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('secret')
                .setDescription('Ajoute/modifie les notes secrètes d\'un PNJ (MJ uniquement)')
                .addStringOption(option =>
                    option.setName('nom')
                        .setDescription('Nom du PNJ')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addStringOption(option =>
                    option.setName('texte')
                        .setDescription('Notes secrètes MJ')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('liste')
                .setDescription('Liste tous les PNJ')),
    new SlashCommandBuilder()
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
    new SlashCommandBuilder()
        .setName('lieu')
        .setDescription('Gestion des lieux de la campagne')
        .addSubcommand(sub =>
            sub.setName('voir')
                .setDescription('Affiche la fiche d\'un lieu')
                .addStringOption(option =>
                    option.setName('nom')
                        .setDescription('Nom du lieu')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(sub =>
            sub.setName('ajouter')
                .setDescription('Ajoute un nouveau lieu (MJ uniquement)')
                .addStringOption(o => o.setName('nom').setDescription('Nom du lieu').setRequired(true))
                .addStringOption(o => o.setName('type').setDescription('Type de lieu (bar, église, elysium...)').setRequired(false))
                .addStringOption(o => o.setName('quartier').setDescription('Quartier ou zone').setRequired(false))
                .addStringOption(o => o.setName('description').setDescription('Description publique').setRequired(false))
                .addStringOption(o => o.setName('image').setDescription('URL de l\'image').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('secret')
                .setDescription('Ajoute/modifie les notes secrètes d\'un lieu (MJ uniquement)')
                .addStringOption(option =>
                    option.setName('nom')
                        .setDescription('Nom du lieu')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addStringOption(option =>
                    option.setName('texte')
                        .setDescription('Notes secrètes MJ')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('liste')
                .setDescription('Liste tous les lieux')),
    new SlashCommandBuilder()
        .setName('session')
        .setDescription('Journal des sessions de campagne')
        .addSubcommand(sub =>
            sub.setName('ajouter')
                .setDescription('Ajoute un résumé de session (MJ uniquement)')
                .addStringOption(o => o.setName('titre').setDescription('Titre de la session').setRequired(true))
                .addStringOption(o => o.setName('resume').setDescription('Résumé public de la session').setRequired(true))
                .addStringOption(o => o.setName('notes_mj').setDescription('Notes privées MJ').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('voir')
                .setDescription('Affiche une session')
                .addIntegerOption(o => o.setName('numero').setDescription('Numéro de session').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('derniere')
                .setDescription('Affiche la dernière session'))
        .addSubcommand(sub =>
            sub.setName('liste')
                .setDescription('Liste toutes les sessions')),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN as string);

(async () => {
    try {
        console.log('🔄 Déploiement des commandes slash...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID as string, process.env.GUILD_ID as string),
            { body: commands }
        );
        console.log('✅ Commandes déployées !');
    } catch (error) {
        console.error('❌ Erreur lors du déploiement des commandes :', error);
    }
})();


client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) {
        const focusedOption = interaction.options.getFocused(true);
        const command = interaction.commandName;
        const selectedCategory = interaction.options.getString('categorie');
        const source = command === 'lore' ? lores : rules;

        if (focusedOption.name === 'categorie') {
            const categories = Object.keys(source);
            const filtered = categories.filter(c =>
                c.toLowerCase().includes(focusedOption.value.toLowerCase())
            );
            return await interaction.respond(filtered.map(c => ({ name: c, value: c })));
        }

        if (focusedOption.name === 'sous_categorie') {
            if (!selectedCategory || !source[selectedCategory]) {
                return await interaction.respond([]);
            }
            const subcategories = Object.keys(source[selectedCategory]);
            const filtered = subcategories.filter(sub =>
                sub.toLowerCase().includes(focusedOption.value.toLowerCase())
            );
            return await interaction.respond(filtered.map(sub => ({ name: sub, value: sub })));
        }

        if (focusedOption.name === 'nom' && command === 'regle') {
            const disciplines = Object.keys(rules?.Disciplines || {});
            const filtered = disciplines.filter(d =>
                d.toLowerCase().includes(focusedOption.value.toLowerCase())
            );
            return await interaction.respond(filtered.map(d => ({ name: d, value: d })));
        }

        if (focusedOption.name === 'nom' && command === 'pnj') {
            const noms = Object.keys(pnjs);
            const filtered = noms.filter(n =>
                n.toLowerCase().includes(focusedOption.value.toLowerCase())
            );
            return await interaction.respond(filtered.map(n => ({ name: n, value: n })));
        }

        if (focusedOption.name === 'nom' && command === 'lieu') {
            const noms = Object.keys(lieux);
            const filtered = noms.filter(n =>
                n.toLowerCase().includes(focusedOption.value.toLowerCase())
            );
            return await interaction.respond(filtered.map(n => ({ name: n, value: n })));
        }

        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;
    const userId = interaction.user.id;

    if (commandName === 'regle') {
        const sub = options.getSubcommand();

        if (sub === 'voir') {
            const category = options.getString('categorie', true);
            const subcategory = options.getString('sous_categorie', true);
            const content = rules[category]?.[subcategory];
            if (!content || typeof content !== 'string') {
                return await interaction.reply({ content: `❌ Règle introuvable pour "${category} > ${subcategory}".`, ephemeral: true });
            }
            const embed = buildRuleEmbed(category, subcategory, content);
            await interaction.reply({ embeds: [embed] });
        }

        if (sub === 'chercher') {
            const query = options.getString('mot_cle', true);
            const results = searchRules(query, rules);
            if (results.length === 0) {
                return await interaction.reply({ content: `❌ Aucune règle trouvée pour "${query}".`, ephemeral: true });
            }
            if (results.length === 1) {
                const embed = buildRuleEmbed(results[0].category, results[0].subcategory, results[0].content);
                return await interaction.reply({ embeds: [embed] });
            }
            const embed = new EmbedBuilder()
                .setTitle(`🔍 Résultats pour "${query}"`)
                .setColor(RULE_COLOR)
                .setDescription(
                    results.slice(0, 10).map(r => `**${r.subcategory}** *(${r.category})*\n${r.content.slice(0, 80)}…`).join('\n\n')
                );
            if (results.length > 10) embed.setFooter({ text: `${results.length} résultats — affichage limité à 10` });
            await interaction.reply({ embeds: [embed] });
        }

        if (sub === 'liste') {
            const categories = Object.keys(rules).filter(c => c !== 'Disciplines');
            const lines = categories.map(cat => {
                const subs = Object.keys(rules[cat]).join(', ');
                return `**${cat}**\n${subs}`;
            }).join('\n\n');
            const embed = new EmbedBuilder()
                .setTitle('📚 Règles disponibles')
                .setColor(RULE_COLOR)
                .setDescription(lines);
            await interaction.reply({ embeds: [embed] });
        }

        if (sub === 'discipline') {
            const nom = options.getString('nom', true);
            const disciplineData = rules?.Disciplines?.[nom];
            if (!disciplineData) {
                return await interaction.reply({ content: `❌ Discipline "${nom}" non trouvée.`, ephemeral: true });
            }
            let description = '';
            for (const [power, details] of Object.entries(disciplineData)) {
                description += `🔸 **${power}**\n${details}\n\n`;
            }
            const embed = new EmbedBuilder()
                .setTitle(`🧛 ${nom}`)
                .setDescription(description)
                .setColor(RULE_COLOR);
            await interaction.reply({ embeds: [embed] });
        }
    }

    if (commandName === 'lore') {
        const category = options.getString('categorie');
        const subcategory = options.getString('sous_categorie');
        if (!category || !subcategory) {
            return await interaction.reply("❌ Vous devez fournir une catégorie et une sous-catégorie.");
        }
        const loreEntry = lores?.[category]?.[subcategory];
        if (!loreEntry || !loreEntry.description) {
            return await interaction.reply(`❌ Lore non trouvée pour "${category} > ${subcategory}".`);
        }
        const embed = new EmbedBuilder()
            .setTitle(`📜 ${subcategory}`)
            .setDescription(loreEntry.description)
            .setColor(0x8B0000)
            .setFooter({ text: `Catégorie : ${category}` });
        if (loreEntry.image) embed.setImage(loreEntry.image);
        await interaction.reply({ embeds: [embed] });
    }



    if (commandName === 'pnj') {
        const sub = options.getSubcommand();

        if (sub === 'voir') {
            const nom = options.getString('nom', true);
            const pnj = pnjs[nom];
            if (!pnj) {
                return await interaction.reply({ content: `❌ PNJ "${nom}" introuvable.`, ephemeral: true });
            }

            const statut = (pnj.statut || '').toLowerCase();
            const color = statut.includes('mort') ? 0x2C2C2C
                : statut.includes('dispar') ? 0x4B0082
                : statut.includes('inconnu') ? 0x1a3a5c
                : 0x8B0000;

            const embed = new EmbedBuilder()
                .setTitle(`🧛 ${nom}`)
                .setColor(color);

            const infos = [
                pnj.clan && `**Clan :** ${pnj.clan}`,
                pnj.faction && `**Faction :** ${pnj.faction}`,
                pnj.rang && `**Rang :** ${pnj.rang}`,
                pnj.statut && `**Statut :** ${pnj.statut}`,
            ].filter(Boolean).join('\n');

            embed.addFields({ name: 'Informations', value: infos || '—' });

            if (pnj.description) {
                embed.addFields({ name: 'Description', value: pnj.description });
            }

            if (pnj.relations?.length > 0) {
                embed.addFields({ name: 'Relations', value: pnj.relations.join(', ') });
            }

            if (pnj.image) embed.setImage(pnj.image);

            await interaction.reply({ embeds: [embed] });

            if (isMJ(userId) && pnj.description_mj) {
                await interaction.followUp({
                    content: `🔒 **Notes MJ — ${nom} :**\n${pnj.description_mj}`,
                    ephemeral: true
                });
            }
        }

        if (sub === 'ajouter') {
            if (!isMJ(userId)) {
                return await interaction.reply({ content: '❌ Seuls les MJ peuvent ajouter des PNJ.', ephemeral: true });
            }
            const nom = options.getString('nom', true);
            if (pnjs[nom]) {
                return await interaction.reply({ content: `❌ Un PNJ nommé "${nom}" existe déjà.`, ephemeral: true });
            }
            pnjs[nom] = {
                clan: options.getString('clan') || '',
                faction: options.getString('faction') || '',
                rang: options.getString('rang') || '',
                statut: 'actif',
                description: options.getString('description') || '',
                description_mj: '',
                image: options.getString('image') || '',
                relations: []
            };
            savePnjs();
            await interaction.reply({ content: `✅ PNJ **${nom}** ajouté avec succès.`, ephemeral: true });
        }

        if (sub === 'secret') {
            if (!isMJ(userId)) {
                return await interaction.reply({ content: '❌ Seuls les MJ peuvent modifier les notes secrètes.', ephemeral: true });
            }
            const nom = options.getString('nom', true);
            if (!pnjs[nom]) {
                return await interaction.reply({ content: `❌ PNJ "${nom}" introuvable.`, ephemeral: true });
            }
            pnjs[nom].description_mj = options.getString('texte', true);
            savePnjs();
            await interaction.reply({ content: `✅ Notes secrètes de **${nom}** mises à jour.`, ephemeral: true });
        }

        if (sub === 'liste') {
            const noms = Object.keys(pnjs);
            if (noms.length === 0) {
                return await interaction.reply({ content: 'Aucun PNJ enregistré.', ephemeral: true });
            }
            const lines = noms.map(n => {
                const p = pnjs[n];
                return `🧛 **${n}** — ${p.clan || '?'} · ${p.faction || '?'}${p.rang ? ` · ${p.rang}` : ''}`;
            }).join('\n');
            await interaction.reply({ content: `📋 **PNJ de la campagne :**\n${lines}` });
        }
    }

    if (commandName === 'mj') {
        const sub = options.getSubcommand();

        if (sub === 'ajouter') {
            if (userId !== SUPER_MJ_ID) {
                return await interaction.reply({ content: '❌ Seul le Super MJ peut gérer les droits MJ.', ephemeral: true });
            }
            const target = options.getUser('utilisateur', true);
            if (config.mj_ids.includes(target.id)) {
                return await interaction.reply({ content: `ℹ️ ${target.username} est déjà MJ.`, ephemeral: true });
            }
            config.mj_ids.push(target.id);
            saveConfig();
            await interaction.reply({ content: `✅ **${target.username}** a été promu MJ.`, ephemeral: true });
        }

        if (sub === 'retirer') {
            if (userId !== SUPER_MJ_ID) {
                return await interaction.reply({ content: '❌ Seul le Super MJ peut gérer les droits MJ.', ephemeral: true });
            }
            const target = options.getUser('utilisateur', true);
            config.mj_ids = config.mj_ids.filter(id => id !== target.id);
            saveConfig();
            await interaction.reply({ content: `✅ Droits MJ retirés à **${target.username}**.`, ephemeral: true });
        }

        if (sub === 'liste') {
            if (userId !== SUPER_MJ_ID) {
                return await interaction.reply({ content: '❌ Seul le Super MJ peut voir la liste des MJ.', ephemeral: true });
            }
            const liste = config.mj_ids.length > 0
                ? config.mj_ids.map(id => `<@${id}>`).join(', ')
                : 'Aucun MJ supplémentaire.';
            await interaction.reply({ content: `👑 **MJ actuels :** ${liste}`, ephemeral: true });
        }
    }

    if (commandName === 'lieu') {
        const sub = options.getSubcommand();

        if (sub === 'voir') {
            const nom = options.getString('nom', true);
            const lieu = lieux[nom];
            if (!lieu) {
                return await interaction.reply({ content: `❌ Lieu "${nom}" introuvable.`, ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle(`🗺️ ${nom}`)
                .setColor(0x2C3E50);

            const infos = [
                lieu.type && `**Type :** ${lieu.type}`,
                lieu.quartier && `**Quartier :** ${lieu.quartier}`,
            ].filter(Boolean).join('\n');

            if (infos) embed.addFields({ name: 'Informations', value: infos });
            if (lieu.description) embed.addFields({ name: 'Description', value: lieu.description });
            if (lieu.pnj_lies?.length > 0) embed.addFields({ name: 'PNJ liés', value: lieu.pnj_lies.join(', ') });
            if (lieu.image) embed.setImage(lieu.image);

            await interaction.reply({ embeds: [embed] });

            if (isMJ(userId) && lieu.description_mj) {
                await interaction.followUp({
                    content: `🔒 **Notes MJ — ${nom} :**\n${lieu.description_mj}`,
                    ephemeral: true
                });
            }
        }

        if (sub === 'ajouter') {
            if (!isMJ(userId)) {
                return await interaction.reply({ content: '❌ Seuls les MJ peuvent ajouter des lieux.', ephemeral: true });
            }
            const nom = options.getString('nom', true);
            if (lieux[nom]) {
                return await interaction.reply({ content: `❌ Un lieu nommé "${nom}" existe déjà.`, ephemeral: true });
            }
            lieux[nom] = {
                type: options.getString('type') || '',
                quartier: options.getString('quartier') || '',
                description: options.getString('description') || '',
                description_mj: '',
                image: options.getString('image') || '',
                pnj_lies: []
            };
            saveLieux();
            await interaction.reply({ content: `✅ Lieu **${nom}** ajouté avec succès.`, ephemeral: true });
        }

        if (sub === 'secret') {
            if (!isMJ(userId)) {
                return await interaction.reply({ content: '❌ Seuls les MJ peuvent modifier les notes secrètes.', ephemeral: true });
            }
            const nom = options.getString('nom', true);
            if (!lieux[nom]) {
                return await interaction.reply({ content: `❌ Lieu "${nom}" introuvable.`, ephemeral: true });
            }
            lieux[nom].description_mj = options.getString('texte', true);
            saveLieux();
            await interaction.reply({ content: `✅ Notes secrètes de **${nom}** mises à jour.`, ephemeral: true });
        }

        if (sub === 'liste') {
            const noms = Object.keys(lieux);
            if (noms.length === 0) {
                return await interaction.reply({ content: 'Aucun lieu enregistré.' });
            }
            const lines = noms.map(n => {
                const l = lieux[n];
                return `🗺️ **${n}**${l.type ? ` — ${l.type}` : ''}${l.quartier ? ` · ${l.quartier}` : ''}`;
            }).join('\n');
            await interaction.reply({ content: `📋 **Lieux de la campagne :**\n${lines}` });
        }
    }

    if (commandName === 'session') {
        const sub = options.getSubcommand();

        const buildSessionEmbed = (s: Session) => {
            const embed = new EmbedBuilder()
                .setTitle(`📖 Session ${s.numero} — ${s.titre}`)
                .setColor(0x4B0082)
                .setFooter({ text: s.date });
            if (s.resume) embed.setDescription(s.resume);
            return embed;
        };

        if (sub === 'ajouter') {
            if (!isMJ(userId)) {
                return await interaction.reply({ content: '❌ Seuls les MJ peuvent ajouter des sessions.', ephemeral: true });
            }
            const numero = sessions.length + 1;
            const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const newSession: Session = {
                numero,
                titre: options.getString('titre', true),
                date,
                resume: options.getString('resume', true),
                notes_mj: options.getString('notes_mj') || '',
            };
            sessions.push(newSession);
            saveSessions();

            const embed = buildSessionEmbed(newSession);
            await interaction.reply({ content: `✅ Session ${numero} enregistrée !`, embeds: [embed] });
        }

        if (sub === 'voir') {
            const numero = options.getInteger('numero', true);
            const session = sessions.find(s => s.numero === numero);
            if (!session) {
                return await interaction.reply({ content: `❌ Session ${numero} introuvable.`, ephemeral: true });
            }
            const embed = buildSessionEmbed(session);
            await interaction.reply({ embeds: [embed] });

            if (isMJ(userId) && session.notes_mj) {
                await interaction.followUp({
                    content: `🔒 **Notes MJ — Session ${numero} :**\n${session.notes_mj}`,
                    ephemeral: true
                });
            }
        }

        if (sub === 'derniere') {
            if (sessions.length === 0) {
                return await interaction.reply({ content: 'Aucune session enregistrée.' });
            }
            const session = sessions[sessions.length - 1];
            const embed = buildSessionEmbed(session);
            await interaction.reply({ embeds: [embed] });

            if (isMJ(userId) && session.notes_mj) {
                await interaction.followUp({
                    content: `🔒 **Notes MJ — Session ${session.numero} :**\n${session.notes_mj}`,
                    ephemeral: true
                });
            }
        }

        if (sub === 'liste') {
            if (sessions.length === 0) {
                return await interaction.reply({ content: 'Aucune session enregistrée.' });
            }
            const lines = sessions.map(s => `📖 **Session ${s.numero}** — ${s.titre} *(${s.date})*`).join('\n');
            await interaction.reply({ content: `📋 **Journal de campagne :**\n${lines}` });
        }
    }
});

client.once('ready', () => {
    console.log(`🤖 Connecté en tant que ${client.user?.tag}`);
});

client.login(process.env.BOT_TOKEN).catch((err) => {
    console.error("❌ Erreur lors du login :", err);
});
