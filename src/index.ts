import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

if (!process.env.BOT_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
    throw new Error("BOT_TOKEN, CLIENT_ID ou GUILD_ID manquant dans le fichier .env");
}

// Chargement des fichiers JSON
const rulesPath = path.join(__dirname, 'rules.json');
const lorePath = path.join(__dirname, 'lore.json');
let rules: any = {};
let lores: any = {};

try {
    const rawData = fs.readFileSync(rulesPath, 'utf-8');
    const rawDataLore = fs.readFileSync(lorePath, 'utf-8');
    rules = JSON.parse(rawData);
    lores = JSON.parse(rawDataLore);
    console.log("✅ Fichiers chargés !");
} catch (error) {
    console.error("❌ Erreur lors de la lecture du fichier JSON :", error);
}

// Fonction pour récupérer une règle spécifique
const getRule = (category: string, subcategory: string, rulesObj: any): string => {
    if (rulesObj[category] && rulesObj[category][subcategory]) {
        return `📖 **${category} > ${subcategory}** :\n${rulesObj[category][subcategory]}`;
    }
    return `❌ Règle non trouvée pour "${category} > ${subcategory}"`;
};

// Fonction pour lister toutes les catégories et sous-catégories
const listCommands = (rulesObj: any): string => {
    let commandsList = "📚 **Catégories et sous-catégories disponibles :**\n";
    for (const category in rulesObj) {
        commandsList += `\n🔹 **${category}**\n`;
        for (const sub in rulesObj[category]) {
            commandsList += `  └─ ${sub}\n`;
        }
    }
    return commandsList;
};

// Initialisation du client Discord
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Déclaration des commandes slash
const commands = [
    new SlashCommandBuilder()
        .setName('regle')
        .setDescription('Affiche une règle spécifique')
        .addStringOption(option =>
            option.setName('categorie')
                .setDescription('Catégorie de la règle')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(option =>
            option.setName('sous_categorie')
                .setDescription('Sous-catégorie de la règle')
                .setRequired(true)
                .setAutocomplete(true)),
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
        .setName('commands')
        .setDescription('Liste toutes les règles disponibles'),
    new SlashCommandBuilder()
        .setName('disciplines')
        .setDescription('Affiche les pouvoirs d’une discipline')
        .addStringOption(option =>
            option.setName('discipline')
                .setDescription('Nom de la discipline')
                .setRequired(true)
                .setAutocomplete(true))
].map(command => command.toJSON());

// Déploiement des commandes
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

// Gestion des interactions
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
            await interaction.respond(filtered.map(c => ({ name: c, value: c })));
        }

        if (focusedOption.name === 'sous_categorie') {
            if (!selectedCategory || !source[selectedCategory]) {
                return await interaction.respond([]);
            }

            const subcategories = Object.keys(source[selectedCategory]);
            const filtered = subcategories.filter(sub =>
                sub.toLowerCase().includes(focusedOption.value.toLowerCase())
            );
            await interaction.respond(filtered.map(sub => ({ name: sub, value: sub })));
        }

        if (focusedOption.name === 'discipline') {
            const disciplines = Object.keys(rules?.Disciplines || {});
            const filtered = disciplines.filter(d =>
                d.toLowerCase().includes(focusedOption.value.toLowerCase())
            );
            await interaction.respond(filtered.map(d => ({ name: d, value: d })));
        }

        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'commands') {
        const commandList = listCommands(rules);
        await interaction.reply(commandList);
    }

    if (commandName === 'regle') {
        const category = options.getString('categorie');
        const subcategory = options.getString('sous_categorie');

        if (!category || !subcategory) {
            return await interaction.reply("❌ Vous devez fournir une catégorie et une sous-catégorie.");
        }

        const rule = getRule(category, subcategory, rules);
        await interaction.reply(rule);
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

        if (loreEntry.image) {
            embed.setImage(loreEntry.image);
        }

        await interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'disciplines') {
        const disciplineName = options.getString('discipline');
        if(disciplineName) {
            const disciplineData = rules?.Disciplines?.[disciplineName];
            if (!disciplineData) {
                return await interaction.reply(`❌ Discipline "${disciplineName}" non trouvée.`);
            }

            const embed = new EmbedBuilder()
                .setTitle(`🧛 Discipline : ${disciplineName}`)
                .setColor(0x990000);

            let description = '';
            for (const [power, details] of Object.entries(disciplineData)) {
                description += `🔸 **${power}**\n${details}\n\n`;
            }

            embed.setDescription(description);

            await interaction.reply({ embeds: [embed] });
        }
    }
});

// Connexion du bot
client.once('ready', () => {
    console.log(`🤖 Connecté en tant que ${client.user?.tag}`);
});

client.login(process.env.BOT_TOKEN);
