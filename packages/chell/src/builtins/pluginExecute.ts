/**
 * @file Plugin Execute Builtin
 *
 * This module implements the builtin for executing plugins "in place"
 * based on current directory context.
 *
 * @module
 */

import { plugin_executeInPlace, PluginExecutionResult } from '@fnndsc/salsa';
import { dictionary_fromCLI, Dictionary, errorStack, Result } from '@fnndsc/cumin';
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import chalk from 'chalk';
import { session } from '../session/index.js';
import { vfs } from '../lib/vfs/vfs.js';

/**
 * Parses a plugin name from /bin format (name-vVersion) into ChRIS search format.
 *
 * @param pluginName - Plugin name in format: pl-name-vX.Y.Z
 * @returns Search string in format: name_exact:pl-name,version:X.Y.Z
 *
 * @example
 * ```typescript
 * pluginName_toSearchString('pl-dcm2niix-v1.0.2')
 * // Returns: 'name_exact:pl-dcm2niix,version:1.0.2'
 * ```
 */
function pluginName_toSearchString(pluginName: string): string {
  // Pattern: (name)-v(version)
  const match: RegExpMatchArray | null = pluginName.match(/^(.+)-v(.+)$/);

  if (match) {
    const name: string = match[1];
    const version: string = match[2];
    return `name_exact:${name},version:${version}`;
  }

  // Fallback: if no version suffix, search by name only
  return `name_exact:${pluginName}`;
}

/**
 * Executes a plugin in the current directory context.
 *
 * This function is called when the user types a plugin name that exists in /bin.
 * It handles parameter parsing, interactive prompts, and delegates execution to salsa.
 *
 * @param pluginName - Full plugin name with version (e.g., pl-dcm2niix-v2.1.1).
 * @param args - Array of command line arguments.
 * @returns Promise that resolves when execution completes.
 *
 * @example
 * ```typescript
 * // User types: pl-dcm2niix-v2.1.1 --outputdir results -- feed_title="Brain MRI"
 * await builtin_executePlugin('pl-dcm2niix-v2.1.1', [
 *   '--outputdir', 'results', '--', 'feed_title=Brain MRI'
 * ]);
 * ```
 */
export async function builtin_executePlugin(
  pluginName: string,
  args: string[]
): Promise<void> {
  try {
    // 1. Parse arguments - split on '--' delimiter
    const argsString: string = args.join(' ');
    let pluginArgsStr: string = argsString;
    let contextArgsStr: string = '';

    // Check for ' -- ' delimiter (space-dash-dash-space)
    const delimiterIndex: number = argsString.indexOf(' -- ');
    if (delimiterIndex !== -1) {
      pluginArgsStr = argsString.substring(0, delimiterIndex);
      contextArgsStr = argsString.substring(delimiterIndex + 4); // +4 to skip ' -- '
    }

    // 2. Parse both sets of parameters
    let pluginParams: Dictionary = {};
    let contextParams: Dictionary = {};

    if (pluginArgsStr.trim()) {
      try {
        pluginParams = dictionary_fromCLI(pluginArgsStr);
      } catch (e) {
        const msg: string = e instanceof Error ? e.message : String(e);
        console.error(chalk.red(`Error parsing plugin parameters: ${msg}`));
        return;
      }
    }

    if (contextArgsStr.trim()) {
      try {
        contextParams = dictionary_fromCLI(contextArgsStr);
      } catch (e) {
        const msg: string = e instanceof Error ? e.message : String(e);
        console.error(chalk.red(`Error parsing context parameters: ${msg}`));
        return;
      }
    }

    // 3. Set default context params if not provided
    const cwd: string = await session.getCWD();
    const isInFeed: boolean = cwd.includes('/feeds/feed_');

    // If no context params provided and not in a feed, use directory name as feed title
    if (!contextArgsStr && !isInFeed) {
      const defaultTitle: string = cwd.split('/').pop() || 'Untitled';
      contextParams.feed_title = defaultTitle;
      console.log(chalk.cyan(`Using feed title: "${defaultTitle}" (customize with -- feed_title="Custom Title")`));
    }

    // 4. Get /bin listing for finding pl-dircopy
    const binResult: Result<ListingItem[]> = await vfs.data_get('/bin');
    if (!binResult.ok) {
      console.error(chalk.red('Failed to access /bin directory'));
      return;
    }

    const binListing: string[] = binResult.value.map((item: ListingItem) => item.name);

    // 5. Convert plugin name from /bin format to ChRIS search format
    // Example: pl-dcm2niix-v1.0.2 → name_exact:pl-dcm2niix,version:1.0.2
    const pluginSearchString: string = pluginName_toSearchString(pluginName);

    // 6. Execute via salsa
    const result: PluginExecutionResult | null = await plugin_executeInPlace(
      pluginSearchString,
      pluginParams,
      contextParams,
      cwd,
      binListing
    );

    if (!result) {
      // Display all errors from the stack for better debugging
      console.error(chalk.red('Plugin execution failed:'));
      let error = errorStack.stack_pop();
      while (error) {
        console.error(chalk.red(`  - ${error.message}`));
        error = errorStack.stack_pop();
      }
      return;
    }

    // 7. Render output
    if (result.feedID) {
      console.log(chalk.green(`Feed created: ${result.feedID}`));
    }
    console.log(
      chalk.green(
        `Job scheduled: ${pluginName} (ID: ${result.pluginInstanceID})`
      )
    );
    console.log(chalk.cyan(`Output will be in: ${result.outputPath}`));
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error executing plugin: ${msg}`));
  }
}
