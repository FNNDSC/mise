/**
 * @file Feed management operations.
 * @module
 */

import {
  ChRISFeed,
  SimpleRecord,
  ChRISObjectParams,
  ChRISFeedGroup,
  FilteredResourceData,
  ListOptions,
  errorStack,
  feed_makePublic,
  feed_makePrivate,
  feed_delete as cumin_feed_delete,
  Result,
} from '@fnndsc/cumin';

/**
 * List feeds based on options.
 *
 * @param options - Search and pagination options.
 * @returns A Promise resolving to FilteredResourceData or null.
 */
export async function feeds_list(options: ListOptions): Promise<FilteredResourceData | null> {
  const feedGroup = new ChRISFeedGroup(); // Instantiate directly

  if (!feedGroup) { // This check might be redundant if constructor always returns valid object
    return null;
  }

  return await feedGroup.asset.resources_listAndFilterByOptions(options);
}

/**
 * Get the list of available fields for feeds.
 *
 * @returns A Promise resolving to an array of field names or null.
 */
export async function feedFields_get(): Promise<string[] | null> {
  const feedGroup = new ChRISFeedGroup(); // Instantiate directly

  if (!feedGroup) {
    return null;
  }

  const results = await feedGroup.asset.resourceFields_get();
  return results ? results.fields : null;
}

/**
 * Create a new feed from a set of directories.
 * 
 * This function orchestrates the creation of a new feed by uploading data
 * from local directories to the ChRIS system.
 *
 * @param dirs - An array of local directory paths to upload.
 * @param params - Optional parameters for the feed (e.g., name, tags).
 * @returns A Promise resolving to the created feed record, or null if creation failed.
 */
export async function feed_create(dirs: string[], params: ChRISObjectParams = {}): Promise<SimpleRecord | null> {
  const chrisFeed = new ChRISFeed();
  // For now, assuming dirs is passed as is or joined.
  const dirsArg = Array.isArray(dirs) ? dirs.join(',') : dirs;

  return await chrisFeed.createFromDirs(dirsArg, params);
}

/**
 * Interface for feed sharing options.
 */
export interface FeedShareOptions {
  is_public?: boolean; // True to make public, false to make unpublic
  // Add other sharing options here if needed, e.g., for specific users/groups
  [key: string]: unknown;
}

/**
 * Shares a feed with specified ID and options.
 *
 * @param feedId - The ID of the feed to share.
 * @param options - Sharing options, e.g., { is_public: true } to make public.
 * @returns A Promise resolving to true on successful sharing, false otherwise.
 */
export async function feeds_share(feedId: number, options: FeedShareOptions): Promise<boolean> {
  // Use cumin's feed functions
  if (options.is_public === true) {
    const result: Result<boolean> = await feed_makePublic(feedId);
    return result.ok && result.value;
  } else if (options.is_public === false) {
    const result: Result<boolean> = await feed_makePrivate(feedId);
    return result.ok && result.value;
  }

  // Implement other sharing mechanisms (user/group) if needed based on options
  errorStack.stack_push("error", "No valid sharing option specified (e.g., --is_public).");
  return false;
}

/**
 * Deletes a feed by its ID.
 *
 * @param id - The ID of the feed to delete.
 * @returns A Promise resolving to true on success, false on failure.
 */
export async function feed_delete(id: number): Promise<boolean> {
  // Use cumin's feed_delete function
  const result: Result<boolean> = await cumin_feed_delete(id);
  return result.ok && result.value;
}
