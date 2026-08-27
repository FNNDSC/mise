/**
 * @file Cache module exports.
 *
 * @module
 */
export { ListCache, listCache_get } from './listCache.js';
export type { CacheStats, CacheResult, CacheOptions } from './listCache.js';
export { ProcCache, procCache_get, status_isTerminal, PROC_TERMINAL_STATUSES } from './procCache.js';
export type {
  ProcInstance,
  ProcFeed,
  ProcFeedScopeCounts,
  ProcWarmupProgress,
  ProcCacheState,
  ProcCacheLifecycle,
  ProcCacheSnapshot,
} from './procCache.js';
// Prompt-facing process-index state is contract vocabulary: it lives in
// `@fnndsc/menu`, and callers import it from there. Only its types are named
// here, so cumin — which CommonJS consumers require — carries no runtime
// dependency on the contract package and stays loadable from either module
// system.
export type { ProcPromptState, ProcPromptProgress } from '@fnndsc/menu';
export {
  procCheckpointPath_get,
  procCheckpoint_restore,
  procCheckpoint_save,
  procCheckpoint_watch,
} from './procCheckpoint.js';
export type { ProcCheckpointRestoreResult } from './procCheckpoint.js';
