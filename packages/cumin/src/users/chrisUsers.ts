/**
 * @file ChRIS user identity resource access.
 *
 * @module
 */

import { chrisConnection } from '../connect/chrisConnection.js';
import {
  listData_get,
  itemData_get,
  type Client,
  type User,
  type UserGroupList,
} from '../chrisapi/adapter.js';
import { errorStack } from '../error/errorStack.js';
import { Result, Ok, Err } from '../utils/result.js';
import type { ChrisGroup } from '../groups/chrisGroups.js';

/**
 * Represents the currently authenticated ChRIS user.
 */
export interface ChrisUser {
  id: number;
  username: string;
  email: string;
  is_staff: boolean;
}

/**
 * Represents the authenticated ChRIS user and their CUBE group memberships.
 *
 * @property user - The currently authenticated user.
 * @property groups - Every CUBE group to which the user belongs.
 */
export interface ChrisIdentity {
  user: ChrisUser;
  groups: ChrisGroup[];
}

/** Current user data paired with its ChrisAPI resource. */
interface CurrentUserResource {
  resource: User;
  user: ChrisUser;
}

/**
 * Resolves the current user resource and its typed domain data.
 *
 * @returns The paired ChrisAPI resource and user data, or Err when unavailable.
 */
async function currentUserResource_get(): Promise<Result<CurrentUserResource>> {
  try {
    const client: Client | null = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push('error', 'Not connected to ChRIS. Please log in.');
      return Err();
    }

    const resource: User = await client.getUser();
    const user: ChrisUser | null = itemData_get<ChrisUser>(resource);
    if (!user) {
      errorStack.stack_push('error', 'Current user response carried no data.');
      return Err();
    }
    return Ok({ resource, user });
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `Failed to fetch current user: ${msg}`);
    return Err();
  }
}

/**
 * Fetches the currently authenticated user from ChRIS CUBE.
 *
 * @returns A Result containing ChrisUser, or Err on failure.
 */
export async function currentUser_get(): Promise<Result<ChrisUser>> {
  const current: Result<CurrentUserResource> = await currentUserResource_get();
  return current.ok ? Ok(current.value.user) : Err();
}

/**
 * Fetches the authenticated user together with all CUBE group memberships.
 *
 * @returns A Result containing the current user and their groups, or Err on
 *   connection, user, or membership lookup failure.
 */
export async function currentIdentity_get(): Promise<Result<ChrisIdentity>> {
  const current: Result<CurrentUserResource> = await currentUserResource_get();
  if (!current.ok) return Err();

  try {
    const membershipPageSize: number = 1000;
    const groups: ChrisGroup[] = [];
    let offset: number = 0;
    while (true) {
      const groupList: UserGroupList = await current.value.resource.getGroups({
        limit: membershipPageSize,
        offset,
      });
      const pageGroups: ChrisGroup[] = listData_get<ChrisGroup>(groupList);
      groups.push(...pageGroups);
      if (!groupList.hasNextPage || pageGroups.length === 0) break;
      offset += pageGroups.length;
    }
    return Ok({ user: current.value.user, groups });
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `Failed to fetch current identity: ${msg}`);
    return Err();
  }
}
