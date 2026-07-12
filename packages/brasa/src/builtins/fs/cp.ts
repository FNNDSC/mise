/**
 * @file Builtin cp command.
 * Copies files or directories, reported as a command envelope.
 */
import chalk from 'chalk';
import path from 'path';
import { CommandEnvelope, listCache_get, envelope_ok, envelope_error } from '@fnndsc/cumin';
import type { ListCache } from '@fnndsc/cumin';
import { ParsedArgs, commandArgs_process, path_resolve } from '../utils.js';
import { files_cp as chefs_cp_cmd } from '@fnndsc/chili/commands/fs/cp.js';
import { cp_render } from '@fnndsc/chili/views/fs.js';

/** Outcome of one copy source, for the envelope model. */
interface CpOutcome {
  source: string;
  copied: boolean;
}

/** Model payload for the fs.cp envelope. */
interface CpModelData {
  dest: string;
  outcomes: CpOutcome[];
  copied: number;
  failed: number;
}

/**
 * Copies a file or directory.
 * Supports multiple sources when destination is a directory.
 *
 * @param args - [flags, src1, src2, ..., dest]
 * @returns An envelope whose rendered text reports progress and results and
 *   whose model carries per-source outcomes.
 */
export async function builtin_cp(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const pathArgs: string[] = parsed._ as string[];

  if (pathArgs.length < 2) {
    return envelope_error(`${chalk.red('Usage: cp [-r] <source...> <dest>')}\n`);
  }

  const recursive: boolean = !!parsed['r'] || !!parsed['recursive'];

  // Last arg is destination, all others are sources
  const dest: string = pathArgs[pathArgs.length - 1];
  const sources: string[] = pathArgs.slice(0, -1);

  const destPath: string = await path_resolve(dest);
  const listCache: ListCache = listCache_get();
  let successCount: number = 0;
  let failCount: number = 0;
  let rendered: string = '';
  let renderedErr: string = '';
  const outcomes: CpOutcome[] = [];

  for (const src of sources) {
    try {
      const srcPath: string = await path_resolve(src);

      // For multiple sources, show which file we're copying
      if (sources.length > 1) {
        rendered += `${chalk.gray(`Copying ${srcPath}...`)}\n`;
      } else {
        rendered += `Copying ${srcPath} to ${destPath}...\n`;
      }

      const success: boolean = await chefs_cp_cmd(srcPath, destPath, { recursive });

      if (sources.length === 1) {
        rendered += `${cp_render(srcPath, destPath, success)}\n`;
      }

      outcomes.push({ source: srcPath, copied: success });
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      renderedErr += `${chalk.red(`cp: ${src}: ${msg}`)}\n`;
      outcomes.push({ source: src, copied: false });
      failCount++;
    }
  }

  // Invalidate destination directory (always, since files copied into it)
  listCache.cache_invalidate(destPath);
  const destParent: string = path.posix.dirname(destPath);
  listCache.cache_invalidate(destParent);

  // Summary for multiple files
  if (sources.length > 1) {
    if (failCount === 0) {
      rendered += `${chalk.green(`✓ Copied ${successCount} file(s) to ${destPath}`)}\n`;
    } else {
      rendered += `${chalk.yellow(`⚠ Copied ${successCount} file(s), ${failCount} failed`)}\n`;
    }
  }

  const modelData: CpModelData = { dest: destPath, outcomes, copied: successCount, failed: failCount };
  if (failCount > 0) {
    const envelope: CommandEnvelope = envelope_error(rendered, undefined, renderedErr || undefined);
    envelope.model = { kind: 'fs.cp', data: modelData };
    return envelope;
  }
  return envelope_ok(rendered, { kind: 'fs.cp', data: modelData });
}
