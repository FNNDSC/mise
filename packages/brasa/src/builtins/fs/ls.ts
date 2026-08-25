/**
 * @file Builtin ls command.
 * Lists directory contents.
 */
import chalk from 'chalk';
import { ParsedArgs, commandArgs_process, path_resolve } from '../utils.js';
import { listCache_get, type CommandEnvelope } from '@fnndsc/cumin';
import { session } from '../../session/index.js';
import { vfs } from '../../lib/vfs/vfs.js';
import type { ListingItem } from '@fnndsc/chili/models/listing.js';

/** Valid sort fields for ls. */
type LsSortField = 'name' | 'size' | 'date' | 'owner';

/**
 * Lists the contents of the current or specified directory/files in the ChRIS filesystem context.
 * Supports a virtual `/bin` directory for plugins and multiple paths (e.g., from wildcard expansion).
 *
 * @param args - An array containing target paths (optional).
 * @returns A Promise that resolves when the directory contents are listed.
 */
export async function builtin_ls(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);

  let sortBy: LsSortField = 'name';
  if (parsed['sort']) {
    const sortValue: string = String(parsed['sort']);
    if (['name', 'size', 'date', 'owner'].includes(sortValue)) {
      sortBy = sortValue as LsSortField;
    }
  }

  return ls_run({
    paths: parsed._ as string[],
    long: !!parsed['l'],
    human: !!parsed['h'],
    oneColumn: !!parsed['1'],
    sort: sortBy,
    reverse: !!parsed['reverse'] || !!parsed['r'],
    directory: !!parsed['d'],
    refresh: !!parsed['refresh'] || !!parsed['f'],
  });
}

/** Typed invocation options for ls. */
export interface LsOptions {
  /** Paths to list; empty or omitted lists the session cwd. */
  paths?: string[];
  /** Long (detailed) listing. */
  long?: boolean;
  /** Human-readable sizes in the long listing. */
  human?: boolean;
  /** One entry per line. */
  oneColumn?: boolean;
  /** Sort field. */
  sort?: LsSortField;
  /** Reverse the sort order. */
  reverse?: boolean;
  /** List the entry itself rather than its contents. */
  directory?: boolean;
  /** Invalidate cached listings before reading. */
  refresh?: boolean;
}

/**
 * One listed target and its resolved entries, for the envelope model.
 *
 * @property path - The listed directory (resolved; the cwd when none given).
 * @property items - The listing entries in display order.
 */
export interface LsListing {
  path: string;
  items: ListingItem[];
}

/**
 * Lists directories: the shared typed core behind the parsed builtin and
 * the typed API.
 *
 * @param runOptions - Target paths, sorting, and presentation flags.
 * @returns An envelope whose rendered text carries the listing and whose
 *   `fs.listing` model carries the entries per target.
 */
export async function ls_run(runOptions: LsOptions): Promise<CommandEnvelope> {
  const pathArgs: string[] = runOptions.paths ?? [];
  const shouldRefresh: boolean = runOptions.refresh ?? false;

  const options: {
    long: boolean;
    human: boolean;
    oneColumn: boolean;
    sort: LsSortField;
    reverse: boolean;
    directory: boolean;
  } = {
    long: runOptions.long ?? false,
    human: runOptions.human ?? false,
    oneColumn: runOptions.oneColumn ?? false,
    sort: runOptions.sort ?? 'name',
    reverse: runOptions.reverse ?? false,
    directory: runOptions.directory ?? false,
  };

  let rendered: string = '';
  let renderedErr: string = '';

  if (shouldRefresh) {
    const listCache = listCache_get();
    if (pathArgs.length === 0) {
      const cwd: string = await session.getCWD();
      rendered += `${chalk.gray(`[Cache] Invalidating: ${cwd}`)}\n`;
      listCache.cache_invalidate(cwd);
      listCache.cache_invalidate();
    } else {
      for (const pathArg of pathArgs) {
        const resolvedPath: string = await path_resolve(pathArg);
        rendered += `${chalk.gray(`[Cache] Invalidating: ${resolvedPath}`)}\n`;
        listCache.cache_invalidate(resolvedPath);
      }
      listCache.cache_invalidate();
    }
  }

  // One or more listings, in argument order; each returns its own envelope.
  const targets: Array<string | undefined> = [];
  if (pathArgs.length === 0) {
    targets.push(undefined);
  } else {
    for (const pathArg of pathArgs) {
      targets.push(await path_resolve(pathArg));
    }
  }

  let anyFailed: boolean = false;
  const listings: LsListing[] = [];
  for (const target of targets) {
    const envelope: CommandEnvelope = await vfs.list(target, options);
    rendered += envelope.rendered;
    if (envelope.renderedErr !== undefined) {
      renderedErr += envelope.renderedErr;
    }
    if (envelope.status === 'error') {
      anyFailed = true;
      continue;
    }
    // Collect the entries for the model; vfs.list just populated the
    // listing cache, so this second read is served from it.
    const items = await vfs.data_get(target, options);
    if (items.ok) {
      listings.push({ path: target ?? await session.getCWD(), items: items.value });
    }
  }

  // A failed listing is a failed command: aggregating error envelopes into an
  // ok status would let `ls missing-dir` exit 0.
  if (anyFailed) {
    process.exitCode = 1;
  }
  const result: CommandEnvelope = { status: anyFailed ? 'error' : 'ok', rendered };
  result.model = { kind: 'fs.listing', data: listings };
  if (renderedErr.length > 0) {
    result.renderedErr = renderedErr;
  }
  return result;
}
