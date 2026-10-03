/**
 * @file Builtin rmdir: removes empty folders, as on Linux.
 *
 * Inside a projection that holds folders a user makes (a tag under
 * /proc/tags) the projection removes it, and a tag still worn by a feed is
 * "Directory not empty". On the CUBE store a folder that holds anything is
 * refused by name and an empty one is removed; a projection that removes
 * no folders refuses by name.
 *
 * @module
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok, envelope_error, errorStack, listCache_get, type Result, type StackMessage } from '@fnndsc/cumin';
import { vfsDispatcher, type VFSItem } from '@fnndsc/salsa';
import { path_resolve, error_stripDebugPrefix } from '../utils.js';
import { folder_checkExists } from './folderExists.js';
import { rm_run } from './rm.js';

/** Outcome of one rmdir target, for the envelope model. */
export interface RmdirOutcome {
  path: string;
  removed: boolean;
}

/**
 * Parses rmdir's arguments: paths only; any flag is refused by name.
 *
 * @param args - Raw argument tokens.
 * @returns The paths, or the refusal.
 */
export function rmdirArgs_parse(args: string[]): { paths: string[] } | { refused: string } {
  const paths: string[] = [];
  let endOfOptions: boolean = false;
  for (const arg of args) {
    if (endOfOptions || arg === '-' || !arg.startsWith('-')) { paths.push(arg); continue; }
    if (arg === '--') { endOfOptions = true; continue; }
    return { refused: arg.startsWith('--') ? `rmdir: unrecognized option '${arg}'` : `rmdir: invalid option -- '${arg.slice(1, 2)}'` };
  }
  return { paths };
}

/**
 * The reason on the stack, worded as rmdir words it.
 *
 * @param pathArg - The operand as typed.
 * @returns `rmdir: failed to remove '<path>': <reason>`.
 */
function reason_said(pathArg: string): string {
  const reason: StackMessage | undefined = errorStack.stack_pop();
  const said: string = reason === undefined ? 'failed' : error_stripDebugPrefix(reason.message);
  if (said.startsWith('rmdir:')) return said;
  return `rmdir: failed to remove '${pathArg}': ${said.replace(/^[^:]*: /, '')}`;
}

/**
 * Removes one empty folder on the CUBE store: one that holds anything is
 * refused, an empty one goes through rm's own removal.
 *
 * @param targetPath - The resolved path.
 * @param pathArg - The operand as typed.
 * @returns Null when removed, or the refusal's words.
 */
async function storeFolder_remove(targetPath: string, pathArg: string): Promise<string | null> {
  if (!(await folder_checkExists(targetPath))) return `rmdir: failed to remove '${pathArg}': No such file or directory`;
  const held: Result<VFSItem[]> = await vfsDispatcher.list(targetPath);
  if (!held.ok) return reason_said(pathArg);
  if (held.value.length > 0) return `rmdir: failed to remove '${pathArg}': Directory not empty`;
  const removed: CommandEnvelope = await rm_run({ recursive: true, force: false, interactive: false, once: false, paths: [targetPath] });
  return removed.status === 'ok' ? null : `rmdir: failed to remove '${pathArg}'`;
}

/**
 * Removes empty folders.
 *
 * @param args - The folders.
 * @returns An envelope whose model lists each folder's outcome; silent on success.
 */
export async function builtin_rmdir(args: string[]): Promise<CommandEnvelope> {
  const parsed = rmdirArgs_parse(args);
  if ('refused' in parsed) return envelope_error('', undefined, `${chalk.red(parsed.refused)}\n`);
  if (parsed.paths.length === 0) return envelope_error('', undefined, `${chalk.red('Usage: rmdir <directory> [directory...]')}\n`);
  let renderedErr: string = '';
  const outcomes: RmdirOutcome[] = [];
  for (const pathArg of parsed.paths) {
    const targetPath: string = await path_resolve(pathArg);
    let refusal: string | null;
    if (vfsDispatcher.path_isVirtual(targetPath)) {
      refusal = (await vfsDispatcher.rmdir(targetPath)) ? null : reason_said(pathArg);
    } else {
      refusal = await storeFolder_remove(targetPath, pathArg);
    }
    if (refusal !== null) renderedErr += `${chalk.red(refusal)}\n`;
    else listCache_get().cache_invalidate(targetPath.slice(0, targetPath.lastIndexOf('/')) || '/');
    outcomes.push({ path: targetPath, removed: refusal === null });
  }
  const model: { kind: string; data: RmdirOutcome[] } = { kind: 'fs.rmdir', data: outcomes };
  if (renderedErr !== '') {
    process.exitCode = 1;
    const envelope: CommandEnvelope = envelope_error('', undefined, renderedErr);
    envelope.model = model;
    return envelope;
  }
  return envelope_ok('', model);
}
