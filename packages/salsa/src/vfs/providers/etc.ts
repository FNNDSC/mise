/**
 * @file /etc virtual filesystem provider.
 *
 * Exposes ChRIS resources as Unix-style /etc files:
 *   /etc/compute.yaml  — compute resources (YAML)
 *   /etc/group         — groups (/etc/group format)
 *   /etc/passwd        — current user (/etc/passwd format)
 *   /etc/cube          — CUBE connection info (YAML)
 *
 * @module
 */

import { Result, Ok, Err, errorStack,
  listCache_get,
} from '@fnndsc/cumin';
import {
  computeResources_getAll,
  ComputeResource,
  groups_getAll,
  groupMembers_getAll,
  ChrisGroup,
  ChrisGroupMember,
  currentUser_get,
  ChrisUser,
  chrisContext,
} from '@fnndsc/cumin';
import { VFSProvider, VFSItem, CpOptions } from '../provider.js';
import { groupMembershipRevision_get } from '../../groups/membershipRevision.js';

/** Virtual files exposed under /etc. */
const ETC_FILES: string[] = ['compute.yaml', 'group', 'passwd', 'cube'];

/** Maximum group membership lists hydrated concurrently for `/etc/group`. */
const GROUP_MEMBERSHIP_CONCURRENCY: number = 4;

/** How long external CUBE membership changes may remain cached. */
const GROUP_PROJECTION_TTL_MS: number = 5 * 60 * 1000;

/** The listing-cache key the rendered `/etc/group` projection lives under (so it checkpoints with the listings). */
const GROUP_PROJECTION_KEY: string = '/etc/group';

/** One connection-scoped, rendered `/etc/group` snapshot. */
interface GroupProjection {
  connectionKey: string;
  content: string;
  membershipRevision: number;
}

/**
 * VFS provider for /etc — maps ChRIS API resources to Unix-style config files.
 */
export class EtcVfsProvider implements VFSProvider {
  prefix = '/etc';
  /** A background re-render of the group projection in flight, if any. */
  private groupRefresh: Promise<void> | null = null;

  /**
   * Lists contents of /etc — the four virtual config files.
   *
   * @param path - Must be '/etc'.
   * @returns VFSItems for each /etc file.
   */
  async list(
    _path: string,
    _options?: { sort?: 'name' | 'size' | 'date' | 'owner'; reverse?: boolean }
  ): Promise<Result<VFSItem[]>> {
    const now: string = new Date().toISOString();
    const items: VFSItem[] = ETC_FILES.map((name: string): VFSItem => ({
      name,
      type: 'file',
      size: 0,
      owner: 'root',
      date: now,
    }));
    return Ok(items);
  }

  /**
   * Read is not supported for /etc as a directory — individual files via read().
   */
  async cp(_src: string, _dest: string, _options: CpOptions): Promise<boolean> {
    errorStack.stack_push('error', 'cp: /etc is a read-only virtual directory');
    return false;
  }

  /**
   * Reads a virtual /etc file and returns its content as a string.
   *
   * @param path - Absolute path like /etc/compute.yaml.
   * @returns File content string or Err.
   */
  async read(path: string): Promise<Result<string>> {
    const filename: string = path.split('/').pop() ?? '';

    switch (filename) {
      case 'compute.yaml':
        return this.computeYaml_render();
      case 'group':
        return this.group_render();
      case 'passwd':
        return this.passwd_render();
      case 'cube':
        return this.cube_render();
      default:
        errorStack.stack_push('error', `${path}: No such file`);
        return Err();
    }
  }

  private async computeYaml_render(): Promise<Result<string>> {
    const result: Result<ComputeResource[]> = await computeResources_getAll();
    if (!result.ok) return Err();

    const lines: string[] = ['# ChRIS compute resources'];
    if (result.value.length === 0) {
      lines.push('# (none)');
    } else {
      for (const r of result.value) {
        lines.push(`- id: ${r.id}`);
        lines.push(`  name: ${r.name}`);
        lines.push(`  compute_url: ${r.compute_url ?? ''}`);
        if (r.description) lines.push(`  description: ${r.description}`);
      }
    }
    return Ok(lines.join('\n') + '\n');
  }

  /**
   * Renders CUBE groups and their usernames in POSIX `/etc/group` form.
   *
   * The rendered projection lives in the listing cache (so it survives a
   * restart with the listings) under a freshness window. A fresh projection
   * serves as is. A stale one for the same connection and membership
   * revision serves at once and re-renders behind itself — membership
   * changes from outside are rare, and a boot must not wait tens of seconds
   * for them. A local membership mutation bumps the revision and forces a
   * synchronous re-render, as before.
   */
  private async group_render(): Promise<Result<string>> {
    const cubeURL: string | null = await chrisContext.ChRISURL_get();
    const cubeUser: string | null = await chrisContext.ChRISuser_get();
    const connectionKey: string = `${cubeURL ?? ''}\u0000${cubeUser ?? ''}`;
    const membershipRevision: number = groupMembershipRevision_get();
    const cached = listCache_get().cache_get<GroupProjection>(GROUP_PROJECTION_KEY);
    const usable: boolean = cached !== null
      && cached.data.connectionKey === connectionKey
      && cached.data.membershipRevision === membershipRevision;
    if (usable && cached !== null) {
      if (!cached.fresh) void this.groupProjection_refresh(connectionKey, membershipRevision);
      return Ok(cached.data.content);
    }
    const rendered: Result<string> = await this.groupProjection_build();
    if (!rendered.ok) return Err();
    listCache_get().cache_set<GroupProjection>(
      GROUP_PROJECTION_KEY,
      { connectionKey, content: rendered.value, membershipRevision },
      { ttl: GROUP_PROJECTION_TTL_MS },
    );
    return Ok(rendered.value);
  }

  /** Re-renders the projection behind a stale serve; one in flight at a time. */
  private groupProjection_refresh(connectionKey: string, membershipRevision: number): Promise<void> {
    if (this.groupRefresh) return this.groupRefresh;
    this.groupRefresh = (async (): Promise<void> => {
      const rendered: Result<string> = await this.groupProjection_build();
      if (!rendered.ok) return;
      listCache_get().cache_set<GroupProjection>(
        GROUP_PROJECTION_KEY,
        { connectionKey, content: rendered.value, membershipRevision },
        { ttl: GROUP_PROJECTION_TTL_MS },
      );
    })()
      .catch((): void => { /* the stale projection stands until the next read */ })
      .finally((): void => { this.groupRefresh = null; });
    return this.groupRefresh;
  }

  /** Fetches every group and its members and renders the file body. */
  private async groupProjection_build(): Promise<Result<string>> {
    const result: Result<ChrisGroup[]> = await groups_getAll();
    if (!result.ok) return Err();

    const lines: string[] = [];
    for (let index: number = 0; index < result.value.length; index += GROUP_MEMBERSHIP_CONCURRENCY) {
      const groupBatch: ChrisGroup[] = result.value.slice(index, index + GROUP_MEMBERSHIP_CONCURRENCY);
      const batchResults: Array<{ group: ChrisGroup; members: Result<ChrisGroupMember[]> }> =
        await Promise.all(groupBatch.map(async (group: ChrisGroup) => ({
          group,
          members: await groupMembers_getAll(group.id),
        })));
      for (const { group, members } of batchResults) {
        if (!members.ok) return Err();
        const usernames: string = members.value
          .map((member: ChrisGroupMember): string => member.username)
          .join(',');
        lines.push(`${group.name}:x:${group.id}:${usernames}`);
      }
    }
    return Ok(lines.join('\n') + '\n');
  }

  private async passwd_render(): Promise<Result<string>> {
    const result: Result<ChrisUser> = await currentUser_get();
    if (!result.ok) return Err();

    const u: ChrisUser = result.value;
    const uid: number = u.id ?? 0;
    const home: string = `/home/${u.username}`;
    const gecos: string = u.email ?? '';
    const line: string = `${u.username}:x:${uid}:${uid}:${gecos}:${home}:chell`;
    return Ok(line + '\n');
  }

  private async cube_render(): Promise<Result<string>> {
    const url: string | null = await chrisContext.ChRISURL_get();
    const user: string | null = await chrisContext.ChRISuser_get();
    const lines: string[] = [
      '# ChRIS CUBE connection',
      `url: ${url ?? '(not connected)'}`,
      `user: ${user ?? '(not connected)'}`,
    ];
    return Ok(lines.join('\n') + '\n');
  }
}
