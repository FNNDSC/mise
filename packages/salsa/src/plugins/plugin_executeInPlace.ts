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
  Dictionary,
} from '@fnndsc/cumin';
import { plugin_executeNewFeed } from './internal/plugin_executeNewFeed.js';
import { plugin_executeContinueFeed } from './internal/plugin_executeContinueFeed.js';

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
  const isInFeed: boolean = path_isInFeed(cwd);

  if (!isInFeed) {
    return plugin_executeNewFeed(
      pluginName,
      pluginParams,
      contextParams,
      cwd,
      binListing
    );
  } else {
    return plugin_executeContinueFeed(
      pluginName,
      pluginParams,
      contextParams,
      cwd
    );
  }
}
