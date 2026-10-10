/**
 * @file `/proc/tags` — the user's tags, as folders.
 *
 * A CUBE tag is the user's own object, hung on many feeds through taggings.
 * Its folder lists the feeds that wear it, each a link to the feed under
 * `/proc/jobs`. The folders ARE the vocabulary: `mkdir` makes a tag, `rmdir`
 * deletes one no feed wears, and `mv` renames one. A feed is tagged and
 * untagged by its extended attribute (`setfattr`), never here, so a tag
 * folder's entries are read-only and there is one writer of a tagging.
 *
 * @module
 */

import { vfs_fail, vfsOutcome_ofBoolean, vfsOutcome_ofResult, type VfsOutcome } from '@fnndsc/fond';
import {
  Err,
  Ok,
  errorStack,
  tags_index,
  tag_create,
  tag_delete,
  tag_rename,
  type Result,
  type TagEntry,
} from '@fnndsc/cumin';
import type { CpOptions, VFSItem, VFSProvider } from '../provider.js';

/** The prefix this provider answers for. */
export const PROC_TAGS_PREFIX: string = '/proc/tags';

/** Where a feed lives in the process view; a tag folder's entries link there. */
const PROC_JOBS: string = '/proc/jobs';

/** A tag name a folder can carry: one path segment. */
const TAG_NAME: RegExp = /^[^/]+$/;

/**
 * The segments of a path beneath `/proc/tags`.
 *
 * @param pathStr - An absolute path at or beneath the prefix.
 * @returns The segments after the prefix.
 */
function tagPath_parts(pathStr: string): string[] {
  return pathStr.replace(/\/+$/, '').slice(PROC_TAGS_PREFIX.length).split('/').filter(Boolean);
}

/**
 * The one tag name a path names, for the verbs that act on a tag folder.
 *
 * @param pathStr - The path.
 * @param verb - The verb, for the refusal.
 * @returns The name, or null with the refusal stacked.
 */
function tagName_of(pathStr: string, verb: string): string | null {
  const parts: string[] = tagPath_parts(pathStr);
  if (parts.length === 1 && TAG_NAME.test(parts[0])) return parts[0];
  const what: string = parts.length === 0 ? 'the tags folder itself' : 'a feed inside a tag (setfattr tags and untags a feed)';
  errorStack.stack_push('error', `${verb}: ${pathStr}: Operation not permitted (${what})`);
  return null;
}

/**
 * Projects the user's tags as `/proc/tags`.
 */
export class ProcTagsVfsProvider implements VFSProvider {
  /** @inheritdoc */
  public prefix: string = PROC_TAGS_PREFIX;

  /** @inheritdoc */
  public async list(pathStr: string): Promise<Result<VFSItem[]>> {
    const parts: string[] = tagPath_parts(pathStr);
    const index: Result<Map<string, TagEntry>> = await tags_index();
    if (!index.ok) return Err();
    if (parts.length === 0) {
      return Ok([...index.value.values()].map((tag: TagEntry): VFSItem => ({
        name: tag.name,
        type: 'dir',
        size: tag.feeds.length,
        owner: '',
        date: '',
        id: tag.id,
      })));
    }
    const tag: TagEntry | undefined = index.value.get(parts[0]);
    if (tag === undefined || parts.length > 1) {
      errorStack.stack_push('error', `${pathStr}: No such file or directory`);
      return Err();
    }
    return Ok(tag.feeds.map((feedId: number): VFSItem => ({
      name: `feed_${feedId}`,
      type: 'link',
      size: 0,
      owner: '',
      date: '',
      target: `${PROC_JOBS}/feed_${feedId}`,
      id: feedId,
    })));
  }

  /** @inheritdoc */
  public async cp(_src: string, _dest: string, _options: CpOptions): Promise<VfsOutcome> {
    return vfsOutcome_ofBoolean(await this.copy_run(_src, _dest, _options), 'EROFS');
  }

  /** @inheritdoc */
  private async copy_run(_src: string, _dest: string, _options: CpOptions): Promise<boolean> {
    errorStack.stack_push('error', 'cp: a tag is not copied: mkdir makes one, setfattr hangs it on a feed');
    return false;
  }

  /** @inheritdoc */
  public async mkdir(pathStr: string): Promise<VfsOutcome> {
    return vfsOutcome_ofBoolean(await this.folder_make(pathStr), 'EIO');
  }

  /** @inheritdoc */
  private async folder_make(pathStr: string): Promise<boolean> {
    const name: string | null = tagName_of(pathStr, 'mkdir');
    if (name === null) return false;
    return (await tag_create(name)).ok;
  }

  /** @inheritdoc */
  public async rmdir(pathStr: string): Promise<VfsOutcome> {
    return vfsOutcome_ofBoolean(await this.folder_remove(pathStr), 'EIO');
  }

  /** @inheritdoc */
  private async folder_remove(pathStr: string): Promise<boolean> {
    const name: string | null = tagName_of(pathStr, 'rmdir');
    if (name === null) return false;
    return (await tag_delete(name)).ok;
  }

  /** @inheritdoc */
  public async rm(pathStr: string): Promise<VfsOutcome> {
    return this.removal_refusal(pathStr);
  }

  /** @inheritdoc */
  public async rmTree(pathStr: string): Promise<VfsOutcome> {
    return this.removal_refusal(pathStr);
  }

  /**
   * A tag's folder is a tag, and the feeds in it are its taggings: each has
   * its own verb, and a removal names it rather than guess.
   *
   * @param pathStr - The path asked to be removed.
   * @returns The refusal: a tagging is untagged with setfattr, a tag
   *   deleted with rmdir.
   */
  private removal_refusal(pathStr: string): VfsOutcome {
    const parts: string[] = pathStr.slice(PROC_TAGS_PREFIX.length).split('/').filter(Boolean);
    if (parts.length === 2) {
      return vfs_fail('EPERM', `Operation not permitted (setfattr -x tag -v ${parts[0]} ${parts[1]} untags the feed)`);
    }
    return vfs_fail('EISDIR', 'Is a directory (rmdir deletes a tag no feed wears)');
  }

  /** @inheritdoc */
  public async rename(src: string, dest: string): Promise<VfsOutcome> {
    return vfsOutcome_ofBoolean(await this.entry_rename(src, dest), 'EIO');
  }

  /** @inheritdoc */
  private async entry_rename(src: string, dest: string): Promise<boolean> {
    const from: string | null = tagName_of(src, 'mv');
    if (from === null) return false;
    const to: string | null = tagName_of(dest, 'mv');
    if (to === null) return false;
    return (await tag_rename(from, to)).ok;
  }
}
