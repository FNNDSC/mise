/**
 * @file The session's filesystem, as the core reaches it: the backend's
 * dispatcher and listing cache, or the core's own when the backend has none.
 *
 * @module
 */
import { VFSDispatcher } from '@fnndsc/fond';
import { backendInstalled_get, type BackendFilesystem, type ListingCache } from './backend.js';

/** A cache that keeps nothing: every listing is read afresh. */
const NO_CACHE: ListingCache = {
  cache_get: (): null => null,
  cache_set: (): void => undefined,
};

/** The core's own dispatcher, for a backend with no filesystem: its mounts, and nothing beneath them. */
let coreDispatcher: VFSDispatcher | null = null;

/**
 * The filesystem every path goes through.
 *
 * @returns The backend's dispatcher, or the core's own.
 */
export function vfsDispatcher_get(): VFSDispatcher {
  const own: BackendFilesystem | undefined = backendInstalled_get()?.vfs;
  if (own !== undefined) return own.dispatcher;
  coreDispatcher ??= new VFSDispatcher();
  return coreDispatcher;
}

/**
 * Where listings are kept between reads.
 *
 * @returns The backend's cache, or one that keeps nothing.
 */
export function listingCache_get(): ListingCache {
  return backendInstalled_get()?.vfs?.cache ?? NO_CACHE;
}

/**
 * Whether a path's listing may be kept.
 *
 * @param path - The absolute path.
 * @returns True unless the backend says otherwise.
 */
export function listingCache_holds(path: string): boolean {
  return backendInstalled_get()?.vfs?.cache_holds?.(path) ?? true;
}
