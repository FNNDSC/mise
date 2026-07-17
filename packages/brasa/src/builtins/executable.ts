/**
 * @file Builtin handler for executing a plugin as a shell command.
 *
 * @module
 */

import chalk from 'chalk';
import { spinner } from '../lib/spinner.js';
import { builtin_parametersofplugin } from './parametersofplugin.js';
import { plugins_list, plugins_listAll, type PluginReadmeDocument } from '@fnndsc/salsa';
import { pluginReadme_fetch, pluginReadme_render } from '@fnndsc/chili/commands/plugin/readme.js';
import { errorStack, type CommandEnvelope, envelope_ok } from '@fnndsc/cumin';
import { pluginExecutableHelp_render } from './help.js';

/** A plugin resolved to its exact id, name, and version. */
interface ResolvedPlugin {
  id: number;
  name: string;
  version: string;
}


/**
 * Handles simulated execution of plugins (e.g., "pl-simpledsapp-v1.2.3 --parameters").
 *
 * This acts as an interceptor for the main shell loop. If the user input matches a
 * known plugin name format, it routes the request to the appropriate ChRIS/ChILI logic,
 * simulating a native executable experience.
 *
 * @param command - The command string (potentially a plugin name).
 * @param args - The arguments passed to the command.
 * @returns An envelope when the command was handled, or null otherwise.
 */
export async function pluginExecutable_handle(
    command: string,
    args: string[],
): Promise<CommandEnvelope | null> {
    // Expected format: name-vVersion (e.g., "pl-simpledsapp-v2.1.3")
    const versionSeparatorIndex: number = command.lastIndexOf('-v');
    if (versionSeparatorIndex === -1) {
        return null;
    }

    const name: string = command.substring(0, versionSeparatorIndex);
    const version: string = command.substring(versionSeparatorIndex + 2);

    if (!name || !version) {
        return null;
    }

    const showHelp: boolean = args.includes('--help') || args.includes('-h');
    if (showHelp) {
        return envelope_ok(pluginExecutableHelp_render(command));
    }

    type PluginCandidate = { id?: number; name?: string; version?: string };
    type PluginListResponse = { tableData?: PluginCandidate[] } | null;

    const plugin_resolveExact = async (): Promise<ResolvedPlugin | null> => {
        try {
            const resultsExactUnknown: unknown = await plugins_list({
                search: {
                    name_exact: name,
                    version: version
                }
            });

            const resultsExact: PluginListResponse = resultsExactUnknown as PluginListResponse;

            let candidate: PluginCandidate | undefined = resultsExact?.tableData?.[0];

            if (!candidate || candidate.name !== name || candidate.version !== version) {
                const allVersionsUnknown: unknown = await plugins_listAll({
                    search: { name: name }
                });
                const allVersions: PluginListResponse = allVersionsUnknown as PluginListResponse;

                candidate = allVersions?.tableData?.find((p: PluginCandidate) => p.name === name && p.version === version);
            }

            if (
                !candidate ||
                typeof candidate.id !== 'number' ||
                typeof candidate.name !== 'string' ||
                typeof candidate.version !== 'string'
            ) {
                return null;
            }

            return { id: candidate.id, name: candidate.name, version: candidate.version };
        } catch (error: unknown) {
            errorStack.stack_push(
                'error',
                `Error resolving plugin: ${error instanceof Error ? error.message : String(error)}`,
            );
            return null;
        }
    };

    if (args.includes('--readme')) {
        const rawMode: boolean = args.includes('--raw');
        let rendered: string = rawMode
            ? ''
            : `${chalk.cyan(`Resolving plugin ${name} v${version} for README...`)}\n`;
        const resolved: ResolvedPlugin | null = await plugin_resolveExact();
        if (!resolved) {
            rendered += `${chalk.red(`Plugin ${name} v${version} not found.`)}\n`;
            return envelope_ok(rendered);
        }

        spinner.start(`Fetching README for ${resolved.name} v${resolved.version}...`);
        try {
            const document: PluginReadmeDocument | null = await pluginReadme_fetch(String(resolved.id));
            spinner.stop();
            if (document) {
                if (rawMode) return envelope_ok(document.content);
                const readme: string = pluginReadme_render(document);
                rendered += readme.endsWith('\n') ? readme : `${readme}\n`;
            } else {
                rendered += `${chalk.yellow(`No README found for ${resolved.name} v${resolved.version}.`)}\n`;
            }
        } catch (error: unknown) {
            spinner.stop();
            const message: string = error instanceof Error ? error.message : String(error);
            rendered += `${chalk.red(`Failed to fetch README: ${message}`)}\n`;
        }
        return envelope_ok(rendered);
    }

    if (args.includes('--parameters')) {
        let rendered: string = `${chalk.cyan(`Fetching parameters for plugin ${name} v${version}...`)}\n`;
        const resolved: ResolvedPlugin | null = await plugin_resolveExact();
        if (!resolved) {
            rendered += `${chalk.red(`Plugin ${name} v${version} not found.`)}\n`;
            return envelope_ok(rendered);
        }

        rendered += `${chalk.cyan(`Resolved Plugin: ${resolved.name} v${resolved.version} (ID: ${resolved.id})`)}\n`;

        // Delegate to parametersofplugin builtin with the resolved context
        const parametersEnvelope: CommandEnvelope = await builtin_parametersofplugin([
            'list', '--plugin-id', String(resolved.id),
        ]);
        return { ...parametersEnvelope, rendered: rendered + parametersEnvelope.rendered };
    }

    // If command matches plugin format but no handled flags are present,
    // return null to let the main loop handle it (or show unknown command).
    return null;
}
