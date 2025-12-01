import chalk from 'chalk';
import { builtin_parametersofplugin } from './parametersofplugin.js';

/**
 * Handles simulated execution of plugins (e.g., "pl-simpledsapp-v1.2.3 --parameters").
 *
 * @param command - The command string (potentially a plugin name).
 * @param args - The arguments passed to the command.
 * @returns A Promise resolving to true if the command was handled as a plugin execution, false otherwise.
 */
export async function pluginExecutable_handle(command: string, args: string[]): Promise<boolean> {
    // Regex to match plugin names like "pl-name-v1.2.3" or "pl_name-v1.2.3"
    // Assuming format from VFS: name-vVersion
    // We need to be careful about the split. "pl-simpledsapp-v2.1.3"
    // Name: pl-simpledsapp, Version: 2.1.3
    
    const versionSeparatorIndex = command.lastIndexOf('-v');
    if (versionSeparatorIndex === -1) {
        return false;
    }

    const name = command.substring(0, versionSeparatorIndex);
    const version = command.substring(versionSeparatorIndex + 2);

    if (!name || !version) {
        return false;
    }

    // Check for --parameters flag
    if (args.includes('--parameters')) {
        console.log(chalk.cyan(`Fetching parameters for plugin ${name} v${version}...`));
        
        // Construct search string for parametersofplugin
        // Note: parametersofplugin uses BaseGroupHandler which uses 'list' command.
        // We want to filter by the specific plugin.
        // The 'parametersofplugin' controller typically lists parameters for the *current* plugin context
        // OR we can search for parameters.
        // However, usually parameters are linked to a plugin.
        // If we search parameters directly, we need to know how to filter them by plugin.
        // The ChRIS API 'parameters/' endpoint allows filtering by plugin_id.
        // But here we have name/version.
        
        // We first need to resolve name/version to a plugin ID.
        // We can use the search logic.
        
        // Actually, the most robust way is to search for the plugin first to get its ID.
        // Then list parameters for that ID.
        
        // However, to keep this handler simple and use existing builtins, 
        // does builtin_parametersofplugin support filtering by plugin name/version directly?
        // The API for /api/v1/plugins/parameters/ supports `plugin_id`.
        // It probably doesn't support `plugin_name` directly on the parameters endpoint.
        
        // So we need to resolve the plugin ID first.
        // We can import the salsa logic or use `plugins_fetchList` from chili to find the ID.
        
        // Let's try to use chili's plugin search logic.
        // Or simpler: The user wants "parameters of THIS plugin".
        // Ideally, `builtin_parametersofplugin` should support a `--plugin <id>` or similar context switch.
        // But currently it likely relies on `context_getSingle()` or just lists all (or searches params themselves).
        
        // Let's try to resolve the ID here.
        // We need to import a way to search plugins.
        
        try {
            const { plugins_list, plugins_listAll } = await import('@fnndsc/salsa');
            // First try explicit search
            let results = await plugins_list({
                search: {
                    name_exact: name,
                    version: version
                }
            } as any);
            
            let candidate = results?.tableData?.[0];

            // Verify if the API returned the correct plugin
            if (!candidate || candidate.name !== name || candidate.version !== version) {
                // API mismatch or not found, try fetching all plugins matching the name (broad search)
                // and filter locally. This handles pagination and fuzzy search quirks.
                const allVersions = await plugins_listAll({
                    search: { name: name }
                } as any);
                
                candidate = allVersions?.tableData?.find((p: any) => p.name === name && p.version === version);
            }
            
            if (!candidate) {
                console.log(chalk.red(`Plugin ${name} v${version} not found.`));
                return true; // Handled, but failed
            }
            
            const pluginId = candidate.id;
            const foundName = candidate.name;
            const foundVersion = candidate.version;
            console.log(chalk.cyan(`Resolved Plugin: ${foundName} v${foundVersion} (ID: ${pluginId})`));
            
            // Now call parametersofplugin list with --plugin-id
            await builtin_parametersofplugin(['list', '--plugin-id', String(pluginId)]);
            return true;

        } catch (e) {
            console.error(chalk.red(`Error resolving plugin: ${e}`));
            return true; // Handled execution attempt
        }
    }

    // If no handled flags found, return false to let main loop handle (or error)
    // For now, if it looks like a plugin but we don't handle execution yet (only --parameters),
    // maybe we should warn?
    // "I want to start implementing... First thing is --parameters"
    // So other cases can return false for now (falling back to "Unknown command").
    
    return false;
}