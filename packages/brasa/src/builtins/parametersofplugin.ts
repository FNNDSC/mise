/**
 * @file Builtin that lists the parameters of a plugin.
 *
 * @module
 */

import chalk from 'chalk';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import { commandArgs_process } from './utils.js';
import { PluginContextGroupHandler } from '@fnndsc/chili/plugins/pluginGroupHandler.js';
import { type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';

/**
 * Handles the 'parametersofplugin' builtin command.
 * This command displays information about plugin parameters.
 *
 * @param args - Arguments passed to the command.
 * @returns An envelope carrying the rendered parameters or fields.
 */
export async function builtin_parametersofplugin(args: string[]): Promise<CommandEnvelope> {
    const parsedArgs: CLIoptions = commandArgs_process(args);
    const subcommand: string = (parsedArgs._ as string[])[0]; // e.g., 'list', 'fieldslist'
    const pluginIdFromArgs: string | undefined = parsedArgs['plugin-id'] as string;

    if (!subcommand) {
        return envelope_ok(`${chalk.red('Usage: parametersofplugin <list|fieldslist> [--plugin-id <id>] ...')}\n`);
    }

    try {
        // Instantiate the specialized handler
        const handler: PluginContextGroupHandler = await PluginContextGroupHandler.handler_create(
            'parametersofplugin',
            pluginIdFromArgs ? Number(pluginIdFromArgs) : undefined
        );

        if (subcommand === 'list') {
            // Use the specialized man-page style listing for parameters
            return await handler.parameters_listManRender(parsedArgs);
        } else if (subcommand === 'fieldslist') {
            return await handler.parameters_fieldsRender();
        }
        return envelope_ok(`${chalk.yellow(`Unknown parametersofplugin subcommand: ${subcommand}`)}\n`);

    } catch (error: unknown) {
        const msg: string = error instanceof Error ? error.message : String(error);
        process.exitCode = 1;
        return envelope_error('', undefined, `${chalk.red(`Error in parametersofplugin: ${msg}`)}\n`);
    }
}