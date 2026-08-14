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
import { groupMembershipRevision_advance } from './membershipRevision.js';

/** Group membership data exposed to adjacent application layers. */
export interface GroupMember {
  id: number;
  username: string;
}

/** An exact CUBE group identity resolved from an operator-facing reference. */
export interface GroupReference {
  id: number;
  name: string;
}

/** Success or user-facing failure from a group membership operation. */
export type GroupMembershipResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Success or user-facing failure from resolving a CUBE group reference. */
export type GroupReferenceResult =
  | { ok: true; value: GroupReference }
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
 * Resolves a numeric ID or exact CUBE group name to one group identity.
 *
 * Numeric operands retain compatibility with ID-oriented automation. Other
 * operands match only `name` exactly; a partial name never chooses a group.
 *
 * @param reference - Numeric group ID or exact group name.
 * @returns Resolved group identity or a self-contained user-facing error.
 */
export async function groupReference_resolve(reference: string): Promise<GroupReferenceResult> {
  const groups: FilteredResourceData | null = await groups_listAll();
  const candidates: GroupReference[] = (groups?.tableData ?? []).flatMap(
    (record: Record<string, unknown>): GroupReference[] => {
      const id: number = typeof record.id === 'number' ? record.id : Number(record.id);
      const name: string | undefined = typeof record.name === 'string' ? record.name : undefined;
      return Number.isInteger(id) && id >= 0 && name !== undefined ? [{ id, name }] : [];
    },
  );
  const numericID: number | undefined = /^\d+$/.test(reference) ? Number(reference) : undefined;
  const matches: GroupReference[] = numericID === undefined
    ? candidates.filter((candidate: GroupReference): boolean => candidate.name === reference)
    : candidates.filter((candidate: GroupReference): boolean => candidate.id === numericID);

  if (matches.length === 1) return { ok: true, value: matches[0] };
  if (matches.length === 0) {
    return numericID === undefined
      ? { ok: false, error: `No group named '${reference}'.` }
      : { ok: false, error: `No group with ID ${numericID}.` };
  }
  const options: string = matches.map(
    (candidate: GroupReference): string => `${candidate.name} (${candidate.id})`,
  ).join(', ');
  return {
    ok: false,
    error: `Group name '${reference}' is ambiguous: ${options}. Use a numeric ID.`,
  };
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
  const presented: GroupMembershipResult<GroupMember> = groupResult_present(
    result,
    `Failed to add ${username} to group ${groupID}.`,
  );
  if (presented.ok) groupMembershipRevision_advance();
  return presented;
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
  const presented: GroupMembershipResult<boolean> = groupResult_present(
    result,
    `Failed to remove ${username} from group ${groupID}.`,
  );
  if (presented.ok) groupMembershipRevision_advance();
  return presented;
}
