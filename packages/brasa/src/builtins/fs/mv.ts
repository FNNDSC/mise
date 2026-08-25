/**
 * @file Builtin mv command.
 * Moves or renames files/directories, reported as a command envelope.
 */
import chalk from 'chalk';
import path from 'path';
import { CommandEnvelope, listCache_get, envelope_ok, envelope_error } from '@fnndsc/cumin';
import type { ListCache } from '@fnndsc/cumin';
import { ParsedArgs, commandArgs_process, path_resolve } from '../utils.js';
import { files_mv as chefs_mv_cmd } from '@fnndsc/chili/commands/fs/mv.js';
import { mv_render } from '@fnndsc/chili/views/fs.js';

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
  const pathArgs: string[] = parsed._ as string[];

  // Last arg is destination, all others are sources
  return mv_run({
    sources: pathArgs.slice(0, -1),
    dest: pathArgs.length > 0 ? pathArgs[pathArgs.length - 1] : '',
  });
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
  const listCache: ListCache = listCache_get();
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

      const success: boolean = await chefs_mv_cmd(srcPath, destPath);

      if (sources.length === 1) {
        rendered += `${mv_render(srcPath, destPath, success)}\n`;
      }

      outcomes.push({ source: srcPath, moved: success });
      if (success) {
        successCount++;
        // Invalidate the source's parent AND the moved subtree: listings
        // cached beneath the old path would otherwise serve the vanished
        // tree until their TTL expires.
        const srcDir: string = path.posix.dirname(srcPath);
        listCache.cache_invalidate(srcDir);
        listCache.cache_invalidateTree(srcPath);
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
  listCache.cache_invalidateTree(destPath);
  const destParent: string = path.posix.dirname(destPath);
  listCache.cache_invalidate(destParent);

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
