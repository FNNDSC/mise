/**
 * @file Builtin mkdir command.
 * Creates directories, reported as a command envelope.
 */
import chalk from 'chalk';
import { CommandEnvelope, listCache_get, envelope_ok, envelope_error } from '@fnndsc/cumin';
import type { ListCache } from '@fnndsc/cumin';
import { path_resolve } from '../utils.js';
import { files_mkdir as chefs_mkdir_cmd } from '@fnndsc/chili/commands/fs/mkdir.js';
import { mkdir_render } from '@fnndsc/chili/views/fs.js';

/** Outcome of one mkdir target, for the envelope model. */
interface MkdirOutcome {
  path: string;
  created: boolean;
}

/**
 * Creates directories.
 *
 * @param args - Command line arguments (directory paths).
 * @returns An envelope whose rendered text reports each directory and whose
 *   model lists per-target outcomes.
 */
export async function builtin_mkdir(args: string[]): Promise<CommandEnvelope> {
  if (args.length === 0) {
    return envelope_error('', undefined, `${chalk.red('Usage: mkdir <directory> [directory...]')}\n`);
  }

  let rendered: string = '';
  let renderedErr: string = '';
  const outcomes: MkdirOutcome[] = [];

  for (const pathArg of args) {
    try {
      const targetPath: string = await path_resolve(pathArg);
      const success: boolean = await chefs_mkdir_cmd(targetPath);
      rendered += `${mkdir_render(targetPath, success)}\n`;
      outcomes.push({ path: targetPath, created: success });

      // Invalidate cache for parent directory
      if (success) {
        const parentDir: string = targetPath.substring(0, targetPath.lastIndexOf('/')) || '/';
        const listCache: ListCache = listCache_get();
        listCache.cache_invalidate(parentDir);
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      renderedErr += `${chalk.red(`mkdir: ${pathArg}: ${msg}`)}\n`;
      outcomes.push({ path: pathArg, created: false });
    }
  }

  const anyFailed: boolean = outcomes.some((outcome: MkdirOutcome): boolean => !outcome.created);
  const model: { kind: string; data: MkdirOutcome[] } = { kind: 'fs.mkdir', data: outcomes };
  if (anyFailed) {
    const envelope: CommandEnvelope = envelope_error(rendered, undefined, renderedErr || undefined);
    envelope.model = model;
    return envelope;
  }
  return envelope_ok(rendered, model);
}
