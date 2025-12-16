import chalk from 'chalk';
import { spinner } from '../lib/spinner.js';
import { builtin_parametersofplugin } from './parametersofplugin.js';
import { plugin_readme as salsa_plugin_readme, plugins_list, plugins_listAll } from '@fnndsc/salsa';

type PluginExecutableOptions = {
    piped?: boolean;
};

/**
 * Handles simulated execution of plugins (e.g., "pl-simpledsapp-v1.2.3 --parameters").
 *
 * This acts as an interceptor for the main shell loop. If the user input matches a
 * known plugin name format, it routes the request to the appropriate ChRIS/ChILI logic,
 * simulating a native executable experience.
 *
 * @param command - The command string (potentially a plugin name).
 * @param args - The arguments passed to the command.
 * @param options - Optional flags for piped/non-interactive handling.
 * @returns A Promise resolving to true if the command was handled as a plugin execution, false otherwise.
 */
export async function pluginExecutable_handle(
    command: string,
    args: string[],
    options?: PluginExecutableOptions
): Promise<boolean> {
    // Expected format: name-vVersion (e.g., "pl-simpledsapp-v2.1.3")
    const versionSeparatorIndex = command.lastIndexOf('-v');
    if (versionSeparatorIndex === -1) {
        return false;
    }

    const name = command.substring(0, versionSeparatorIndex);
    const version = command.substring(versionSeparatorIndex + 2);

    if (!name || !version) {
        return false;
    }

    const showHelp: boolean = args.includes('--help') || args.includes('-h');
    const isPipedOutput: boolean = !!options?.piped || !process.stdout.isTTY;
    if (showHelp) {
        console.log(chalk.cyan(`Plugin executable flags for ${name}-v${version}:`));
        console.log('  --parameters   Show parameter definitions for this plugin version');
        console.log('  --readme       Show README pulled from plugin metadata repository URL');
        return true;
    }

    type PluginCandidate = { id?: number; name?: string; version?: string };
    type PluginListResponse = { tableData?: PluginCandidate[] } | null;

    const plugin_resolveExact = async (): Promise<{ id: number; name: string; version: string } | null> => {
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
            console.error(chalk.red(`Error resolving plugin: ${error instanceof Error ? error.message : String(error)}`));
            return null;
        }
    };

    if (args.includes('--readme')) {
        if (!isPipedOutput) {
            console.log(chalk.cyan(`Resolving plugin ${name} v${version} for README...`));
        }
        const resolved = await plugin_resolveExact();
        if (!resolved) {
            console.log(chalk.red(`Plugin ${name} v${version} not found.`));
            return true;
        }

        if (!isPipedOutput) {
            spinner.start(`[ .. ] Fetching README for ${resolved.name} v${resolved.version}`, true);
        }
        try {
            const readmeContent: string | null = await salsa_plugin_readme(String(resolved.id));
            if (!isPipedOutput) {
                spinner.stop();
            }
            if (readmeContent) {
                console.log(readmeContent);
            } else {
                console.log(chalk.yellow(`No README found for plugin ${resolved.name} v${resolved.version} (ID: ${resolved.id}).`));
            }
        } catch (error: unknown) {
            if (!isPipedOutput) {
                spinner.stop();
            }
            const message: string = error instanceof Error ? error.message : String(error);
            console.log(chalk.red(`Failed to fetch README: ${message}`));
        }
        return true;
    }

    // Handle introspection flags
    if (args.includes('--parameters')) {
        console.log(chalk.cyan(`Fetching parameters for plugin ${name} v${version}...`));
        const resolved = await plugin_resolveExact();
        if (!resolved) {
            console.log(chalk.red(`Plugin ${name} v${version} not found.`));
            return true; // Handled (attempted), but failed
        }

        console.log(chalk.cyan(`Resolved Plugin: ${resolved.name} v${resolved.version} (ID: ${resolved.id})`));

        // Delegate to parametersofplugin builtin with the resolved context
        await builtin_parametersofplugin(['list', '--plugin-id', String(resolved.id)]);
        return true;
    }

    // If command matches plugin format but no handled flags are present,
    // return false to let the main loop handle it (or show unknown command).
    return false;
}
