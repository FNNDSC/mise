/**
 * @file Plugin Execute Builtin
 *
 * This module implements the builtin for executing plugins "in place"
 * based on current directory context.
 *
 * @module
 */

import { plugin_executeInPlace, PluginExecutionResult } from '@fnndsc/salsa';
import {
  Dictionary,
  errorStack,
  Result,
  procCache_get,
  envelope_error,
  envelope_ok,
  type CommandEnvelope,
  type StackMessage,
} from '@fnndsc/cumin';
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import chalk from 'chalk';
import { session } from '../session/index.js';
import { vfs } from '../lib/vfs/vfs.js';
import { newFeed_cacheAdd } from './feedCreation.js';
import { executableArguments_parse } from './argumentTokens.js';
import { pluginSelector_normalize } from './pluginSelector.js';

/**
 * Executes a plugin in the current directory context.
 *
 * This function is called when the user types a plugin name that exists in /bin.
 * It handles parameter parsing, interactive prompts, and delegates execution to salsa.
 *
 * @param pluginName - Full plugin name with version (e.g., pl-dcm2niix-v2.1.1).
 * @param args - Array of command line arguments.
 * @returns Command envelope whose status matches parsing and execution.
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
): Promise<CommandEnvelope> {
  try {
    // 1. Split the already-tokenized arguments on the context delimiter.
    const delimiterIndex: number = args.indexOf('--');
    const pluginArgTokens: string[] = delimiterIndex === -1 ? args : args.slice(0, delimiterIndex);
    const contextArgTokens: string[] = delimiterIndex === -1 ? [] : args.slice(delimiterIndex + 1);

    // 2. Parse both sets of parameters
    let pluginParams: Dictionary = {};
    let contextParams: Dictionary = {};

    if (pluginArgTokens.length > 0) {
      try {
        pluginParams = executableArguments_parse(pluginArgTokens);
      } catch (e: unknown) {
        const msg: string = e instanceof Error ? e.message : String(e);
        console.error(chalk.red(`Error parsing plugin parameters: ${msg}`));
        return envelope_error('');
      }
    }

    if (contextArgTokens.length > 0) {
      try {
        contextParams = executableArguments_parse(contextArgTokens);
      } catch (e: unknown) {
        const msg: string = e instanceof Error ? e.message : String(e);
        console.error(chalk.red(`Error parsing context parameters: ${msg}`));
        return envelope_error('');
      }
    }

    // 3. Set default context params if not provided
    const cwd: string = await session.getCWD();
    const isInFeed: boolean = cwd.includes('/feeds/feed_');

    // If no context params provided and not in a feed, use directory name as feed title
    if (contextArgTokens.length === 0 && !isInFeed) {
      const defaultTitle: string = cwd.split('/').pop() || 'Untitled';
      contextParams.feed_title = defaultTitle;
      console.log(chalk.cyan(`Using feed title: "${defaultTitle}" (customize with -- feed_title="Custom Title")`));
    }

    // 4. Get /bin listing for finding pl-dircopy
    const binResult: Result<ListingItem[]> = await vfs.data_get('/bin');
    if (!binResult.ok) {
      console.error(chalk.red('Failed to access /bin directory'));
      return envelope_error('');
    }

    const binListing: string[] = binResult.value.map((item: ListingItem) => item.name);

    // 5. Convert plugin name from /bin format to ChRIS search format
    // Example: pl-dcm2niix-v1.0.2 → name_exact:pl-dcm2niix,version:1.0.2
    const pluginSearchString: string = pluginSelector_normalize(pluginName);

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
      let error: StackMessage | undefined = errorStack.stack_pop();
      while (error) {
        console.error(chalk.red(`  - ${error.message}`));
        error = errorStack.stack_pop();
      }
      return envelope_error('');
    }

    // 7. Push to procCache so /proc reflects new jobs immediately
    if (result.feedID !== undefined && result.dircopyInstanceID !== undefined) {
      // New feed: push dircopy root node + plugin node
      const feedTitle: string = typeof contextParams.feed_title === 'string'
        ? contextParams.feed_title
        : cwd.split('/').pop() || `feed_${result.feedID}`;
      newFeed_cacheAdd({
        feedID: result.feedID,
        title: feedTitle,
        ownerUsername: cwd.split('/')[2] ?? '',
        rootInstanceID: result.dircopyInstanceID,
        child: { id: result.pluginInstanceID, pluginName: result.pluginName },
      });
    } else if (result.parentID !== null) {
      // Continue feed: push just the new instance
      const feedID: number | null = (() => {
        const inst = procCache_get().instance_get(result.parentID!);
        return inst ? inst.feedID : null;
      })();
      if (feedID !== null) {
        procCache_get().instance_add({
          id: result.pluginInstanceID, feedID,
          parentID: result.parentID, pluginName: result.pluginName, params: null, status: 'scheduled',
        });
      }
    }

    // 8. Render output
    if (result.feedID) {
      console.log(chalk.green(`Feed created: ${result.feedID}`));
    }
    console.log(
      chalk.green(
        `Job scheduled: ${pluginName} (ID: ${result.pluginInstanceID})`
      )
    );
    console.log(chalk.cyan(`Output will be in: ${result.outputPath}`));
    return envelope_ok('');
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error executing plugin: ${msg}`));
    return envelope_error('');
  }
}
