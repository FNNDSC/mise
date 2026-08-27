/**
 * @file The structured-progress vocabulary.
 *
 * Progress is semantic live telemetry: not command output, never captured into
 * envelopes, never consumed by pipes or redirects. These are the values it may
 * carry. They live with the contract because the wire narrows to them and every
 * surface reads them, while the engine merely produces them.
 *
 * @module
 */

/**
 * Operations that may produce structured progress.
 *
 * `task` is the deliberate none-of-the-above value: work whose activity has no
 * useful name, such as a cache warm-up or a directory scan. It is also the
 * value an unknown operation from a newer peer degrades to, so a surface built
 * against an older enum renders such work generically instead of dropping it.
 */
export const PROGRESS_OPERATIONS = [
  'upload', 'download', 'pull', 'workflow', 'pipeline', 'group', 'task',
] as const;
/** Broad structured-progress producer classes. */
export const PROGRESS_KINDS = ['transfer', 'retrieve', 'workflow', 'inspection'] as const;
/**
 * Lifecycle phases shared by structured-progress operations.
 *
 * `working` is indeterminate: work is under way and neither its extent nor its
 * remaining time is known. The named phases all imply a specific activity,
 * which is precisely what indeterminate work cannot claim.
 */
export const PROGRESS_PHASES = [
  'scanning', 'transferring', 'watching', 'retrying', 'reading', 'working', 'complete', 'failed',
] as const;
/** Units supported by counted progress. */
export const PROGRESS_UNITS = ['files', 'bytes', 'series', 'jobs', 'nodes'] as const;
/** Operation and item states supported by structured progress. */
export const PROGRESS_STATUSES = [
  'running', 'done', 'unconfirmed', 'stalled', 'timeout', 'error', 'unknown',
] as const;

export type ProgressOperation = typeof PROGRESS_OPERATIONS[number];
export type ProgressKind = typeof PROGRESS_KINDS[number];
export type ProgressPhase = typeof PROGRESS_PHASES[number];
export type ProgressUnit = typeof PROGRESS_UNITS[number];
export type ProgressStatus = typeof PROGRESS_STATUSES[number];

// `ProgressEvent` is not declared here. It is inferred from the wire schema in
// `messages.ts`, so the shape the engine emits and the shape the wire carries
// cannot be two things.
