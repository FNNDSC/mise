/**
 * @file `/usr/share/<plugin>` — what is known *about* a plugin.
 *
 * A CUBE plugin meta is a plugin's version-independent identity: the record its
 * versions hang off, carrying authors, licence, repository and documentation.
 * It is currently collapsed into a `/bin` entry's name and version field, so
 * none of it is reachable.
 *
 * `/bin` stays flat. Nesting versions under a plugin directory would make an
 * executable a directory — the macOS application-bundle trick, which works but
 * costs a permanently divided view that every surface must be taught
 * separately, and which Plan 9 declined outright. The Unix answer is already in
 * this codebase: `/bin` holds executables and `/usr/bin` holds their help text.
 * Metadata extends that parallel tree rather than nesting the first.
 *
 * @module
 */

import {
  Err,
  Ok,
  errorStack,
  type FilteredResourceData,
  type Result,
} from '@fnndsc/cumin';
import type { CpOptions, VFSItem, VFSProvider } from '../provider.js';
import { pluginMetas_listAll } from '../../pluginmetas/index.js';

/** The prefix this provider answers for. */
const PREFIX: string = '/usr/share';

/** The fields projected as files inside a plugin's share directory. */
const SHARE_FIELDS: readonly string[] = [
  'title', 'authors', 'license', 'type', 'stars', 'public_repo', 'documentation',
];

/**
 * Reads a field from a plugin-meta row.
 *
 * @param row - One plugin-meta row.
 * @param field - The field to read.
 * @returns The value as a string, or an empty string when absent.
 */
function field_text(row: Record<string, unknown>, field: string): string {
  const value: unknown = row[field];
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Projects CUBE plugin metas as `/usr/share`.
 */
export class ShareVfsProvider implements VFSProvider {
  /** @inheritdoc */
  public prefix: string = PREFIX;

  /** @inheritdoc */
  public async list(path: string): Promise<Result<VFSItem[]>> {
    const parts: string[] = path.slice(PREFIX.length).split('/').filter(Boolean);
    const rows: Record<string, unknown>[] = await this.rows_get();

    if (parts.length === 0) {
      return Ok(rows.map((row: Record<string, unknown>): VFSItem => ({
        name: field_text(row, 'name'),
        type: 'dir',
        size: 0,
        owner: field_text(row, 'authors'),
        date: field_text(row, 'creation_date'),
        title: field_text(row, 'title'),
        id: Number(field_text(row, 'id')),
      })));
    }

    if (parts.length === 1) {
      const row: Record<string, unknown> | undefined = this.row_find(rows, parts[0]);
      if (!row) {
        errorStack.stack_push('error', `No plugin named '${parts[0]}' is registered.`);
        return Err();
      }
      return Ok(SHARE_FIELDS
        .filter((field: string): boolean => field_text(row, field).length > 0)
        .map((field: string): VFSItem => ({
          name: field,
          type: 'file',
          size: field_text(row, field).length + 1,
          owner: field_text(row, 'authors'),
          date: field_text(row, 'creation_date'),
        })));
    }

    errorStack.stack_push('error', `${path} is not a plugin metadata path.`);
    return Err();
  }

  /** @inheritdoc */
  public async cp(_src: string, _dest: string, _options: CpOptions): Promise<boolean> {
    errorStack.stack_push('error', 'Plugin metadata is CUBE\'s record of a plugin; it cannot be copied.');
    return false;
  }

  /** @inheritdoc */
  public async read(path: string): Promise<Result<string>> {
    const parts: string[] = path.slice(PREFIX.length).split('/').filter(Boolean);
    if (parts.length !== 2) {
      errorStack.stack_push('error', `${path} is not a plugin metadata file.`);
      return Err();
    }
    const row: Record<string, unknown> | undefined = this.row_find(await this.rows_get(), parts[0]);
    if (!row) {
      errorStack.stack_push('error', `No plugin named '${parts[0]}' is registered.`);
      return Err();
    }
    if (!SHARE_FIELDS.includes(parts[1])) {
      errorStack.stack_push('error', `'${parts[1]}' is not a plugin metadata field.`);
      return Err();
    }
    return Ok(`${field_text(row, parts[1])}\n`);
  }

  /**
   * Fetches every plugin meta visible to this session.
   *
   * @returns The rows, empty when the fetch failed.
   */
  private async rows_get(): Promise<Record<string, unknown>[]> {
    const data: FilteredResourceData | null = await pluginMetas_listAll();
    return data?.tableData ?? [];
  }

  /**
   * Finds one plugin meta by name.
   *
   * A `/bin` entry carries its version (`pl-dcm2niix-v1.0.2`) while a meta is
   * version-independent, so a name given in either form resolves here.
   *
   * @param rows - The rows to search.
   * @param name - The plugin name, with or without a version suffix.
   * @returns The matching row, or undefined.
   */
  private row_find(
    rows: Record<string, unknown>[],
    name: string,
  ): Record<string, unknown> | undefined {
    const bare: string = name.replace(/-v[\d.]+$/, '');
    return rows.find((row: Record<string, unknown>): boolean => {
      const metaName: string = field_text(row, 'name');
      return metaName === name || metaName === bare;
    });
  }
}
