/**
 * @file Handle plugin execution for new feed creation
 * @module
 */
import {
  Dictionary,
  errorStack,
  path_findLatestDircopy,
} from '@fnndsc/cumin';
import { feed_create } from '../../feeds/index.js';
import { plugin_run } from '../index.js';
import * as path from 'path';
import { PluginExecutionResult } from '../plugin_executeInPlace.js';

/**
 * Handles the "new feed" execution path.
 * Creates a feed, runs dircopy, then runs the target plugin.
 *
 * @param pluginName - The plugin to run.
 * @param pluginParams - Parameters for the plugin.
 * @param contextParams - Context parameters (e.g., feed_title).
 * @param cwd - Current working directory.
 * @param binListing - Listing of available plugins in /bin.
 * @returns The execution result or null on failure.
 */
export async function plugin_executeNewFeed(
  pluginName: string,
  pluginParams: Dictionary,
  contextParams: Dictionary,
  cwd: string,
  binListing: string[]
): Promise<PluginExecutionResult | null> {
  const feedTitle: string = (contextParams.feed_title as string) || path.basename(cwd);
  const dircopyPlugin: string | null = path_findLatestDircopy(binListing);

  if (!dircopyPlugin) {
    errorStack.stack_push('error', 'pl-dircopy not found. Cannot create feeds.');
    return null;
  }

  const feedResult: Dictionary | null = await feed_create([cwd], {
    params: `title:${feedTitle}`,
  });

  if (!feedResult) {
    errorStack.stack_push('error', 'Failed to create feed');
    return null;
  }

  const feedID: number = feedResult.id as number;
  const dircopyInstanceID: number = (feedResult.pluginInstance as any).data.id as number;

  const combinedParams: Dictionary = {
    ...pluginParams,
    previous_id: dircopyInstanceID,
  };

  if (contextParams.instance_title) {
    combinedParams.title = contextParams.instance_title;
  }

  const pluginResult: Dictionary | null = await plugin_run(pluginName, combinedParams);

  if (!pluginResult) {
    errorStack.stack_push('error', 'Failed to run plugin');
    return null;
  }

  const pluginInstanceID: number = pluginResult.id as number;
  const actualPluginName: string = pluginResult.plugin_name as string;
  const username: string = cwd.split('/')[2];
  const outputPath: string = `/home/${username}/feeds/feed_${feedID}/pl-dircopy_${dircopyInstanceID}/${actualPluginName}_${pluginInstanceID}/data/`;

  return {
    feedID,
    dircopyInstanceID,
    pluginInstanceID,
    pluginName: actualPluginName,
    outputPath,
  };
}
