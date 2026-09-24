/**
 * @file Builtin mkdir command.
 * Creates directories, reported as a command envelope.
 */
import chalk from 'chalk';
import { CommandEnvelope, listCache_get, envelope_ok, envelope_error } from '@fnndsc/cumin';
import type { ListCache } from '@fnndsc/cumin';
import { path_resolve } from '../utils.js';
import { folder_checkExists } from './folderExists.js';
import { files_mkdir as chefs_mkdir_cmd } from '@fnndsc/chili/commands/fs/mkdir.js';
import { mkdir_render } from '@fnndsc/chili/views/fs.js';

/** Outcome of one mkdir target, for the envelope model. */
export interface MkdirOutcome {
  path: string;
  created: boolean;
  /** Already a folder, and `-p` says that is fine. */
  existed?: boolean;
}

/** Typed invocation options for mkdir. */
export interface MkdirOptions {
  /** Directory paths to create, absolute or relative to the session cwd. */
  paths: string[];
  /**
   * Make missing parents too, and take a folder already there as done
   * (`-p`). Without it, as POSIX has it, a missing parent or an existing
   * target is an error.
   */
  parents?: boolean;
}

/** Parsed `mkdir` arguments, or the option it refuses. */
export type MkdirArgs = MkdirOptions | { refused: string };

/**
 * Parses `mkdir` arguments: `-p` / `--parents`, and `--` to end options.
 * Any other option is refused by name rather than taken for a path — a
 * `-p` the session did not know once became a folder named `-p`.
 *
 * @param args - Raw command arguments.
 * @returns The options, or the refusal line for the first unknown option.
 */
export function mkdirArgs_parse(args: string[]): MkdirArgs {
  let parents: boolean = false;
  const paths: string[] = [];
  let endOfOptions: boolean = false;
  for (const arg of args) {
    if (endOfOptions || arg === '-' || !arg.startsWith('-')) {
      paths.push(arg);
      continue;
    }
    if (arg === '--') {
      endOfOptions = true;
      continue;
    }
    if (arg === '--parents') {
      parents = true;
      continue;
    }
    if (arg.startsWith('--')) return { refused: `mkdir: unrecognized option '${arg}'` };
    for (const flag of arg.substring(1)) {
      if (flag !== 'p') return { refused: `mkdir: invalid option -- '${flag}'` };
      parents = true;
    }
  }
  return { paths, parents };
}

/**
 * Creates directories: the shared typed core behind the parsed builtin and
 * the typed API.
 *
 * @param options - The directories to create, and whether parents come too.
 * @returns An envelope whose rendered text reports each directory and whose
 *   model lists per-target outcomes.
 */
export async function mkdir_run(options: MkdirOptions): Promise<CommandEnvelope> {
  const args: string[] = options.paths;
  const parents: boolean = options.parents === true;
  if (args.length === 0) {
    return envelope_error('', undefined, `${chalk.red('Usage: mkdir [-p] <directory> [directory...]')}\n`);
  }

  let rendered: string = '';
  let renderedErr: string = '';
  const outcomes: MkdirOutcome[] = [];

  for (const pathArg of args) {
    try {
      const targetPath: string = await path_resolve(pathArg);
      const parentDir: string = targetPath.substring(0, targetPath.lastIndexOf('/')) || '/';
      if (await folder_checkExists(targetPath)) {
        if (parents) {
          outcomes.push({ path: targetPath, created: false, existed: true });
        } else {
          renderedErr += `${chalk.red(`mkdir: cannot create directory '${pathArg}': File exists`)}\n`;
          outcomes.push({ path: targetPath, created: false });
        }
        continue;
      }
      if (!parents && !(await folder_checkExists(parentDir))) {
        renderedErr += `${chalk.red(`mkdir: cannot create directory '${pathArg}': No such file or directory`)}\n`;
        outcomes.push({ path: targetPath, created: false });
        continue;
      }
      const success: boolean = await chefs_mkdir_cmd(targetPath);
      rendered += `${mkdir_render(targetPath, success)}\n`;
      outcomes.push({ path: targetPath, created: success });

      // Invalidate cache for parent directory
      if (success) {
        const listCache: ListCache = listCache_get();
        listCache.cache_invalidate(parentDir);
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      renderedErr += `${chalk.red(`mkdir: ${pathArg}: ${msg}`)}\n`;
      outcomes.push({ path: pathArg, created: false });
    }
  }

  const anyFailed: boolean = outcomes.some((outcome: MkdirOutcome): boolean => !outcome.created && outcome.existed !== true);
  const model: { kind: string; data: MkdirOutcome[] } = { kind: 'fs.mkdir', data: outcomes };
  if (anyFailed) {
    const envelope: CommandEnvelope = envelope_error(rendered, undefined, renderedErr || undefined);
    envelope.model = model;
    return envelope;
  }
  return envelope_ok(rendered, model);
}

/**
 * Creates directories from parsed command-line arguments.
 *
 * @param args - Command line arguments (`-p` and directory paths).
 * @returns The envelope from {@link mkdir_run}, or the refusal of an
 *   option mkdir does not have.
 */
export async function builtin_mkdir(args: string[]): Promise<CommandEnvelope> {
  const parsed: MkdirArgs = mkdirArgs_parse(args);
  if ('refused' in parsed) return envelope_error('', undefined, `${chalk.red(parsed.refused)}\n`);
  return mkdir_run(parsed);
}
