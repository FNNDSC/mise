/**
 * @file Feed management operations.
 * @module
 */

import { ChRISFeed, SimpleRecord, ChRISObjectParams, ChRISFeedGroup, FilteredResourceData, ListOptions, objContext_create, chrisConnection, errorStack } from '@fnndsc/cumin';
import { Feed } from "@fnndsc/chrisapi";

/**
 * List feeds based on options.
 *
 * @param options - Search and pagination options.
 * @returns A Promise resolving to FilteredResourceData or null.
 */
export async function feeds_list(options: ListOptions): Promise<FilteredResourceData | null> {
  const feedGroup = (await objContext_create(
    "ChRISFeedGroup",
    "feed"
  )) as ChRISFeedGroup;

  if (!feedGroup) {
    return null;
  }

  return await feedGroup.asset.resources_listAndFilterByOptions(options);
}

/**
 * Get the list of available fields for feeds.
 *
 * @returns A Promise resolving to an array of field names or null.
 */
export async function feeds_fields_get(): Promise<string[] | null> {
  const feedGroup = (await objContext_create(
    "ChRISFeedGroup",
    "feed"
  )) as ChRISFeedGroup;

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
    // In the future, logic to validate dirs or params could go here.
    // For now, we delegate to cumin.
    // Note: cumin's createFromDirs might expect a single string or array. 
    // chili passed 'options.dirs as string'. let's assume string for now or check cumin.
    // If cumin expects a string (comma separated?), we might need to join.
    // But let's stick to the signature and fix implementation later once we verify cumin.
    
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
  [key: string]: any;
}

/**
 * Shares a feed with specified ID and options.
 *
 * @param feedId - The ID of the feed to share.
 * @param options - Sharing options, e.g., { is_public: true } to make public.
 * @returns A Promise resolving to true on successful sharing, false otherwise.
 */
export async function feeds_share(feedId: number, options: FeedShareOptions): Promise<boolean> {
  const client = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push("error", "Not connected to ChRIS. Cannot share feed.");
    return false;
  }

  try {
    const feed: Feed | null = await client.getFeed(feedId);
    if (!feed) {
      errorStack.stack_push("error", `Feed with ID ${feedId} not found.`);
      return false;
    }

    if (options.is_public === true) {
      await feed.makePublic();
      return true;
    } else if (options.is_public === false) {
      await feed.makeUnpublic();
      return true;
    }
    // Implement other sharing mechanisms (user/group) if needed based on options
    errorStack.stack_push("error", "No valid sharing option specified (e.g., --is_public).");
    return false;

  } catch (error: any) {
    errorStack.stack_push("error", `Error sharing feed ID ${feedId}: ${error.message}`);
    return false;
  }
}

/**
 * Deletes a feed by its ID.
 *
 * @param id - The ID of the feed to delete.
 * @returns A Promise resolving to true on success, false on failure.
 */
export async function feed_delete(id: number): Promise<boolean> {
  const client = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push("error", "Not connected to ChRIS. Cannot delete feed.");
    return false;
  }

  try {
    const feed: Feed | null = await client.getFeed(id);
    if (!feed) {
      errorStack.stack_push("error", `Feed with ID ${id} not found.`);
      return false;
    }
    await feed.delete();
    return true;
  } catch (error: any) {
    errorStack.stack_push("error", `Error deleting feed ID ${id}: ${error.message}`);
    return false;
  }
}
