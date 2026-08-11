/**
 * @file Group resource operations.
 * @module
 */

import {
  ChRISGroupGroup,
  FilteredResourceData,
  ListOptions,
  Result,
  ChrisGroupMember,
  errorStack,
  groupMembers_getAll as cumin_groupMembers_getAll,
  groupUser_add as cumin_groupUser_add,
  groupUser_remove as cumin_groupUser_remove,
} from '@fnndsc/cumin';

/** Group membership data exposed to adjacent application layers. */
export interface GroupMember {
  id: number;
  username: string;
}

/** Success or user-facing failure from a group membership operation. */
export type GroupMembershipResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Converts Cumin's Result/error-stack pair into an adjacent-layer outcome.
 *
 * @param result - Cumin operation result.
 * @param fallback - Error used when Cumin supplied no detail.
 * @returns A self-contained group membership result.
 */
function groupResult_present<T>(result: Result<T>, fallback: string): GroupMembershipResult<T> {
  if (result.ok) return result;
  const problem: { message: string } | undefined = errorStack.stack_pop();
  return { ok: false, error: problem?.message ?? fallback };
}

/**
 * Lists groups (single page).
 *
 * @param options - Search and pagination options.
 */
export async function groups_list(options: ListOptions): Promise<FilteredResourceData | null> {
  const group: ChRISGroupGroup = new ChRISGroupGroup();
  return await group.asset.resources_listAndFilterByOptions(options);
}

/**
 * Lists all groups across all pages.
 *
 * @param options - Search options (limit/offset managed internally).
 */
export async function groups_listAll(options: Partial<ListOptions> = {}): Promise<FilteredResourceData | null> {
  const group: ChRISGroupGroup = new ChRISGroupGroup();
  return await group.asset.resources_getAll(options);
}

/**
 * Returns available field names for groups.
 */
export async function groupFields_get(): Promise<string[] | null> {
  const group: ChRISGroupGroup = new ChRISGroupGroup();
  const result = await group.asset.resourceFields_get();
  return result ? result.fields : null;
}

/**
 * Lists every user in one CUBE group.
 *
 * @param groupID - Numeric CUBE group identifier.
 * @returns Every group membership, or Err on failure.
 */
export async function groupMembers_getAll(groupID: number): Promise<GroupMembershipResult<GroupMember[]>> {
  const result: Result<ChrisGroupMember[]> = await cumin_groupMembers_getAll(groupID);
  return groupResult_present(result, `Failed to list users in group ${groupID}.`);
}

/**
 * Adds an existing CUBE user to one group.
 *
 * @param groupID - Numeric CUBE group identifier.
 * @param username - Existing CUBE username.
 * @returns The created membership, or Err on failure.
 */
export async function groupUser_add(
  groupID: number,
  username: string,
): Promise<GroupMembershipResult<GroupMember>> {
  const result: Result<ChrisGroupMember> = await cumin_groupUser_add(groupID, username);
  return groupResult_present(result, `Failed to add ${username} to group ${groupID}.`);
}

/**
 * Removes a CUBE user from one group.
 *
 * @param groupID - Numeric CUBE group identifier.
 * @param username - Existing CUBE username.
 * @returns True after removal, or Err on failure.
 */
export async function groupUser_remove(
  groupID: number,
  username: string,
): Promise<GroupMembershipResult<boolean>> {
  const result: Result<boolean> = await cumin_groupUser_remove(groupID, username);
  return groupResult_present(result, `Failed to remove ${username} from group ${groupID}.`);
}
