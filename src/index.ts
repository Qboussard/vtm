import 'dotenv/config';
import { Client, Events, GatewayIntentBits, Interaction, REST, Routes } from 'discord.js';
import { lieu } from './commands/lieu';
import { lore } from './commands/lore';
import { memo } from './commands/memo';
import { mj } from './commands/mj';
import { pnj } from './commands/pnj';
import { regle } from './commands/regle';
import { session } from './commands/session';
import { startNotionSync } from './notion';
import { Command } from './types';
import { EPHEMERAL } from './util';

const { BOT_TOKEN, CLIENT_ID, GUILD_ID, SUPER_MJ_ID } = process.env;
if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID || !SUPER_MJ_ID) {
    throw new Error('BOT_TOKEN, CLIENT_ID, GUILD_ID ou SUPER_MJ_ID manquant dans le fichier .env');
}

const commands = new Map<string, Command>(
    [regle, memo, lore, pnj, lieu, session, mj].map(c => [c.data.name, c]),
);

const deployCommands = async () => {
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    console.log('🔄 Déploiement des commandes slash...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
        body: [...commands.values()].map(c => c.data.toJSON()),
    });
    console.log('✅ Commandes déployées !');
};

const reportError = async (interaction: Interaction, error: unknown) => {
    console.error(`❌ Erreur sur l'interaction ${interaction.id} :`, error);
    if (!interaction.isRepliable()) return;
    const message = { content: '❌ Une erreur est survenue. Réessaie, ou préviens le MJ.', flags: EPHEMERAL } as const;
    try {
        if (interaction.replied || interaction.deferred) await interaction.followUp(message);
        else await interaction.reply(message);
    } catch {
        // L'interaction a expiré : rien de plus à faire
    }
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isAutocomplete()) {
            await commands.get(interaction.commandName)?.autocomplete?.(interaction);
            return;
        }
        if (interaction.isChatInputCommand()) {
            await commands.get(interaction.commandName)?.execute(interaction);
            return;
        }
        if (interaction.isMessageComponent()) {
            // customId = commande:action:arg (l'argument peut lui-même contenir des « : »)
            const [name, action = '', ...rest] = interaction.customId.split(':');
            await commands.get(name)?.component?.(interaction, action, rest.join(':'));
        }
    } catch (error) {
        if (interaction.isAutocomplete()) {
            console.error('❌ Erreur d’autocomplétion :', error);
            await interaction.respond([]).catch(() => {});
            return;
        }
        await reportError(interaction, error);
    }
});

client.once(Events.ClientReady, c => {
    console.log(`🤖 Connecté en tant que ${c.user.tag}`);
    startNotionSync();
});

process.on('unhandledRejection', error => {
    console.error('❌ Promesse rejetée non gérée :', error);
});

(async () => {
    try {
        await deployCommands();
    } catch (error) {
        console.error('❌ Erreur lors du déploiement des commandes :', error);
    }
    await client.login(BOT_TOKEN);
})().catch(error => {
    console.error('❌ Erreur lors du login :', error);
    process.exit(1);
});
