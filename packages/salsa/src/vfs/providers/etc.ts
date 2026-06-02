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

import { Result, Ok, Err, errorStack } from '@fnndsc/cumin';
import {
  computeResources_getAll,
  ComputeResource,
  groups_getAll,
  ChrisGroup,
  currentUser_get,
  ChrisUser,
  chrisContext,
} from '@fnndsc/cumin';
import { VFSProvider, VFSItem, CpOptions } from '../provider.js';

/** Virtual files exposed under /etc. */
const ETC_FILES: string[] = ['compute.yaml', 'group', 'passwd', 'cube'];

/**
 * VFS provider for /etc — maps ChRIS API resources to Unix-style config files.
 */
export class EtcVfsProvider implements VFSProvider {
  prefix = '/etc';

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

  private async group_render(): Promise<Result<string>> {
    const result: Result<ChrisGroup[]> = await groups_getAll();
    if (!result.ok) return Err();

    const lines: string[] = result.value.map(
      (g: ChrisGroup): string => `${g.name}:x:${g.id}:`
    );
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
