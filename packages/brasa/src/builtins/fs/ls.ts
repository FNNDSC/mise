/**
 * @file Builtin ls command.
 * Lists directory contents.
 */
import chalk from 'chalk';
import { ParsedArgs, commandArgs_process, optionsUnknown_refusal, path_resolve } from '../utils.js';
import { listingCache_get, vfsDispatcher_get } from '../../core/filesystem.js';
import { errorStack, type Result, type VFSItem } from '@fnndsc/fond';
import type { ListingCache } from '../../core/backend.js';
import { session } from '../../session/index.js';
import { vfs } from '../../lib/vfs/vfs.js';
import { envelope_error, type ListingItem, type CommandEnvelope } from '@fnndsc/menu';

/** Valid sort fields for ls. */
type LsSortField = 'name' | 'size' | 'date' | 'owner';

/** The sort fields `--sort` takes. */
const LS_SORT_FIELDS: ReadonlyArray<LsSortField> = ['name', 'size', 'date', 'owner'];

/**
 * The options ls reads. `-a` and `-A` are taken and already hold: nothing
 * in the listing is hidden.
 */
const LS_OPTIONS: ReadonlyArray<string> = ['l', 'h', '1', 'r', 'reverse', 'd', 'f', 'refresh', 'sort', 'a', 'A', 'all', 'almost-all'];

/** ls's long options that are switches, so the word after one is a path, never its value. */
const LS_SWITCHES: ReadonlyArray<string> = ['refresh', 'reverse', 'all', 'almost-all'];

/**
 * An ls refusal, said before anything is listed.
 *
 * @param line - The refusal.
 * @returns The error envelope.
 */
function ls_refusal(line: string): CommandEnvelope {
  return envelope_error('', undefined, `${chalk.red(line)}\n`);
}

/**
 * Lists the contents of the current or specified directory/files in the ChRIS filesystem context.
 * Supports a virtual `/bin` directory for plugins and multiple paths (e.g., from wildcard expansion).
 *
 * @param args - An array containing target paths (optional).
 * @returns A Promise that resolves when the directory contents are listed.
 */
export async function builtin_ls(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args, { booleanLongOptions: LS_SWITCHES });
  const unknown: string | null = optionsUnknown_refusal('ls', parsed, LS_OPTIONS);
  if (unknown !== null) return ls_refusal(unknown);

  let sortBy: LsSortField = 'name';
  if (parsed['sort'] !== undefined) {
    const sortValue: string = String(parsed['sort']);
    if (!LS_SORT_FIELDS.includes(sortValue as LsSortField)) {
      return ls_refusal(`ls: invalid argument '${sortValue}' for '--sort' (valid: ${LS_SORT_FIELDS.join(', ')})`);
    }
    sortBy = sortValue as LsSortField;
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

/**
 * Whether a path is a folder, as its parent lists it (a mount point counts).
 *
 * @param target - The absolute path.
 * @returns True for a folder; false for a file or for nothing there.
 */
async function folder_is(target: string): Promise<boolean> {
  const clean: string = target.length > 1 && target.endsWith('/') ? target.slice(0, -1) : target;
  if (clean === '/') return true;
  const slash: number = clean.lastIndexOf('/');
  const mark: number = errorStack.checkpoint_mark();
  const siblings: Result<VFSItem[]> = await vfsDispatcher_get().list(clean.slice(0, slash) || '/');
  errorStack.checkpoint_drain(mark);
  return siblings.ok && siblings.value.some((item: VFSItem): boolean => item.name === clean.slice(slash + 1) && (item.type === 'dir' || item.type === 'vfs'));
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
  /** False when the listing was served stale; a refresh follows on the ambient bus. */
  fresh?: boolean;
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
    const listCache: ListingCache = listingCache_get();
    if (pathArgs.length === 0) {
      const cwd: string = await session.getCWD();
      rendered += `${chalk.gray(`[Cache] Invalidating: ${cwd}`)}\n`;
      // The named listing only. A refresh used to clear EVERY listing too,
      // so one REFRESH press made the next navigation anywhere fetch again
      // — /bin included, seconds — for a staleness nobody had claimed.
      listCache.cache_invalidate?.(cwd);
    } else {
      for (const pathArg of pathArgs) {
        const resolvedPath: string = await path_resolve(pathArg);
        rendered += `${chalk.gray(`[Cache] Invalidating: ${resolvedPath}`)}\n`;
        listCache.cache_invalidate?.(resolvedPath);
      }
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

  // Several operands read as a shell gives them: files first, together, then
  // each folder under its own `name:` header, a blank line between blocks.
  const order: number[] = targets.map((_target: string | undefined, index: number): number => index);
  const folders: Set<number> = new Set<number>();
  if (targets.length > 1 && !options.directory) {
    for (const index of order) {
      if (await folder_is(targets[index] as string)) folders.add(index);
    }
    order.sort((a: number, b: number): number => Number(folders.has(a)) - Number(folders.has(b)));
  }

  let anyFailed: boolean = false;
  let blocks: number = 0;
  const listings: LsListing[] = [];
  for (const index of order) {
    const target: string | undefined = targets[index];
    const envelope: CommandEnvelope = await vfs.list(target, options);
    if (folders.has(index) && envelope.status !== 'error') {
      rendered += `${blocks > 0 ? '\n' : ''}${pathArgs[index]}:\n`;
      blocks++;
    } else if (envelope.status !== 'error' && blocks === 0 && targets.length > 1) {
      blocks++;
    }
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
    const listing = await vfs.listing_get(target, options);
    if (listing.ok) {
      listings.push({ path: listing.value.path, items: listing.value.items, fresh: listing.value.fresh });
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
