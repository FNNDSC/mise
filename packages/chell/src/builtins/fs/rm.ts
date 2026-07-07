/**
 * @file Builtin rm command.
 * Removes files or directories, reported as a command envelope.
 */
import chalk from 'chalk';
import path from 'path';
import * as readline from 'readline';
import { CommandEnvelope, listCache_get, envelope_ok, envelope_error } from '@fnndsc/cumin';
import type { ListCache } from '@fnndsc/cumin';
import { path_resolve } from '../utils.js';
import { files_rm as chefs_rm_cmd, RmResult, RmOptions } from '@fnndsc/chili/commands/fs/rm.js';
import { rm_render } from '@fnndsc/chili/views/fs.js';
import { sink_get } from '../../core/sink.js';

/**
 * Prompts the user for confirmation.
 *
 * @param message - The prompt message.
 * @returns A Promise resolving to true if user confirms (y/Y), false otherwise.
 */
async function prompt_confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl: readline.Interface = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(message, (answer: string) => {
      rl.close();
      const confirmed: boolean = answer.trim().toLowerCase() === 'y';
      resolve(confirmed);
    });
  });
}

/**
 * Parsed `rm` arguments: flags plus the resolved list of path operands.
 */
export interface RmArgs {
  recursive: boolean;
  force: boolean;
  interactive: boolean;
  paths: string[];
}

/**
 * Parses `rm` arguments, supporting combined short flags (`-rf`, `-rfi`) and the
 * `--` end-of-options separator.
 *
 * @param args - Raw command arguments.
 * @returns The parsed flags and path operands.
 */
export function rmArgs_parse(args: string[]): RmArgs {
  let recursive: boolean = false;
  let force: boolean = false;
  let interactive: boolean = false;
  const paths: string[] = [];
  let endOfOptions: boolean = false;

  for (const arg of args) {
    if (arg === '--') {
      endOfOptions = true;
      continue;
    }
    if (endOfOptions) {
      paths.push(arg);
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      for (const ch of arg.substring(1)) {
        if (ch === 'r' || ch === 'R') recursive = true;
        else if (ch === 'f') force = true;
        else if (ch === 'i') interactive = true;
      }
    } else if (!arg.startsWith('-')) {
      paths.push(arg);
    }
  }

  return { recursive, force, interactive, paths };
}

/**
 * Formats the multi-target removal summary line.
 *
 * @param successCount - Number of items removed successfully.
 * @param failCount - Number of items that failed to remove.
 * @returns The summary string, or null if there is nothing to summarise.
 */
export function rmSummary_format(successCount: number, failCount: number): string | null {
  if (!(successCount > 0 || failCount > 0)) return null;
  if (successCount > 0 && failCount === 0) {
    return chalk.green(`Successfully removed ${successCount} item${successCount !== 1 ? 's' : ''}`);
  }
  if (successCount > 0 && failCount > 0) {
    return chalk.yellow(`Removed ${successCount} item${successCount !== 1 ? 's' : ''}, failed ${failCount}`);
  }
  return chalk.red(`Failed to remove ${failCount} item${failCount !== 1 ? 's' : ''}`);
}

/** Outcome of one removal target, for the envelope model. */
interface RmOutcome {
  path: string;
  removed: boolean;
  skipped: boolean;
}

/**
 * Removes one or more files or directories.
 *
 * In interactive mode (-i) output is streamed live through the sink so each
 * confirmation prompt appears in sequence with its result; the envelope then
 * carries only the model. Otherwise output is buffered into the envelope.
 *
 * @param args - Command line arguments (flags and paths).
 * @returns An envelope whose model lists per-target outcomes.
 */
export async function builtin_rm(args: string[]): Promise<CommandEnvelope> {
  const { recursive, force, interactive, paths }: RmArgs = rmArgs_parse(args);

  if (paths.length === 0) {
    return envelope_error('', undefined, `${chalk.red('Usage: rm [-rf] <path> [path...]')}\n`);
  }

  const options: RmOptions = { recursive, force };
  let successCount: number = 0;
  let failCount: number = 0;
  let rendered: string = '';
  let renderedErr: string = '';
  const outcomes: RmOutcome[] = [];

  /**
   * Emits one line of stdout output: streamed live in interactive mode,
   * buffered into the envelope otherwise.
   *
   * @param line - The line to emit (without trailing newline).
   */
  const out_emit = (line: string): void => {
    if (interactive) {
      sink_get().data_write(`${line}\n`);
    } else {
      rendered += `${line}\n`;
    }
  };

  /**
   * Emits one line of error output: streamed live in interactive mode,
   * buffered into the envelope otherwise.
   *
   * @param line - The line to emit (without trailing newline).
   */
  const err_emit = (line: string): void => {
    if (interactive) {
      sink_get().err_write(`${line}\n`);
    } else {
      renderedErr += `${line}\n`;
    }
  };

  for (const pathArg of paths) {
    try {
      const target: string = await path_resolve(pathArg);

      if (target.startsWith('/bin/')) {
        err_emit(chalk.red(`rm: cannot remove '${pathArg}': virtual /bin directory`));
        outcomes.push({ path: pathArg, removed: false, skipped: false });
        failCount++;
        continue;
      }

      if (interactive) {
        const confirmed: boolean = await prompt_confirm(`rm: remove '${pathArg}'? (y/n): `);
        if (!confirmed) {
          out_emit(chalk.gray(`skipped '${pathArg}'`));
          outcomes.push({ path: pathArg, removed: false, skipped: true });
          continue;
        }
      }

      const result: RmResult = await chefs_rm_cmd(target, options);

      if (result.success) {
        if (paths.length > 1) {
          out_emit(chalk.gray(`removed '${pathArg}'`));
        } else {
          out_emit(rm_render(result));
        }
        outcomes.push({ path: pathArg, removed: true, skipped: false });
        successCount++;

        const listCache: ListCache = listCache_get();
        const parentDir: string = path.posix.dirname(target);
        listCache.cache_invalidate(parentDir);
      } else {
        err_emit(chalk.red(`rm: cannot remove '${pathArg}': ${result.error || 'unknown error'}`));
        outcomes.push({ path: pathArg, removed: false, skipped: false });
        failCount++;
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      err_emit(chalk.red(`rm: cannot remove '${pathArg}': ${msg}`));
      outcomes.push({ path: pathArg, removed: false, skipped: false });
      failCount++;
    }
  }

  if (paths.length > 1) {
    const summary: string | null = rmSummary_format(successCount, failCount);
    if (summary) {
      out_emit('');
      out_emit(summary);
    }
  }

  const model: { kind: string; data: RmOutcome[] } = { kind: 'fs.rm', data: outcomes };
  if (failCount > 0) {
    const envelope: CommandEnvelope = envelope_error(rendered, undefined, renderedErr || undefined);
    envelope.model = model;
    return envelope;
  }
  const envelope: CommandEnvelope = envelope_ok(rendered, model);
  return envelope;
}
