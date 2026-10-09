/**
 * @file What the file tools ask of the session's filesystem beyond one
 * operation: what holds a path, and a folder made with its parents.
 *
 * @module
 */
import { vfs_ok, vfs_failFromStack, errorStack, type Result, type VFSDispatcher, type VFSItem, type VfsOutcome } from '@fnndsc/fond';

/**
 * What holds a path, as its parent lists it.
 *
 * @param dispatcher - The session's filesystem.
 * @param targetPath - The absolute path.
 * @returns The entry, or null when the parent does not name it or cannot
 *   be listed (what the listing said is drained: not being there is an answer).
 */
export async function entry_at(dispatcher: VFSDispatcher, targetPath: string): Promise<VFSItem | null> {
  const clean: string = targetPath.length > 1 && targetPath.endsWith('/') ? targetPath.slice(0, -1) : targetPath;
  const slash: number = clean.lastIndexOf('/');
  const name: string = clean.slice(slash + 1);
  const mark: number = errorStack.checkpoint_mark();
  const siblings: Result<VFSItem[]> = await dispatcher.list(clean.slice(0, slash) || '/');
  errorStack.checkpoint_drain(mark);
  if (!siblings.ok) return null;
  return siblings.value.find((item: VFSItem): boolean => item.name === name) ?? null;
}

/**
 * Whether an entry is a folder: a store's folder or a mount point.
 *
 * @param entry - The entry, or null.
 * @returns True for a folder.
 */
export function entry_isFolder(entry: VFSItem | null): boolean {
  return entry !== null && (entry.type === 'dir' || entry.type === 'vfs');
}

/**
 * Makes a folder and its missing parents (`mkdir -p`): in one step where the
 * mount offers it (CUBE makes parents with the folder), else each missing
 * parent in turn, a parent already there being fine.
 *
 * @param dispatcher - The session's filesystem.
 * @param targetPath - The folder.
 * @returns Done, or why not (`EEXIST` when something is already there).
 */
export async function folderTree_make(dispatcher: VFSDispatcher, targetPath: string): Promise<VfsOutcome> {
  if (dispatcher.mkdirTree_offered(targetPath)) return dispatcher.mkdirTree(targetPath);
  const parts: string[] = targetPath.split('/').filter((part: string): boolean => part.length > 0);
  let walked: string = '';
  for (let i: number = 0; i < parts.length - 1; i++) {
    walked += `/${parts[i]}`;
    const made: VfsOutcome = await dispatcher.mkdir(walked);
    if (!made.ok && made.errno !== 'EEXIST') return made;
  }
  return parts.length === 0 ? vfs_ok(true) : dispatcher.mkdir(targetPath);
}

/**
 * Removes a folder and everything in it (`rm -r`): in one step where the
 * mount offers it (CUBE takes a folder with what it holds), else each entry
 * in turn, deepest first, and the folder last.
 *
 * @param dispatcher - The session's filesystem.
 * @param targetPath - The folder.
 * @returns Done, or why not (the first refusal met).
 */
export async function folderTree_remove(dispatcher: VFSDispatcher, targetPath: string): Promise<VfsOutcome> {
  if (dispatcher.rmTree_offered(targetPath)) return dispatcher.rmTree(targetPath);
  const held: Result<VFSItem[]> = await dispatcher.list(targetPath);
  if (!held.ok) return vfs_failFromStack('EIO');
  for (const item of held.value) {
    const child: string = targetPath === '/' ? `/${item.name}` : `${targetPath}/${item.name}`;
    const removed: VfsOutcome = entry_isFolder(item) ? await folderTree_remove(dispatcher, child) : await dispatcher.rm(child);
    if (!removed.ok) return removed;
  }
  return dispatcher.rmdir(targetPath);
}
