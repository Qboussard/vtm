import { AutocompleteInteraction, ChatInputCommandInteraction, MessageComponentInteraction } from 'discord.js';
import { config } from './data';

export interface Command {
    data: { name: string; toJSON(): unknown };
    execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
    autocomplete?(interaction: AutocompleteInteraction): Promise<unknown>;
    /** Boutons et menus dont le customId commence par `${data.name}:`, au format `commande:action:arg`. */
    component?(interaction: MessageComponentInteraction, action: string, arg: string): Promise<unknown>;
}

export const SUPER_MJ_ID = process.env.SUPER_MJ_ID as string;

export const isMJ = (userId: string): boolean =>
    userId === SUPER_MJ_ID || config.mj_ids.includes(userId);
