/**
 * @file Prompt-facing process-index lifecycle state.
 *
 * This is contract vocabulary: it is narrowed by the prompt-context schema and
 * read by every surface that draws a prompt, so it lives with the contract
 * rather than with the cache that happens to produce it.
 *
 * @module
 */

/** User-visible process-index states carried to prompt renderers. */
export const PROC_PROMPT_STATES = ['cold', 'cached', 'failed'] as const;

/** User-visible process-index state carried to prompt renderers. */
export type ProcPromptState = typeof PROC_PROMPT_STATES[number];

/**
 * Prompt-facing progress for cache restoration and reconciliation.
 *
 * @property loaded - Plugin instances currently available.
 * @property total - Authoritative total when CUBE has reported one.
 * @property restored - Whether the available instances came from a checkpoint.
 * @property state - Cold indexing, cached reconciliation, or failed refresh.
 */
export interface ProcPromptProgress {
  loaded: number;
  total?: number;
  restored?: boolean;
  state?: ProcPromptState;
  /** Whether the global index sweep is what `loaded`/`total` describe; absent means yes (older daemons). */
  sweeping?: boolean;
  /** One feed's first-visit topology load in flight, when there is one. */
  feed?: ProcFeedPromptProgress;
  /** Feeds the roster gained (created or shared) in the last half minute. */
  arrived?: number[];
}

/**
 * Prompt-facing progress of one feed's topology load.
 *
 * @property id - The feed being loaded.
 * @property loaded - Plugin instances fetched so far.
 * @property total - The server's count for the feed, zero while unknown.
 */
export interface ProcFeedPromptProgress {
  id: number;
  loaded: number;
  total: number;
}

/**
 * Resolves the prompt state, including compatibility with contexts that only
 * carry the legacy `restored` flag.
 *
 * @param progress - Prompt-facing process-index progress.
 * @returns Explicit state, or one derived from checkpoint restoration.
 */
export function procPromptState_get(progress: ProcPromptProgress): ProcPromptState {
  return progress.state ?? (progress.restored === true ? 'cached' : 'cold');
}
