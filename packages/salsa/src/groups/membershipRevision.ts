/**
 * @file Revision signal for CUBE group-membership projections.
 * @module
 */

let groupMembershipRevision: number = 0;

/**
 * Returns the current local group-membership revision.
 *
 * Consumers compare this value with derived snapshots so successful local
 * membership mutations invalidate those snapshots without knowing about them.
 *
 * @returns Current membership revision.
 */
export function groupMembershipRevision_get(): number {
  return groupMembershipRevision;
}

/**
 * Advances the revision after a successful local membership mutation.
 *
 * @returns Nothing.
 */
export function groupMembershipRevision_advance(): void {
  groupMembershipRevision += 1;
}
