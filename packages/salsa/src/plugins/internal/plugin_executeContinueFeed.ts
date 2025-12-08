/**
 * @file Handle plugin execution for continuing an existing feed
 * @module
 */
import {
  Dictionary,
  errorStack,
  path_extractFeedID,
  path_extractPluginInstanceID,
} from '@fnndsc/cumin';
import { plugin_run } from '../index.js';
import { PluginExecutionResult } from '../plugin_executeInPlace.js';

/**
 * Handles the "continue feed" execution path.
 * Runs a plugin within an existing feed.
 *
 * @param pluginName - The plugin to run.
 * @param pluginParams - Parameters for the plugin.
 * @param contextParams - Context parameters (e.g., instance_title).
 * @param cwd - Current working directory.
 * @returns The execution result or null on failure.
 */
export async function plugin_executeContinueFeed(
  pluginName: string,
  pluginParams: Dictionary,
  contextParams: Dictionary,
  cwd: string
): Promise<PluginExecutionResult | null> {
  const previousID: number | null = path_extractPluginInstanceID(cwd);
  if (previousID === null) {
    errorStack.stack_push(
      'error',
      'Could not extract plugin instance ID from current directory path'
    );
    return null;
  }

  const feedID: number | null = path_extractFeedID(cwd);
  if (feedID === null) {
    errorStack.stack_push('error', 'Could not extract feed ID from current directory path');
    return null;
  }

  const combinedParams: Dictionary = {
    ...pluginParams,
    previous_id: previousID,
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

  const pathParts: string[] = cwd.split('/');
  let previousPluginPath: string = '';

  for (let i: number = 0; i < pathParts.length; i++) {
    if (pathParts[i].endsWith(`_${previousID}`)) {
      previousPluginPath = pathParts.slice(0, i + 1).join('/');
      break;
    }
  }

  if (!previousPluginPath) {
    const username: string = cwd.split('/')[2];
    previousPluginPath = `/home/${username}/feeds/feed_${feedID}/previous_${previousID}`;
  }

  const outputPath: string = `${previousPluginPath}/${actualPluginName}_${pluginInstanceID}/data/`;

  return {
    pluginInstanceID,
    pluginName: actualPluginName,
    outputPath,
  };
}
