/**
 * @file ChRIS Path Analysis
 *
 * This module provides utilities for analyzing ChRIS filesystem paths.
 * It determines execution context based on directory structure and extracts
 * metadata from path components.
 *
 * @module
 */

import * as path from 'path';

/**
 * Determines if a path is within a ChRIS feed directory.
 *
 * Checks if the path contains the pattern: /feeds/feed_<numeric-id>/
 *
 * @param dirPath - The directory path to check.
 * @returns True if the path is within a feed directory, false otherwise.
 *
 * @example
 * ```typescript
 * path_isInFeed('/home/chris/feeds/feed_123/pl-dircopy_456/data/')  // true
 * path_isInFeed('/home/chris/uploads/data/')                         // false
 * ```
 */
export function path_isInFeed(dirPath: string): boolean {
  // A feed root is itself inside the feed, so the final slash is optional.
  const feedPattern: RegExp = /\/feeds\/feed_\d+(?:\/|$)/;
  return feedPattern.test(dirPath);
}

/**
 * Extracts the plugin instance ID of the feed node a path is in.
 *
 * A feed is a chain of nodes, `feed_N/<plugin>_<ID>/<plugin>_<ID>/…`, and
 * each node keeps its output under `data`. The node is the last
 * `<name>_<ID>` of that chain: the walk starts after `feed_N` and stops at
 * the first `data` folder or at any segment that is not a node's name, so a
 * folder inside a node's output (`data/subject_01`, `data/sub_7/run_2`) is
 * never read as a node, however it is named (#1268).
 *
 * @param dirPath - The directory path to analyze.
 * @returns The plugin instance ID as a number, or null if not found.
 *
 * @example
 * ```typescript
 * // From deep inside a node's output
 * path_extractPluginInstanceID('/home/chris/feeds/feed_123/pl-dircopy_456/data/subject_01/')
 * // Returns: 456
 *
 * // A child node, from its data directory
 * path_extractPluginInstanceID('/home/chris/feeds/feed_123/pl-dircopy_456/pl-dcm2niix_789/data/')
 * // Returns: 789
 * ```
 */
export function path_extractPluginInstanceID(dirPath: string): number | null {
  const nodePattern: RegExp = /^.+_(\d+)$/;
  const segments: string[] = path.normalize(dirPath).split('/').filter((segment: string): boolean => segment !== '');
  const feedAt: number = segments.findIndex((segment: string): boolean => /^feed_\d+$/.test(segment));
  if (feedAt === -1) return null;

  let instanceID: number | null = null;
  for (const segment of segments.slice(feedAt + 1)) {
    if (segment === 'data') break;
    const match: RegExpMatchArray | null = segment.match(nodePattern);
    if (match === null) break;
    instanceID = parseInt(match[1] as string, 10);
  }
  return instanceID;
}

/**
 * Extracts the feed ID from a path.
 *
 * Looks for a `feed_<numeric-id>` directory segment anywhere in the path. This
 * covers both data paths such as `/home/user/feeds/feed_123` and the job-history
 * projection at `/proc/jobs/feed_123`.
 *
 * @param dirPath - The directory path to analyze.
 * @returns The feed ID as a number, or null if not found.
 *
 * @example
 * ```typescript
 * path_extractFeedID('/home/chris/feeds/feed_123/pl-dircopy_456/data/')
 * // Returns: 123
 * ```
 */
export function path_extractFeedID(dirPath: string): number | null {
  const feedPattern: RegExp = /(?:^|\/)feed_(\d+)(?:\/|$)/;
  const match: RegExpMatchArray | null = dirPath.match(feedPattern);

  if (match) {
    return parseInt(match[1], 10);
  }

  return null;
}

/**
 * Finds the highest version of pl-dircopy in a bin listing.
 *
 * If multiple pl-dircopy versions exist (e.g., pl-dircopy-v1.0.0, pl-dircopy-v2.1.0),
 * returns the one with the highest version number.
 *
 * @param binListing - Array of plugin names from /bin directory.
 * @returns The full name of the latest pl-dircopy plugin, or null if not found.
 *
 * @example
 * ```typescript
 * const plugins = ['pl-dircopy-v1.0.0', 'pl-dircopy-v2.1.0', 'pl-other-v1.0.0'];
 * path_findLatestDircopy(plugins);
 * // Returns: 'pl-dircopy-v2.1.0'
 * ```
 */
export function path_findLatestDircopy(binListing: string[]): string | null {
  const dircopyPlugins: string[] = binListing.filter((name: string) => name.startsWith('pl-dircopy-v'));

  if (dircopyPlugins.length === 0) {
    return null;
  }

  if (dircopyPlugins.length === 1) {
    return dircopyPlugins[0];
  }

  // Multiple versions - parse and find highest
  // Pattern: pl-dircopy-vX.Y.Z
  const versionPattern: RegExp = /^pl-dircopy-v(\d+)\.(\d+)\.(\d+)$/;

  interface VersionedPlugin {
    name: string;
    major: number;
    minor: number;
    patch: number;
  }

  const versioned: VersionedPlugin[] = dircopyPlugins
    .map((name: string) => {
      const match: RegExpMatchArray | null = name.match(versionPattern);
      if (!match) return null;
      return {
        name,
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
      };
    })
    .filter((v): v is VersionedPlugin => v !== null);

  if (versioned.length === 0) {
    // Fallback: return first if version parsing failed
    return dircopyPlugins[0];
  }

  versioned.sort((a: VersionedPlugin, b: VersionedPlugin) => {
    if (a.major !== b.major) return b.major - a.major;
    if (a.minor !== b.minor) return b.minor - a.minor;
    return b.patch - a.patch;
  });

  return versioned[0].name;
}
