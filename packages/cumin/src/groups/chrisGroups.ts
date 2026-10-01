/**
 * @file ChRIS group resources and membership operations.
 * @module
 */

import {
  itemData_get,
  items_get,
  listData_get,
  type Client,
  type Group,
  type GroupList,
  type GroupUser,
  type GroupUserList,
  type User,
} from '../chrisapi/adapter.js';
import { collectionPage_wrap, listPages_drain, listPages_walk, type ListPage } from '../chrisapi/contract.js';
import { errorStack } from '../error/errorStack.js';
import { ChRISResourceGroup } from '../resources/chrisResourceGroup.js';
import { Err, Ok, type Result } from '../utils/result.js';

/** Represents a ChRIS group resource. */
export interface ChrisGroup {
  id: number;
  name: string;
}

/** Represents a user's membership in a ChRIS group. */
export interface ChrisGroupMember {
  id: number;
  username: string;
}

/** The group items a session's groups listing served, by id, per client. */
const groupItems: WeakMap<object, Map<number, Group>> = new WeakMap();

/**
 * The listed group items of one client, made on first use.
 *
 * @param client - The connection's chrisapi client.
 * @returns That client's items by group id.
 */
function groupItems_for(client: object): Map<number, Group> {
  const kept: Map<number, Group> | undefined = groupItems.get(client);
  if (kept !== undefined) return kept;
  const made: Map<number, Group> = new Map();
  groupItems.set(client, made);
  return made;
}

/** What a CUBE group membership row says of its user, when it does. */
interface MembershipRow {
  user_id?: unknown;
  user_username?: unknown;
}

/**
 * Reads the member a membership row names, without a request.
 *
 * @param membership - The membership row resource.
 * @returns The member, or null when the row carries no user id and name.
 */
function membershipMember_read(membership: { data?: unknown }): ChrisGroupMember | null {
  const row: MembershipRow | null = itemData_get<MembershipRow>(membership);
  if (!row || typeof row.user_id !== 'number' || typeof row.user_username !== 'string') return null;
  return { id: row.user_id, username: row.user_username };
}

/**
 * Group handler for ChRIS user groups.
 */
export class ChRISGroupGroup extends ChRISResourceGroup {
  constructor() {
    super('Groups', 'getGroups');
  }

  /**
   * Resolves one group resource through this resource group.
   *
   * @param groupID - Numeric CUBE group identifier.
   * @returns The group resource, or null after recording a useful error.
   */
  private async group_get(groupID: number): Promise<Group | null> {
    const client: Client | null = await this.client_get();
    if (!client) {
      errorStack.stack_push('error', 'Not connected to ChRIS. Please log in.');
      return null;
    }
    // The item the groups listing served answers first: chrisapi's getGroup
    // is a list-by-id, and the boot's warm listed every group that way
    // right after listing them all (73 searches on a 73-group CUBE).
    const listed: Group | undefined = groupItems_for(client).get(groupID);
    if (listed !== undefined) return listed;
    const group: Group | null = await client.getGroup(groupID);
    if (!group) errorStack.stack_push('error', `Group ${groupID} was not found.`);
    return group;
  }

  /**
   * Fetches all groups, following the API's pagination links.
   *
   * @returns Every visible CUBE group, or Err on failure.
   */
  async groups_getAll(): Promise<Result<ChrisGroup[]>> {
    try {
      const client: Client | null = await this.client_get();
      if (!client) {
        errorStack.stack_push('error', 'Not connected to ChRIS. Please log in.');
        return Err();
      }
      const items: Map<number, Group> = groupItems_for(client);
      const groups: ChrisGroup[] = await listPages_drain(
        async (offset: number, limit: number): Promise<ListPage<ChrisGroup>> => {
          const page: GroupList = await client.getGroups({ limit, offset });
          // The items are kept by id: a group's members are read off its item.
          const served: Group[] = typeof (page as { getItems?: unknown }).getItems === 'function' ? items_get<Group>(page) : [];
          for (const item of served) {
            const data: ChrisGroup | null = itemData_get<ChrisGroup>(item);
            if (data && typeof data.id === 'number') items.set(data.id, item);
          }
          return collectionPage_wrap(page, listData_get<ChrisGroup>(page));
        },
      );
      return Ok(groups);
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push('error', `Failed to fetch groups: ${message}`);
      return Err();
    }
  }

  /**
   * Fetches every user belonging to one group.
   *
   * @param groupID - Numeric CUBE group identifier.
   * @returns Every group membership, or Err on failure.
   */
  async members_getAll(groupID: number): Promise<Result<ChrisGroupMember[]>> {
    try {
      const group: Group | null = await this.group_get(groupID);
      if (!group) return Err();
      const members: ChrisGroupMember[] = [];
      for await (const step of listPages_walk(
        async (offset: number, limit: number): Promise<ListPage<GroupUser>> => {
          const page: GroupUserList = await group.getUsers({ limit, offset });
          return collectionPage_wrap(page, items_get<GroupUser>(page));
        },
      )) {
        // A membership row names its user (user_id, user_username): the
        // page is the answer. The linked user is fetched only for a row
        // that does not — the boot's group warm once asked CUBE for every
        // member one by one (51 requests on the dev CUBE).
        const pageMembers: ChrisGroupMember[] = await Promise.all(
          step.items.map(async (membershipResource: GroupUser): Promise<ChrisGroupMember> => {
            const named: ChrisGroupMember | null = membershipMember_read(membershipResource);
            if (named) return named;
            const userResource: User = await membershipResource.getUser();
            const member: ChrisGroupMember | null = itemData_get<ChrisGroupMember>(userResource);
            if (!member) throw new Error('group membership carried no linked user data');
            return member;
          }),
        );
        members.push(...pageMembers);
      }
      return Ok(members);
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push('error', `Failed to fetch users for group ${groupID}: ${message}`);
      return Err();
    }
  }

  /**
   * Adds an existing CUBE user to one group.
   *
   * @param groupID - Numeric CUBE group identifier.
   * @param username - Existing CUBE username to add.
   * @returns The created membership, or Err when CUBE refuses the operation.
   */
  async user_add(groupID: number, username: string): Promise<Result<ChrisGroupMember>> {
    try {
      const group: Group | null = await this.group_get(groupID);
      if (!group) return Err();
      const membershipResource: GroupUser = await group.adminAddUser(username);
      const membership: ChrisGroupMember | null = membershipMember_read(membershipResource)
        ?? itemData_get<ChrisGroupMember>(await membershipResource.getUser());
      if (!membership) {
        errorStack.stack_push('error', `CUBE returned no membership for ${username}.`);
        return Err();
      }
      return Ok(membership);
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push('error', `Failed to add ${username} to group ${groupID}: ${message}`);
      return Err();
    }
  }

  /**
   * Removes a CUBE user from one group.
   *
   * @param groupID - Numeric CUBE group identifier.
   * @param username - Existing CUBE username to remove.
   * @returns True after deletion, or Err when the membership does not exist or deletion fails.
   */
  async user_remove(groupID: number, username: string): Promise<Result<boolean>> {
    try {
      const group: Group | null = await this.group_get(groupID);
      if (!group) return Err();
      const membership: GroupUser | null = await group.getUser(username);
      if (!membership) {
        errorStack.stack_push('error', `${username} is not a member of group ${groupID}.`);
        return Err();
      }
      await membership.delete();
      return Ok(true);
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push('error', `Failed to remove ${username} from group ${groupID}: ${message}`);
      return Err();
    }
  }
}

/** @returns Every visible CUBE group, or Err on failure. */
export async function groups_getAll(): Promise<Result<ChrisGroup[]>> {
  return new ChRISGroupGroup().groups_getAll();
}

/**
 * @param groupID - Numeric CUBE group identifier.
 * @returns Every membership in the group, or Err on failure.
 */
export async function groupMembers_getAll(groupID: number): Promise<Result<ChrisGroupMember[]>> {
  return new ChRISGroupGroup().members_getAll(groupID);
}

/**
 * @param groupID - Numeric CUBE group identifier.
 * @param username - Existing CUBE username to add.
 * @returns The created membership, or Err on failure.
 */
export async function groupUser_add(
  groupID: number,
  username: string,
): Promise<Result<ChrisGroupMember>> {
  return new ChRISGroupGroup().user_add(groupID, username);
}

/**
 * @param groupID - Numeric CUBE group identifier.
 * @param username - Existing CUBE username to remove.
 * @returns True after deletion, or Err on failure.
 */
export async function groupUser_remove(groupID: number, username: string): Promise<Result<boolean>> {
  return new ChRISGroupGroup().user_remove(groupID, username);
}
