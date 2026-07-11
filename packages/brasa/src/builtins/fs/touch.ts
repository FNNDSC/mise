/**
 * @file Builtin touch command.
 * Creates files, reported as a command envelope.
 */
import chalk from 'chalk';
import path from 'path';
import { CommandEnvelope, listCache_get, errorStack, envelope_ok, envelope_error } from '@fnndsc/cumin';
import type { ListCache, StackMessage } from '@fnndsc/cumin';
import { ParsedArgs, commandArgs_process, path_resolve, error_stripDebugPrefix } from '../utils.js';
import { files_touch as chefs_touch_cmd, TouchOptions } from '@fnndsc/chili/commands/fs/touch.js';
import { touch_render } from '@fnndsc/chili/views/fs.js';

/** Outcome of one touch target, for the envelope model. */
interface TouchOutcome {
  path: string;
  created: boolean;
}

/**
 * Creates empty files or updates timestamps.
 *
 * @param args - Command line arguments (file paths).
 * @returns An envelope whose rendered text reports each created file and
 *   whose model lists per-target outcomes.
 */
export async function builtin_touch(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const pathArgs: string[] = parsed._ as string[];

  if (pathArgs.length === 0) {
    return envelope_error(
      '',
      undefined,
      `${chalk.red('Usage: touch [--withContents <string>] [--withContentsFromFile <file>] <file>')}\n`,
    );
  }

  // Build options from parsed flags
  const options: TouchOptions = {};
  if (parsed['withContents']) {
    options.withContents = String(parsed['withContents']);
  }
  if (parsed['withContentsFromFile']) {
    options.withContentsFromFile = String(parsed['withContentsFromFile']);
  }

  // Only process the first file argument when using content options
  const filesToTouch: string[] = (options.withContents || options.withContentsFromFile)
    ? [pathArgs[0]]  // Only one file when injecting content
    : pathArgs;      // Multiple files allowed for empty touch

  let rendered: string = '';
  let renderedErr: string = '';
  const outcomes: TouchOutcome[] = [];

  for (const pathArg of filesToTouch) {
    try {
      const targetPath: string = await path_resolve(pathArg);
      const success: boolean = await chefs_touch_cmd(targetPath, options);

      if (success) {
        rendered += `${touch_render(targetPath, success)}\n`;
        outcomes.push({ path: targetPath, created: true });

        // Invalidate cache for parent directory
        const listCache: ListCache = listCache_get();
        const parentDir: string = path.posix.dirname(targetPath);
        listCache.cache_invalidate(parentDir);
      } else {
        // Touch failed, report the error from errorStack
        const lastError: StackMessage | undefined = errorStack.stack_pop();
        renderedErr += `${chalk.red(`Failed to create file: ${targetPath}`)}\n`;
        if (lastError) {
          renderedErr += `${chalk.gray(`  ${error_stripDebugPrefix(lastError.message)}`)}\n`;
        }
        outcomes.push({ path: targetPath, created: false });
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      renderedErr += `${chalk.red(`touch: ${pathArg}: ${msg}`)}\n`;
      outcomes.push({ path: pathArg, created: false });
    }
  }

  const anyFailed: boolean = outcomes.some((outcome: TouchOutcome): boolean => !outcome.created);
  const model: { kind: string; data: TouchOutcome[] } = { kind: 'fs.touch', data: outcomes };
  if (anyFailed) {
    const envelope: CommandEnvelope = envelope_error(rendered, undefined, renderedErr || undefined);
    envelope.model = model;
    return envelope;
  }
  return envelope_ok(rendered, model);
}
