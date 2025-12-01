import chalk from 'chalk';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import { commandArgs_process } from './utils.js';
import { PluginContextGroupHandler } from '@fnndsc/chili/plugins/pluginGroupHandler.js';

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
        // Instantiate the specialized handler
        const handler = await PluginContextGroupHandler.handler_create(
            'parametersofplugin',
            pluginIdFromArgs ? Number(pluginIdFromArgs) : undefined
        );

        if (subcommand === 'list') {
            // Use the specialized man-page style listing for parameters
            await handler.parameters_listMan(parsedArgs);
        } else if (subcommand === 'fieldslist') {
            await handler.parameters_fieldsList();
        } else {
            console.log(chalk.yellow(`Unknown parametersofplugin subcommand: ${subcommand}`));
        }

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Error in parametersofplugin: ${msg}`));
    }
}