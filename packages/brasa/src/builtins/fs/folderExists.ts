/**
 * @file Whether a CFS folder stands at a path.
 *
 * The same question `cd` asks before it moves: the logical path taken to
 * its physical one (through links, unless the session is already physical),
 * then the folder looked up by that path and matched exactly — CUBE answers
 * a lookup for a missing path with its nearest ancestor, so a match on the
 * path itself is what says it exists.
 *
 * @module
 */
import { session } from '../../session/index.js';
import { path_resolveLinks } from '../utils.js';
import { errorStack } from '@fnndsc/cumin';
import type { Client, Result } from '@fnndsc/cumin';
import { folder_verifyPathMatch, vfsPath_isStructural, vfsPath_normalize } from './cd.js';

/**
 * Reports whether a folder exists at a logical path.
 *
 * @param logicalPath - The resolved logical path.
 * @returns True when a folder stands exactly there; false when nothing
 *   does, or when the path cannot be taken to a physical one.
 */
export async function folder_checkExists(logicalPath: string): Promise<boolean> {
  // A lookup of a path that is not there is an answer, not a failure: what
  // it leaves on the error stack is drained, or a mkdir that succeeded
  // would exit 1 on its own question.
  const checkpoint: number = errorStack.checkpoint_mark();
  try {
    return await folderExists_ask(logicalPath);
  } finally {
    errorStack.checkpoint_drain(checkpoint);
  }
}

/**
 * Asks whether a folder stands at a logical path.
 *
 * @param logicalPath - The resolved logical path.
 * @returns True when a folder stands exactly there.
 */
async function folderExists_ask(logicalPath: string): Promise<boolean> {
  const cleanPath: string = vfsPath_normalize(logicalPath);
  if (vfsPath_isStructural(cleanPath)) return true;
  const client: Client | null = await session.connection.client_get();
  if (!client) return false;
  let physicalPath: string;
  if (session.physicalMode_get()) {
    physicalPath = await path_resolveLinks(cleanPath);
  } else {
    const { logical_toPhysical } = await import('@fnndsc/chili/utils');
    const physical: Result<string> = await logical_toPhysical(cleanPath);
    if (!physical.ok) return false;
    physicalPath = physical.value;
  }
  try {
    const folder: unknown = await client.getFileBrowserFolderByPath(physicalPath);
    return folder_verifyPathMatch(folder as Parameters<typeof folder_verifyPathMatch>[0], physicalPath);
  } catch {
    return false;
  }
}
