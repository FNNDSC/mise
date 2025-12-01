import chalk from 'chalk';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import { commandArgs_process } from './utils.js';
import { PluginContextController } from '@fnndsc/chili/controllers/pluginContextController.js';
import { BaseGroupHandler } from '@fnndsc/chili/handlers/baseGroupHandler.js';
import { ListOptions } from '@fnndsc/cumin'; // Import ListOptions for parsing search

/**
 * Handles the 'parametersofplugin' builtin command.
 * This command displays information about plugin parameters.
 *
 * @param args - Arguments passed to the command.
 * @returns A Promise that resolves once the command has been processed.
 */
export async function builtin_parametersofplugin(args: string[]): Promise<void> {
    const parsedArgs: CLIoptions = commandArgs_process(args);
    const subcommand = parsedArgs._[0]; // e.g., 'list', 'fieldslist'
    const pluginIdFromArgs: string | undefined = parsedArgs['plugin-id'] as string;

    if (!subcommand) {
        console.log(chalk.red('Usage: parametersofplugin <list|fieldslist> [--plugin-id <id>] ...'));
        return;
    }

    try {
        // Instantiate the controller with the explicit plugin ID from args, or let it default
        const controller = await PluginContextController.controller_create(
            'parametersofplugin',
            pluginIdFromArgs ? Number(pluginIdFromArgs) : undefined // Pass resolved ID or undefined
        );
        const handler = new BaseGroupHandler('parametersofplugin', controller.chrisObject as any); // 'as any' due to type complexity

        if (subcommand === 'list') {
            // Pass parsed CLI options to the generic list method
            await handler.resources_list(parsedArgs);
        } else if (subcommand === 'fieldslist') {
            await handler.resourceFields_list();
        } else {
            console.log(chalk.yellow(`Unknown parametersofplugin subcommand: ${subcommand}`));
        }

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Error in parametersofplugin: ${msg}`));
    }
}