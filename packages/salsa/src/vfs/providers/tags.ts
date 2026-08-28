/**
 * @file `/tags` — the tags themselves, which feeds link to.
 *
 * A CUBE tag is a first-class, user-owned resource pointing at many feeds; a
 * tagging is the join between one tag and one feed. Projecting a tag as a file
 * *inside* a feed would flatten that many-to-many, and editing the same tag
 * from two feeds would be ambiguous about which one it changed.
 *
 * Unix already answers this shape: one object, many directory entries. The tag
 * lives once, at `/tags/<name>`, and a feed's `tags/` directory holds links to
 * it. The tagging *is* the link — which makes the operations fall out of the
 * filesystem rather than needing commands of their own.
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
import { tags_listAll } from '../../tags/index.js';

/** The prefix this provider answers for. */
const PREFIX: string = '/tags';

/**
 * Reads a field from a tag row.
 *
 * @param row - One tag row.
 * @param field - The field to read.
 * @returns The value as a string, or an empty string when absent.
 */
function field_text(row: Record<string, unknown>, field: string): string {
  const value: unknown = row[field];
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Projects CUBE tags as `/tags`.
 */
export class TagsVfsProvider implements VFSProvider {
  /** @inheritdoc */
  public prefix: string = PREFIX;

  /** @inheritdoc */
  public async list(path: string): Promise<Result<VFSItem[]>> {
    const parts: string[] = path.slice(PREFIX.length).split('/').filter(Boolean);
    if (parts.length > 0) {
      // A tag is a leaf: its colour and name are its content, not a directory
      // of further things.
      errorStack.stack_push('error', `${path} is a tag, not a directory.`);
      return Err();
    }

    const data: FilteredResourceData | null = await tags_listAll();
    const rows: Record<string, unknown>[] = data?.tableData ?? [];
    return Ok(rows.map((row: Record<string, unknown>): VFSItem => ({
      name: field_text(row, 'name'),
      type: 'file',
      size: 0,
      owner: field_text(row, 'owner_username'),
      date: field_text(row, 'creation_date'),
      title: field_text(row, 'color'),
      id: Number(field_text(row, 'id')),
    })));
  }

  /** @inheritdoc */
  public async cp(_src: string, _dest: string, _options: CpOptions): Promise<boolean> {
    // Copying a tag would mint a second tag with the same name, which is
    // exactly the confusion a shared object exists to avoid. Linking a feed to
    // an existing tag is the operation people actually want, and that belongs
    // to the feed's `tags/` directory rather than here.
    errorStack.stack_push('error', 'A tag is shared, not copied. Link a feed to it instead.');
    return false;
  }

  /** @inheritdoc */
  public async read(path: string): Promise<Result<string>> {
    const name: string = path.slice(PREFIX.length).replace(/^\/+/, '');
    const data: FilteredResourceData | null = await tags_listAll();
    const row: Record<string, unknown> | undefined = (data?.tableData ?? [])
      .find((entry: Record<string, unknown>): boolean => field_text(entry, 'name') === name);
    if (!row) {
      errorStack.stack_push('error', `No tag named '${name}'.`);
      return Err();
    }
    return Ok(
      `name: ${field_text(row, 'name')}\n` +
      `color: ${field_text(row, 'color')}\n` +
      `owner: ${field_text(row, 'owner_username')}\n`,
    );
  }
}
