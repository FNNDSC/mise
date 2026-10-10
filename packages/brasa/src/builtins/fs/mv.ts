/**
 * @file Builtin mv command.
 * Moves or renames files/directories, reported as a command envelope.
 */
import chalk from 'chalk';
import path from 'path';
import { ParsedArgs, commandArgs_process, optionsUnknown_refusal, path_resolve } from '../utils.js';
import { listingCache_get, vfsDispatcher_get } from '../../core/filesystem.js';
import type { ListingCache } from '../../core/backend.js';
import { destination_ask, destination_missing } from './destination.js';
import { entry_at, entry_isFolder } from './entries.js';
import { mv_render, vfs_fail, vfsRefusal_text, type VFSDispatcher, type VfsOutcome } from '@fnndsc/fond';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

/** Outcome of one move source, for the envelope model. */
export interface MvOutcome {
  source: string;
  moved: boolean;
}

/** Model payload for the fs.mv envelope. */
export interface MvModelData {
  dest: string;
  outcomes: MvOutcome[];
  moved: number;
  failed: number;
}

/**
 * Moves or renames a file or directory.
 * Supports multiple sources when destination is a directory.
 *
 * @param args - [src1, src2, ..., dest] or [src, dest]
 * @returns An envelope whose rendered text reports progress and results and
 *   whose model carries per-source outcomes.
 */
export async function builtin_mv(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const refusal: string | null = optionsUnknown_refusal('mv', parsed, ['t']);
  if (refusal !== null) return envelope_error('', undefined, `${chalk.red(refusal)}\n`);
  const pathArgs: string[] = parsed._ as string[];

  // `-t <dir>` names the TARGET DIRECTORY, so every operand is a source —
  // the shell's own answer to "several things, one destination". Given no
  // value it is a question (an-absent-value-is-a-question), and the answer
  // wants a directory: `mv a b` without it means rename a ONTO b, which
  // is the right reading of that line and the wrong thing for a set.
  const target: unknown = parsed.t;
  if (target !== undefined && pathArgs.length > 0) {
    if (typeof target === 'string' && target !== '') {
      return mv_run({ sources: pathArgs, dest: target });
    }
    const chosen: string = await destination_ask({
      verb: 'mv', commit: 'MOVE HERE', sources: pathArgs, wantsDirectory: true,
    });
    if (chosen === '') {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(destination_missing('mv'))}\n`);
    }
    return mv_run({ sources: pathArgs, dest: chosen });
  }

  // One operand names what to move and not where: that is a question, not a
  // usage error. The answer opens where the file already lives and offers
  // its own name, so the ordinary case is a rename.
  if (pathArgs.length === 1) {
    const chosen: string = await destination_ask({
      verb: 'mv', commit: 'MOVE HERE', sources: pathArgs,
    });
    if (chosen === '') {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(destination_missing('mv'))}\n`);
    }
    return mv_run({ sources: pathArgs, dest: chosen });
  }

  // Last arg is destination, all others are sources
  return mv_run({
    sources: pathArgs.slice(0, -1),
    dest: pathArgs.length > 0 ? pathArgs[pathArgs.length - 1] : '',
  });
}

/**
 * Moves one entry. Into a folder the destination names (or one named with a
 * trailing slash) it keeps its name; otherwise it takes the destination's.
 * A rename inside a projection (a tag under /proc/tags) is the projection's,
 * and across one it refuses.
 *
 * @param dispatcher - The session's filesystem.
 * @param srcPath - The absolute source.
 * @param destPath - The absolute destination.
 * @param intoFolder - Whether the destination was written with a trailing slash.
 * @returns Done, or why not.
 */
async function entry_move(dispatcher: VFSDispatcher, srcPath: string, destPath: string, intoFolder: boolean): Promise<VfsOutcome> {
  if (dispatcher.path_isVirtual(srcPath) || dispatcher.path_isVirtual(destPath)) return dispatcher.rename(srcPath, destPath);
  if ((await entry_at(dispatcher, srcPath)) === null) return vfs_fail('ENOENT', `Source not found: ${srcPath}`);
  const finalDest: string = intoFolder || entry_isFolder(await entry_at(dispatcher, destPath))
    ? path.posix.join(destPath, path.posix.basename(srcPath))
    : destPath;
  return dispatcher.rename(srcPath, finalDest);
}

/** Typed invocation options for mv. */
export interface MvOptions {
  /** Source paths, absolute or relative to the session cwd. */
  sources: string[];
  /** Destination path (a directory when several sources are given). */
  dest: string;
}

/**
 * Moves or renames files or directories: the shared typed core behind the
 * parsed builtin and the typed API.
 *
 * @param options - Sources and destination.
 * @returns An envelope whose rendered text reports results and whose
 *   `fs.mv` model carries per-source outcomes.
 */
export async function mv_run(options: MvOptions): Promise<CommandEnvelope> {
  const sources: string[] = options.sources;
  const dest: string = options.dest;

  if (sources.length === 0 || dest === '') {
    return envelope_error(`${chalk.red('Usage: mv <source...> <dest>')}\n`);
  }

  const destPath: string = await path_resolve(dest);
  const listCache: ListingCache = listingCache_get();
  const dispatcher: VFSDispatcher = vfsDispatcher_get();
  let successCount: number = 0;
  let failCount: number = 0;
  let rendered: string = '';
  let renderedErr: string = '';
  const outcomes: MvOutcome[] = [];

  for (const src of sources) {
    try {
      const srcPath: string = await path_resolve(src);

      // For multiple sources, show which file we're moving
      if (sources.length > 1) {
        rendered += `${chalk.gray(`Moving ${srcPath}...`)}\n`;
      } else {
        rendered += `Moving ${srcPath} to ${destPath}...\n`;
      }

      const moved: VfsOutcome = await entry_move(dispatcher, srcPath, destPath, dest.endsWith('/'));
      const success: boolean = moved.ok;

      if (sources.length === 1) {
        rendered += `${mv_render(srcPath, destPath, success)}\n`;
      }
      if (!moved.ok) {
        // The mount said WHY; a bare "Failed to move" makes an operator
        // guess at a reason that was already known.
        const said: string = moved.reason ?? vfsRefusal_text('rename', moved, srcPath, destPath);
        renderedErr += `${chalk.red(said.startsWith('mv:') ? said : `mv: ${said}`)}\n`;
      }

      outcomes.push({ source: srcPath, moved: success });
      if (success) {
        successCount++;
        // Invalidate the source's parent AND the moved subtree: listings
        // cached beneath the old path would otherwise serve the vanished
        // tree until their TTL expires.
        const srcDir: string = path.posix.dirname(srcPath);
        listCache.cache_invalidate?.(srcDir);
        listCache.cache_invalidateTree?.(srcPath);
      } else {
        failCount++;
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      renderedErr += `${chalk.red(`mv: ${src}: ${msg}`)}\n`;
      outcomes.push({ source: src, moved: false });
      failCount++;
    }
  }

  // Invalidate the destination subtree (a moved directory replaces whatever
  // listings were cached beneath it) and its parent.
  listCache.cache_invalidateTree?.(destPath);
  const destParent: string = path.posix.dirname(destPath);
  listCache.cache_invalidate?.(destParent);

  // Summary for multiple files
  if (sources.length > 1) {
    if (failCount === 0) {
      rendered += `${chalk.green(`✓ Moved ${successCount} file(s) to ${destPath}`)}\n`;
    } else {
      rendered += `${chalk.yellow(`⚠ Moved ${successCount} file(s), ${failCount} failed`)}\n`;
    }
  }

  const modelData: MvModelData = { dest: destPath, outcomes, moved: successCount, failed: failCount };
  if (failCount > 0) {
    const envelope: CommandEnvelope = envelope_error(rendered, undefined, renderedErr || undefined);
    envelope.model = { kind: 'fs.mv', data: modelData };
    return envelope;
  }
  return envelope_ok(rendered, { kind: 'fs.mv', data: modelData });
}
