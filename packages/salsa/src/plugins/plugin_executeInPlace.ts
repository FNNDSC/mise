/**
 * @file Plugin Execution In Place
 *
 * This module provides the high-level "execute plugin in place" intent,
 * which runs a plugin based on the current working directory context.
 *
 * @module
 */

import {
  path_isInFeed,
  path_extractPluginInstanceID,
  path_extractFeedID,
  path_findLatestDircopy,
  Dictionary,
  errorStack,
} from '@fnndsc/cumin';
import { feed_create } from '../feeds/index.js';
import { plugin_run } from './index.js';
import * as path from 'path';

/**
 * Result of plugin execution in place.
 */
export interface PluginExecutionResult {
  /** Feed ID (present if new feed was created) */
  feedID?: number;
  /** Dircopy plugin instance ID (present if new feed was created) */
  dircopyInstanceID?: number;
  /** The scheduled plugin instance ID */
  pluginInstanceID: number;
  /** The plugin name that was executed */
  pluginName: string;
  /** Path where output will appear */
  outputPath: string;
}

/**
 * Executes a plugin "in place" based on current working directory context.
 *
 * This function orchestrates plugin execution with implicit context from the
 * filesystem path. It handles two scenarios:
 *
 * 1. **New Analysis (non-feed directory):**
 *    - Creates a new feed via pl-dircopy of the current directory
 *    - Runs the plugin with the dircopy instance as previous_id
 *
 * 2. **Continue Analysis (feed directory):**
 *    - Extracts plugin instance ID from the directory path
 *    - Runs the plugin with the extracted previous_id
 *
 * @param pluginName - Full plugin name with version (e.g., pl-dcm2niix-v2.1.1).
 * @param pluginParams - Dictionary of plugin parameters.
 * @param contextParams - Dictionary of context parameters (feed_title, instance_title, etc.).
 * @param cwd - Current working directory.
 * @param binListing - Array of plugin names from /bin (for finding pl-dircopy).
 * @returns Promise resolving to execution result, or null on failure.
 *
 * @example
 * ```typescript
 * // New analysis
 * const result = await plugin_executeInPlace(
 *   'pl-dcm2niix-v2.1.1',
 *   { outputdir: 'results' },
 *   { feed_title: 'Brain MRI Study' },
 *   '/home/chris/uploads/SAG-anon',
 *   binListing
 * );
 *
 * // Continue analysis
 * const result = await plugin_executeInPlace(
 *   'pl-segmentation-v1.0.0',
 *   { threshold: '0.5' },
 *   { instance_title: 'Segment Cortex' },
 *   '/home/chris/feeds/feed_123/pl-dircopy_456/data/',
 *   binListing
 * );
 * ```
 */
export async function plugin_executeInPlace(
  pluginName: string,
  pluginParams: Dictionary,
  contextParams: Dictionary,
  cwd: string,
  binListing: string[]
): Promise<PluginExecutionResult | null> {
  // Analyze path context
  const isInFeed: boolean = path_isInFeed(cwd);

  if (!isInFeed) {
    // ===================================================================
    // NEW FEED CREATION PATH
    // ===================================================================

    // Get feed title (from params or use current directory name)
    const feedTitle: string = (contextParams.feed_title as string) || path.basename(cwd);

    // Find latest pl-dircopy
    const dircopyPlugin: string | null = path_findLatestDircopy(binListing);
    if (!dircopyPlugin) {
      errorStack.stack_push('error', 'pl-dircopy not found. Cannot create feeds.');
      return null;
    }

    // Create feed via pl-dircopy
    const feedResult: Dictionary | null = await feed_create([cwd], {
      params: `title:${feedTitle}`,
    });

    if (!feedResult) {
      errorStack.stack_push('error', 'Failed to create feed');
      return null;
    }

    const feedID: number = feedResult.id as number;
    const dircopyInstanceID: number = (feedResult.pluginInstance as any).data.id as number;

    // Run user's plugin with dircopy as previous_id
    const combinedParams: Dictionary = {
      ...pluginParams,
      previous_id: dircopyInstanceID,
    };

    // Add instance_title if provided
    if (contextParams.instance_title) {
      combinedParams.title = contextParams.instance_title;
    }

    const pluginResult: Dictionary | null = await plugin_run(pluginName, combinedParams);

    if (!pluginResult) {
      errorStack.stack_push('error', 'Failed to run plugin');
      return null;
    }

    const pluginInstanceID: number = pluginResult.id as number;

    // Extract actual plugin name from result (not the search string)
    const actualPluginName: string = pluginResult.plugin_name as string;

    // Construct output path
    // Pattern: /home/<user>/feeds/feed_<feedID>/pl-dircopy_<dircopyID>/<pluginName>_<instanceID>/data/
    const username: string = cwd.split('/')[2]; // Extract from /home/<user>/...
    const outputPath: string = `/home/${username}/feeds/feed_${feedID}/pl-dircopy_${dircopyInstanceID}/${actualPluginName}_${pluginInstanceID}/data/`;

    return {
      feedID,
      dircopyInstanceID,
      pluginInstanceID,
      pluginName: actualPluginName,
      outputPath,
    };
  } else {
    // ===================================================================
    // EXISTING FEED PATH
    // ===================================================================

    // Extract plugin instance ID from path
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

    // Run plugin with extracted previous_id
    const combinedParams: Dictionary = {
      ...pluginParams,
      previous_id: previousID,
    };

    // Add instance_title if provided (for DAG naming)
    if (contextParams.instance_title) {
      combinedParams.title = contextParams.instance_title;
    }

    const pluginResult: Dictionary | null = await plugin_run(pluginName, combinedParams);

    if (!pluginResult) {
      errorStack.stack_push('error', 'Failed to run plugin');
      return null;
    }

    const pluginInstanceID: number = pluginResult.id as number;

    // Extract actual plugin name from result (not the search string)
    const actualPluginName: string = pluginResult.plugin_name as string;

    // Find the previous plugin instance directory in the current path
    // Walk up the path to find the directory matching pattern: <name>_<previousID>
    const pathParts: string[] = cwd.split('/');
    let previousPluginPath: string = '';

    // Find the directory that ends with _<previousID>
    for (let i: number = 0; i < pathParts.length; i++) {
      if (pathParts[i].endsWith(`_${previousID}`)) {
        // Found it - construct path up to and including this directory
        previousPluginPath = pathParts.slice(0, i + 1).join('/');
        break;
      }
    }

    // Fallback: if we couldn't find it, use the feed directory + guess
    if (!previousPluginPath) {
      const username: string = cwd.split('/')[2];
      previousPluginPath = `/home/${username}/feeds/feed_${feedID}/previous_${previousID}`;
    }

    // Construct output path: previous plugin path + new plugin + data
    const outputPath: string = `${previousPluginPath}/${actualPluginName}_${pluginInstanceID}/data/`;

    return {
      pluginInstanceID,
      pluginName: actualPluginName,
      outputPath,
    };
  }
}
