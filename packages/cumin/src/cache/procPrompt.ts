/**
 * @file Prompt-facing process-index lifecycle state.
 *
 * Kept separate from the cache implementation so frontends and wire schemas
 * can consume this small contract without loading Cumin's full runtime barrel.
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
