import chalk from 'chalk';
import { builtin_parametersofplugin } from './parametersofplugin.js';

/**
 * Handles simulated execution of plugins (e.g., "pl-simpledsapp-v1.2.3 --parameters").
 *
 * This acts as an interceptor for the main shell loop. If the user input matches a
 * known plugin name format, it routes the request to the appropriate ChRIS/ChILI logic,
 * simulating a native executable experience.
 *
 * @param command - The command string (potentially a plugin name).
 * @param args - The arguments passed to the command.
 * @returns A Promise resolving to true if the command was handled as a plugin execution, false otherwise.
 */
export async function pluginExecutable_handle(command: string, args: string[]): Promise<boolean> {
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

    // Handle introspection flags
    if (args.includes('--parameters')) {
        console.log(chalk.cyan(`Fetching parameters for plugin ${name} v${version}...`));
        
        try {
            const { plugins_list, plugins_listAll } = await import('@fnndsc/salsa');
            
            // 1. Attempt precise search first
            let results = await plugins_list({
                search: {
                    name_exact: name,
                    version: version
                }
            } as any);
            
            let candidate = results?.tableData?.[0];

            // 2. Fallback: Broad search + client-side filter if API search was fuzzy/imprecise
            if (!candidate || candidate.name !== name || candidate.version !== version) {
                const allVersions = await plugins_listAll({
                    search: { name: name }
                } as any);
                
                candidate = allVersions?.tableData?.find((p: any) => p.name === name && p.version === version);
            }
            
            if (!candidate) {
                console.log(chalk.red(`Plugin ${name} v${version} not found.`));
                return true; // Handled (attempted), but failed
            }
            
            const pluginId = candidate.id;
            console.log(chalk.cyan(`Resolved Plugin: ${candidate.name} v${candidate.version} (ID: ${pluginId})`));
            
            // Delegate to parametersofplugin builtin with the resolved context
            await builtin_parametersofplugin(['list', '--plugin-id', String(pluginId)]);
            return true;

        } catch (e) {
            console.error(chalk.red(`Error resolving plugin: ${e}`));
            return true;
        }
    }

    // If command matches plugin format but no handled flags are present,
    // return false to let the main loop handle it (or show unknown command).
    return false;
}