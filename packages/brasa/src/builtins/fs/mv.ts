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
interface MvOutcome {
  source: string;
  moved: boolean;
}

/** Model payload for the fs.mv envelope. */
interface MvModelData {
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

  if (pathArgs.length < 2) {
    return envelope_error(`${chalk.red('Usage: mv <source...> <dest>')}\n`);
  }

  // Last arg is destination, all others are sources
  const dest: string = pathArgs[pathArgs.length - 1];
  const sources: string[] = pathArgs.slice(0, -1);

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
        // Invalidate source directory
        const srcDir: string = path.posix.dirname(srcPath);
        listCache.cache_invalidate(srcDir);
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

  // Invalidate destination directory (always, since files moved into it)
  listCache.cache_invalidate(destPath);
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
