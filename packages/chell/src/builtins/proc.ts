/**
 * @file Builtin proc command.
 * Manages the /proc VFS cache (job monitoring).
 */
import chalk from 'chalk';
import { procCache_refresh, procFeed_ensureLoaded, jobs_find } from '@fnndsc/salsa';
import { procCache_get, type ProcFeed, type ProcWarmupProgress } from '@fnndsc/cumin';
import { spinner } from '../lib/spinner.js';
import { commandArgs_process, type ParsedArgs } from './utils.js';
import { list_applySort } from '@fnndsc/chili/utils/sort.js';
import { screen } from '@fnndsc/chili/screen/screen.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Flat record representing one feed entry for resource-group-style listing.
 * All ProcFeed counter fields exposed as first-class columns.
 */
interface ProcJobEntry {
  id: number;
  title: string;
  status: string;
  finishedJobs: number;
  erroredJobs: number;
  startedJobs: number;
  scheduledJobs: number;
  cancelledJobs: number;
  createdJobs: number;
  creationDate: string;
  instances: number | string;
  [key: string]: unknown;
}

const ALL_JOB_FIELDS: ReadonlyArray<string> = [
  'id', 'title', 'status',
  'finishedJobs', 'erroredJobs', 'startedJobs',
  'scheduledJobs', 'cancelledJobs', 'createdJobs',
  'creationDate', 'instances',
];
const DEFAULT_JOB_FIELDS: ReadonlyArray<string> = [
  'id', 'title', 'status', 'finishedJobs', 'erroredJobs',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function feedStatus_derive(feed: ProcFeed): string {
  if (feed.erroredJobs > 0) return 'finishedWithError';
  if (feed.startedJobs + feed.scheduledJobs + feed.createdJobs > 0) return 'running';
  if (feed.cancelledJobs > 0 && feed.finishedJobs === 0) return 'cancelled';
  if (feed.finishedJobs > 0) return 'finishedSuccessfully';
  return 'empty';
}

function statusColor(status: string): string {
  if (status === 'finishedSuccessfully') return chalk.green(status);
  if (status === 'finishedWithError')    return chalk.red(status);
  if (status === 'running')              return chalk.yellow(status);
  if (status === 'cancelled')            return chalk.dim(status);
  return chalk.gray(status);
}

// ── proc jobs ─────────────────────────────────────────────────────────────────

async function jobs_subcmd(args: string[]): Promise<void> {
  const second: string | undefined = args[0];

  if (second === 'inspect') {
    console.log(chalk.bold('Fields available for proc jobs list --fields:'));
    ALL_JOB_FIELDS.forEach((f: string) => console.log(`  ${f}`));
    return;
  }

  // `proc jobs` or `proc jobs list [options]`
  const listArgs: string[] = second === 'list' ? args.slice(1) : args;
  const parsed: ParsedArgs = commandArgs_process(listArgs);

  const cache = procCache_get();

  // Build entries from cache
  let entries: ProcJobEntry[] = cache.feedIDs_get().map((feedID: number): ProcJobEntry => {
    const feed: ProcFeed = cache.feed_get(feedID)!;
    const topoLoaded: boolean = cache.topologyLoaded_has(feedID);
    return {
      id:            feed.id,
      title:         feed.title,
      status:        feedStatus_derive(feed),
      finishedJobs:  feed.finishedJobs,
      erroredJobs:   feed.erroredJobs,
      startedJobs:   feed.startedJobs,
      scheduledJobs: feed.scheduledJobs,
      cancelledJobs: feed.cancelledJobs,
      createdJobs:   feed.createdJobs,
      creationDate:  feed.creationDate ? feed.creationDate.substring(0, 10) : '',
      instances:     topoLoaded ? cache.instancesForFeed_count(feedID) : '-',
    };
  });

  // --search title substring filter
  const search: string = String(parsed['search'] ?? '');
  if (search) {
    const lower: string = search.toLowerCase();
    entries = entries.filter((e: ProcJobEntry) => e.title.toLowerCase().includes(lower));
  }

  if (entries.length === 0) {
    console.log(chalk.gray('No feeds in cache.'));
    return;
  }

  // --sort / --reverse
  const sortField: string = String(parsed['sort'] ?? '');
  const reverse: boolean  = !!parsed['reverse'];
  if (sortField) entries = list_applySort(entries, sortField, reverse);

  // --limit / --all (default 20)
  const showAll: boolean   = !!parsed['all'];
  const limit: number      = showAll ? entries.length : Math.max(1, Number(parsed['limit'] ?? 20));
  const page: ProcJobEntry[] = entries.slice(0, limit);

  // --fields
  const fieldsArg: string          = String(parsed['fields'] ?? '');
  const selectedFields: string[]   = fieldsArg
    ? fieldsArg.split(',').map((f: string) => f.trim()).filter(Boolean)
    : [...DEFAULT_JOB_FIELDS];

  const useTable: boolean = !!parsed['table'];
  const useCsv: boolean   = !!parsed['csv'];

  if (useCsv) {
    const header: string = selectedFields.map((f: string) => `"${f}"`).join(',');
    const rows: string = page.map((e: ProcJobEntry) =>
      selectedFields.map((f: string) => `"${String(e[f] ?? '').replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    console.log([header, rows].join('\n'));
    return;
  }

  if (useTable) {
    const tableData = page.map((e: ProcJobEntry) => {
      const row: Record<string, unknown> = {};
      selectedFields.forEach((f: string) => { row[f] = e[f] ?? ''; });
      return row;
    });
    console.log(screen.table_output(tableData, {
      head: selectedFields,
      title: { title: 'proc jobs', justification: 'center' },
      typeColors: { string: 'green', number: 'yellow', boolean: 'cyan', object: 'magenta' },
    }));
    return;
  }

  // Default: tab-separated with color
  for (const e of page) {
    const cols: string[] = selectedFields.map((f: string) => {
      const val: string = String(e[f] ?? '');
      if (f === 'id')     return chalk.bold(val);
      if (f === 'title')  return chalk.cyan(val);
      if (f === 'status') return statusColor(val);
      if (f === 'erroredJobs' && e.erroredJobs > 0) return chalk.red(val);
      return val;
    });
    console.log(cols.join('\t'));
  }

  if (!showAll && entries.length > limit) {
    console.log(chalk.gray(`  … ${entries.length - limit} more. Use --all or --limit <n>.`));
  }
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

/**
 * Handles proc commands.
 *
 * @param args - command arguments.
 */
export async function builtin_proc(args: string[]): Promise<void> {
  const subcommand: string | undefined = args[0];

  if (!subcommand || subcommand === 'refresh') {
    const feedArg: string | undefined = args[1];
    let feedID: number | undefined;

    if (feedArg) {
      const match: RegExpMatchArray | null = feedArg.match(/^(?:feed_)?(\d+)$/);
      if (!match) {
        console.error(chalk.red(`proc refresh: invalid feed ID '${feedArg}'`));
        return;
      }
      feedID = parseInt(match[1], 10);
    }

    const scope: string = feedID !== undefined ? `feed_${feedID}` : 'all feeds';
    spinner.start(`Refreshing /proc cache (${scope})...`);

    try {
      await procCache_refresh(feedID);
      spinner.stop();
      console.log(chalk.green(`/proc cache refreshed (${scope})`));
    } catch (error: unknown) {
      spinner.stop();
      const msg: string = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`proc refresh failed: ${msg}`));
    }
    return;
  }

  if (subcommand === 'jobs') {
    await jobs_subcmd(args.slice(1));
    return;
  }

  if (subcommand === 'find') {
    const query: string | undefined = args[1];
    if (!query) {
      console.error(chalk.red('Usage: proc find <instance_id | plugin_name_substring>'));
      return;
    }

    spinner.start(`Finding "${query}"...`);

    try {
      const cache = procCache_get();

      const result = await jobs_find(query);
      if (!result.ok) {
        spinner.stop();
        console.error(chalk.red(`Search failed.`));
        return;
      }

      const matches = result.value;
      if (matches.length === 0) {
        spinner.stop();
        console.error(chalk.yellow(`No instances found matching "${query}".`));
        return;
      }

      const feedIDs: number[] = [...new Set(matches.map(m => m.feedID))];
      await Promise.all(feedIDs.map((feedID: number) => procFeed_ensureLoaded(feedID)));

      spinner.stop();
      for (const m of matches) {
        const path: string | null = cache.path_build(m.id);
        if (path) console.log(path);
      }

    } catch (error: unknown) {
      spinner.stop();
      const msg: string = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`proc find failed: ${msg}`));
    }
    return;
  }

  if (subcommand === 'feeds') {
    const query: string | undefined = args[1];
    if (!query) {
      console.error(chalk.red('Usage: proc feeds <title_substring>'));
      return;
    }

    const cache = procCache_get();
    const matches = cache.feeds_find(query);

    if (matches.length === 0) {
      console.error(chalk.yellow(`No feeds found with title containing "${query}".`));
      return;
    }

    for (const feed of matches) {
      const status: string = feedStatus_derive(feed);
      console.log(`/proc/jobs/feed_${feed.id}  ${statusColor(status)}  ${chalk.dim(feed.title)}`);
    }
    return;
  }

  if (subcommand === 'stat') {
    const cache = procCache_get();
    const feedArg: string | undefined = args[1];

    if (!feedArg) {
      const warmup: ProcWarmupProgress = cache.warmupProgress_get();
      const warmupLine: string = warmup.active
        ? chalk.yellow(`in progress (${warmup.loaded} instances loaded)`)
        : cache.warmupComplete
          ? chalk.green('complete')
          : chalk.dim('not started');

      console.log(chalk.bold('proc cache summary'));
      console.log(`  feeds known    : ${chalk.cyan(String(cache.feedIDs_get().length))}`);
      console.log(`  instances      : ${chalk.cyan(String(cache.instances_count()))}`);
      console.log(`  topology sweep : ${warmupLine}`);
      return;
    }

    const match: RegExpMatchArray | null = feedArg.match(/^(?:feed_)?(\d+)$/);
    if (!match) {
      console.error(chalk.red(`proc stat: invalid feed ID '${feedArg}'`));
      return;
    }
    const feedID: number = parseInt(match[1], 10);
    const feed: ProcFeed | undefined = cache.feed_get(feedID);
    if (!feed) {
      console.error(chalk.yellow(`proc stat: feed_${feedID} not in cache`));
      return;
    }

    const topoLoaded: boolean = cache.topologyLoaded_has(feedID);
    const instCount: number   = topoLoaded ? cache.instancesForFeed_count(feedID) : -1;
    const status: string      = feedStatus_derive(feed);

    console.log(chalk.bold(`feed_${feedID}`));
    console.log(`  title          : ${chalk.cyan(feed.title)}`);
    console.log(`  status         : ${statusColor(status)}`);
    console.log(`  finishedJobs   : ${feed.finishedJobs}`);
    console.log(`  erroredJobs    : ${chalk[feed.erroredJobs > 0 ? 'red' : 'white'](String(feed.erroredJobs))}`);
    console.log(`  startedJobs    : ${feed.startedJobs}`);
    console.log(`  scheduledJobs  : ${feed.scheduledJobs}`);
    console.log(`  cancelledJobs  : ${feed.cancelledJobs}`);
    console.log(`  createdJobs    : ${feed.createdJobs}`);
    console.log(`  topology       : ${topoLoaded ? chalk.green(`loaded (${instCount} instances)`) : chalk.dim('not loaded')}`);
    return;
  }

  console.error(chalk.red(`proc: unknown subcommand '${subcommand}'. Use proc --help.`));
}
