/**
 * @file How a ChRIS node looks: its status, its error share and its place
 * in the graph, read into what orrery draws by.
 *
 * orrery knows four states and a paint; it has never heard of
 * `finishedWithError`. This is the one place a ChRIS status becomes a look:
 * errors are always visible, a group hues from done toward error by the
 * share of its jobs that failed, the root wears its own cool colour (unless
 * it failed — errors win), work in progress is the accent, settled work is
 * quiet, a stage never run wears the gold.
 *
 * @module
 */
import type { NodeLook, NodeState, Paint } from '@fnndsc/orrery';

/** ChRIS statuses of a stage at work. */
export const RUNNING_STATUSES: ReadonlySet<string> = new Set([
  'created', 'waiting', 'scheduled', 'started', 'registeringFiles',
]);

/**
 * What a look is read from: a node's status (none for a stage never run),
 * its error share when it stands for a group, a hue the host assigned, and
 * its parents.
 */
export interface ChrisLookInput {
  status?: string;
  share?: number;
  hue?: string;
  parentIds: ReadonlyArray<string>;
  joinParentIds: ReadonlyArray<string>;
}

/**
 * A node's state, from its ChRIS status: at work, failed (the stage
 * errored, or every job it stands for did), finished (it ran, or a group
 * settled), or resting.
 *
 * @param node - The node.
 * @returns Its state.
 */
export function chrisState_of(node: ChrisLookInput): NodeState {
  if (node.status !== undefined && RUNNING_STATUSES.has(node.status)) return 'live';
  if (node.status === 'finishedWithError' || (node.share !== undefined && node.share >= 1)) return 'failed';
  if (node.status === 'finishedSuccessfully' || (node.share !== undefined && node.status !== undefined)) return 'done';
  return 'rest';
}

/**
 * A node's colour, named: errors first, then a host's hue, the root, a
 * stage never run, finished, at work, and anything else.
 *
 * @param node - The node.
 * @returns Its paint.
 */
export function chrisPaint_of(node: ChrisLookInput): Paint {
  if (node.share !== undefined && node.status !== 'cancelled') {
    if (node.share >= 1) return { token: 'error' };
    // Square root, so a small share still shows as a trace of red rather
    // than painting a group of eighty thousand red for one failure.
    return { blend: ['done', 'error'], share: Math.sqrt(Math.max(0, node.share)) };
  }
  if (node.status === 'finishedWithError' || node.status === 'cancelled') return { token: 'error' };
  if (node.hue !== undefined) return { hue: node.hue };
  if (node.parentIds.length === 0 && node.joinParentIds.length === 0) return { token: 'root' };
  if (node.status === undefined) return { token: 'template' };
  if (node.status === 'finishedSuccessfully') return { token: 'done' };
  if (RUNNING_STATUSES.has(node.status)) return { token: 'running' };
  return { token: 'unknown' };
}

/**
 * How a ChRIS node looks.
 *
 * @param node - The node.
 * @returns Its state, paint, whether it carries failure, and whether the
 *   finish wave passes through it (a stage finished either way, or never
 *   run; not one at work, cancelled, or in a status no one names).
 */
export function chrisLook_of(node: ChrisLookInput): NodeLook {
  return {
    state: chrisState_of(node),
    paint: chrisPaint_of(node),
    ember: (node.share !== undefined && node.share > 0) || node.status === 'finishedWithError',
    waved: node.status === undefined || node.status === 'finishedSuccessfully' || node.status === 'finishedWithError',
  };
}
