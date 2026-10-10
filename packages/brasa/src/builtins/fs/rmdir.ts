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
import { path_resolve } from '../utils.js';
import { listingCache_get, vfsDispatcher_get } from '../../core/filesystem.js';
import { vfsRefusal_text, type VfsErrno, type VfsOutcome } from '@fnndsc/fond';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

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
 * What rmdir says when a folder was not removed: the mount's reason after
 * the operand (unless the mount already named the verb), else the errno's
 * sentence.
 *
 * @param refused - The failure.
 * @param pathArg - The operand as typed.
 * @returns The line.
 */
function rmdirRefusal_text(refused: { errno: VfsErrno; reason?: string }, pathArg: string): string {
  if (refused.reason === undefined) return vfsRefusal_text('rmdir', refused, pathArg);
  if (refused.reason.startsWith('rmdir:')) return refused.reason;
  // A projection names the folder first (`urgent: Directory not empty`); rmdir has named it already.
  return `rmdir: failed to remove '${pathArg}': ${refused.reason.replace(/^[^:]*: /, '')}`;
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
    // Every mount says why it will not: a folder that is not there, that
    // holds something, or a tag a feed still wears.
    const removed: VfsOutcome = await vfsDispatcher_get().rmdir(targetPath);
    const refusal: string | null = removed.ok ? null : rmdirRefusal_text(removed, pathArg);
    if (refusal !== null) renderedErr += `${chalk.red(refusal)}\n`;
    else listingCache_get().cache_invalidate?.(targetPath.slice(0, targetPath.lastIndexOf('/')) || '/');
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
