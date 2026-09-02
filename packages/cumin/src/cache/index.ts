/**
 * @file Cache module exports.
 *
 * @module
 */
export { ListCache, listCache_get } from './listCache.js';
export type { CacheStats, CacheResult, CacheOptions, ListCacheSnapshot, ListCacheEntrySnapshot } from './listCache.js';
export {
  listCheckpointPath_get,
  listCheckpoint_restore,
  listCheckpoint_save,
  listCheckpoint_watch,
} from './listCheckpoint.js';
export type { ListCheckpointRestoreResult } from './listCheckpoint.js';
export { ProcCache, procCache_get, status_isTerminal, feed_isActive, feedTopology_changed, PROC_TERMINAL_STATUSES } from './procCache.js';
export type {
  ProcInstance,
  ProcFeed,
  ProcFeedScopeCounts,
  ProcWarmupProgress,
  ProcCacheState,
  ProcCacheLifecycle,
  ProcCacheSnapshot,
  ProcFeedSnapshot,
  ProcCacheChange,
  ProcCacheListener,
} from './procCache.js';
// Prompt-facing process-index state is contract vocabulary: it lives in
// `@fnndsc/menu`, and callers import it from there.
//
// Only its *types* are named here, and that is a constraint rather than a
// preference. cumin emits CommonJS while menu is an ES module, so a runtime
// import would break any bundle that reaches cumin — the failure surfacing in
// a bundler rather than at the call site. Types are erased at compile time, so
// this file carries no runtime dependency on menu at all. The constraint lifts
// when cumin becomes an ES module; see "The module-format split" in
// docs/menu.adoc.
export type { ProcPromptState, ProcPromptProgress } from '@fnndsc/menu';
export {
  procCheckpointPath_get,
  procCheckpointDir_get,
  procCheckpoint_restore,
  procCheckpoint_save,
  procCheckpointFeed_save,
  procCheckpointRoster_save,
  procCheckpoint_watch,
} from './procCheckpoint.js';
export type { ProcCheckpointRestoreResult } from './procCheckpoint.js';
