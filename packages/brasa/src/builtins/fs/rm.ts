/**
 * @file Builtin rm command.
 * Removes files or directories, reported as a command envelope.
 */
import chalk from 'chalk';
import path from 'path';
import { path_resolve } from '../utils.js';
import { repl_confirm } from '../../core/question.js';
import { listingCache_get, vfsDispatcher_get } from '../../core/filesystem.js';
import type { ListingCache } from '../../core/backend.js';
import { entry_at, entry_isFolder, folderTree_remove } from './entries.js';
import { errno_words, rm_render, vfs_fail, vfs_ok, type VFSDispatcher, type VFSItem, type VfsOutcome } from '@fnndsc/fond';
import { sink_get } from '../../core/sink.js';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

/**
 * Prompts the user for confirmation.
 *
 * @param message - The prompt message.
 * @returns A Promise resolving to true if user confirms (y/Y), false otherwise.
 */
async function prompt_confirm(message: string): Promise<boolean> {
  // Asked through the SURFACE, never through this process's stdin. Under a
  // daemon that stdin belongs to whoever started the daemon — not to the
  // operator running `rm -i` from a browser three rooms away, who would
  // have waited forever for a question asked of somebody else's terminal.
  return repl_confirm(message);
}

/**
 * Why a question came back with no answer.
 *
 * A question can end without a yes or a no: the operator abandoned it, or
 * the surface that was asked lost the ability to answer. Neither is a
 * removal failing — nothing was attempted — so `rm` keeps the file, says
 * which one it kept and why, and reports an ordinary outcome.
 *
 * @param error - Whatever the ask rejected with.
 * @returns A phrase that finishes 'skipped x: ...'.
 */
function unanswered_reason(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : 'the question could not be answered';
}

/**
 * Parsed `rm` arguments: flags plus the resolved list of path operands.
 */
export interface RmArgs {
  recursive: boolean;
  force: boolean;
  interactive: boolean;
  /**
   * Ask ONCE for the whole list rather than once per target (`-I`), which
   * is what a set deserves: twenty questions to remove twenty files is a
   * confirmation an operator learns to dismiss without reading.
   */
  once: boolean;
  paths: string[];
  /** The refusal line for an option rm does not have, when one was given. */
  refused?: string;
}

/** The long options rm knows, and the short flag each one is. */
const RM_LONG_OPTIONS: Readonly<Record<string, string>> = {
  '--recursive': 'r',
  '--force': 'f',
  '--interactive': 'i',
};

/**
 * Parses `rm` arguments, supporting combined short flags (`-rf`, `-rfi`),
 * the long forms (`--recursive`, `--force`, `--interactive`) and the `--`
 * end-of-options separator. An option rm does not have is refused by name
 * — never skipped, and never read letter by letter (`--force` once turned
 * recursion on through its `r`).
 *
 * @param args - Raw command arguments.
 * @returns The parsed flags and path operands, with `refused` set for the
 *   first unknown option.
 */
export function rmArgs_parse(args: string[]): RmArgs {
  let recursive: boolean = false;
  let force: boolean = false;
  let interactive: boolean = false;
  let once: boolean = false;
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
      let flags: string = arg.substring(1);
      if (arg.startsWith('--')) {
        const short: string | undefined = RM_LONG_OPTIONS[arg];
        if (short === undefined) {
          return { recursive, force, interactive, once, paths, refused: `rm: unrecognized option '${arg}'` };
        }
        flags = short;
      }
      for (const ch of flags) {
        if (ch === 'r' || ch === 'R') recursive = true;
        else if (ch === 'f') force = true;
        else if (ch === 'i') interactive = true;
        else if (ch === 'I') once = true;
        else return { recursive, force, interactive, once, paths, refused: `rm: invalid option -- '${ch}'` };
      }
    } else {
      paths.push(arg);
    }
  }

  return { recursive, force, interactive, once, paths };
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
export interface RmOutcome {
  path: string;
  removed: boolean;
  skipped: boolean;
}

/** What one removal did: the kind of thing removed (null when nothing was there), and its outcome. */
interface EntryRemoval {
  type: 'file' | 'dir' | 'link' | null;
  outcome: VfsOutcome;
}

/**
 * Removes one path. A projection's path is its mount's to remove or refuse
 * (a tag names its own verbs). Elsewhere what holds the path decides: a file
 * or link is removed, a folder only with `-r` (with all it holds), and
 * nothing there is fine under `-f`.
 *
 * @param dispatcher - The session's filesystem.
 * @param target - The absolute path.
 * @param recursive - `-r`.
 * @param force - `-f`.
 * @returns What was removed, and the outcome.
 */
async function entry_remove(dispatcher: VFSDispatcher, target: string, recursive: boolean, force: boolean): Promise<EntryRemoval> {
  if (dispatcher.path_isVirtual(target)) {
    return { type: null, outcome: recursive ? await dispatcher.rmTree(target) : await dispatcher.rm(target) };
  }
  const entry: VFSItem | null = await entry_at(dispatcher, target);
  if (entry === null) return { type: null, outcome: force ? vfs_ok(true) : vfs_fail('ENOENT') };
  if (entry_isFolder(entry)) {
    return { type: 'dir', outcome: recursive ? await folderTree_remove(dispatcher, target) : vfs_fail('EISDIR') };
  }
  return { type: entry.type === 'link' ? 'link' : 'file', outcome: await dispatcher.rm(target) };
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
  const parsed: RmArgs = rmArgs_parse(args);
  if (parsed.refused !== undefined) return envelope_error('', undefined, `${chalk.red(parsed.refused)}\n`);
  return rm_run(parsed);
}

/**
 * Removes files or directories: the shared typed core behind the parsed
 * builtin and the typed API.
 *
 * @param runArgs - Flags and target paths.
 * @returns An envelope whose model lists per-target outcomes.
 */
export async function rm_run(runArgs: RmArgs): Promise<CommandEnvelope> {
  const { recursive, force, interactive, once, paths }: RmArgs = runArgs;

  if (paths.length === 0) {
    return envelope_error('', undefined, `${chalk.red('Usage: rm [-rfiI] <path> [path...]')}\n`);
  }

  // One question for the whole list, asked before anything is removed and
  // naming what will go. A refusal removes nothing at all — there is no
  // half of a set.
  if (once) {
    const many: string = paths.length === 1
      ? `'${paths[0]}'`
      : `${paths.length} items`;
    let agreed: boolean = false;
    let unanswered: string | null = null;
    try {
      agreed = await prompt_confirm(`rm: remove ${many}? (y/n): `);
    } catch (e: unknown) {
      // A question with no answer keeps everything, the same as a no. It
      // says why, so a surface that has quietly lost its voice is not read
      // as an operator who declined.
      unanswered = unanswered_reason(e);
    }
    if (!agreed) {
      const why: string = unanswered === null ? '' : `: ${unanswered}`;
      return envelope_ok(`${chalk.gray(`nothing removed (${paths.length} kept)${why}`)}\n`, {
        kind: 'fs.rm',
        data: paths.map((path: string): RmOutcome => ({ path, removed: false, skipped: true })),
      });
    }
  }

  const dispatcher: VFSDispatcher = vfsDispatcher_get();
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
    if (interactive || once) {
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
    if (interactive || once) {
      sink_get().err_write(`${line}\n`);
    } else {
      renderedErr += `${line}\n`;
    }
  };

  // Where the operator walked away, when they did: everything after it was
  // never put to them, and a set of files silently left alone is worse than
  // a set left alone out loud.
  let abandonedAt: number | null = null;

  for (let index: number = 0; index < paths.length; index++) {
    const pathArg: string = paths[index] as string;
    try {
      const target: string = await path_resolve(pathArg);

      if (interactive) {
        let confirmed: boolean = false;
        try {
          confirmed = await prompt_confirm(`rm: remove '${pathArg}'? (y/n): `);
        } catch (e: unknown) {
          // Abandoning is an answer, and it answers for the rest of the
          // walk: an operator who backed out of this question is not
          // waiting to be asked the next nineteen.
          out_emit(chalk.gray(`skipped '${pathArg}': ${unanswered_reason(e)}`));
          outcomes.push({ path: pathArg, removed: false, skipped: true });
          abandonedAt = index;
          break;
        }
        if (!confirmed) {
          out_emit(chalk.gray(`skipped '${pathArg}'`));
          outcomes.push({ path: pathArg, removed: false, skipped: true });
          continue;
        }
      }

      const removed: EntryRemoval = await entry_remove(dispatcher, target, recursive, force);

      if (removed.outcome.ok && removed.type === null && !dispatcher.path_isVirtual(target)) {
        // `-f` on something not there: nothing removed, nothing to say.
        outcomes.push({ path: pathArg, removed: false, skipped: false });
        continue;
      }
      if (removed.outcome.ok) {
        if (paths.length > 1) {
          out_emit(chalk.gray(`removed '${pathArg}'`));
        } else {
          out_emit(rm_render({ success: true, path: target, type: removed.type }));
        }
        outcomes.push({ path: pathArg, removed: true, skipped: false });
        successCount++;

        const listCache: ListingCache = listingCache_get();
        listCache.cache_invalidate?.(path.posix.dirname(target));
        // Also drop the removed target and any listings cached beneath it:
        // a later re-upload to the same path must not inherit still-fresh
        // nested listings from the deleted tree.
        listCache.cache_invalidateTree?.(target);
      } else {
        const reason: string = removed.outcome.reason ?? errno_words(removed.outcome.errno);
        err_emit(chalk.red(`rm: cannot remove '${pathArg}': ${reason}`));
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

  if (abandonedAt !== null) {
    const notAsked: string[] = paths.slice(abandonedAt + 1);
    if (notAsked.length > 0) {
      out_emit(chalk.gray(`${notAsked.length} more not asked about, and kept`));
      for (const kept of notAsked) {
        outcomes.push({ path: kept, removed: false, skipped: true });
      }
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
