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
  /** The earliest feed topology load in flight, when there is one (older readers; the first of `feeds`). */
  feed?: ProcFeedPromptProgress;
  /** Every feed topology load in flight or lately failed, earliest first. */
  feeds?: ProcFeedPromptProgress[];
  /** The roster's own walk in flight: the delta, or the ten-minute full walk. */
  roster?: 'delta' | 'full';
  /** Feeds the roster gained (created or shared) in the last half minute. */
  arrived?: number[];
  /** Feeds whose topology landed in the index lately, each as it stands there. */
  landed?: ProcLandedPromptFeed[];
}

/**
 * One feed as it landed in the index, on the prompt: enough for a surface
 * to place it in the space of everything run here without asking.
 *
 * @property id - The feed.
 * @property jobs - How many plugin instances it holds.
 * @property status - The feed's own status.
 * @property chain - Its plugin names, root first: the shape its pipeline left.
 */
export interface ProcLandedPromptFeed {
  id: number;
  /** The feed's name. */
  title: string;
  jobs: number;
  status: string;
  chain: string[];
  /** Its jobs collapsed by plugin per place in the pipeline: the shape, with counts. */
  groups: ProcPromptJobGroup[];
}

/** One node of a feed's collapsed shape, on the prompt. */
export interface ProcPromptJobGroup {
  plugin: string;
  count: number;
  status: string;
  /** The index of the parent group, or null at the root. */
  parent: number | null;
}

/**
 * A warm-up step that failed behind the prompt and has not since succeeded.
 *
 * @property label - The boot-step label, as the readout named it.
 * @property message - What the failure said.
 */
export interface WarmupFailureReport {
  label: string;
  message: string;
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
  /** What the walk said when it failed; absent while it runs. */
  failed?: string;
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
