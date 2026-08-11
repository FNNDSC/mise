/**
 * @file ChRIS group membership commands.
 * @module
 */

import {
  groupMembers_getAll as salsa_groupMembers_getAll,
  groupUser_add as salsa_groupUser_add,
  groupUser_remove as salsa_groupUser_remove,
} from '@fnndsc/salsa';
import type {
  GroupMember as SalsaGroupMember,
  GroupMembershipResult as SalsaGroupMembershipResult,
} from '@fnndsc/salsa';

/** Group membership row exposed to Brasa. */
export type GroupMember = SalsaGroupMember;

/** Self-contained membership operation outcome exposed to Brasa. */
export type GroupMembershipResult<T> = SalsaGroupMembershipResult<T>;

/**
 * Fetches every user in one CUBE group.
 *
 * @param groupID - Numeric CUBE group identifier.
 * @returns Every group membership, or Err on failure.
 */
export async function groupMembers_fetch(groupID: number): Promise<GroupMembershipResult<GroupMember[]>> {
  return salsa_groupMembers_getAll(groupID);
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
  return salsa_groupUser_add(groupID, username);
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
  return salsa_groupUser_remove(groupID, username);
}
