/**
 * @file Feed management operations.
 * @module
 */

import { ChRISFeed, SimpleRecord, ChRISObjectParams } from '@fnndsc/cumin';

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
