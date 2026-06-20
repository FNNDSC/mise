/**
 * @file Builtin proc command.
 * Manages the /proc VFS cache (job monitoring).
 */
import chalk from 'chalk';
import { procCache_refresh, procFeed_ensureLoaded, jobs_find } from '@fnndsc/salsa';
import { procCache_get, type ProcFeed, type ProcWarmupProgress, type Result } from '@fnndsc/cumin';
import { spinner } from '../lib/spinner.js';
import { commandArgs_process, type ParsedArgs } from './utils.js';
import { list_applySort } from '@fnndsc/chili/utils/sort.js';
import { screen, table_display } from '@fnndsc/chili/screen/screen.js';
import {
  ProcJobEntry, ALL_JOB_FIELDS,
  feedStatus_derive, statusColor, jobFields_select,
  procEntries_filterBySearch, procCsv_render, feedId_parse,
} from './proc.helpers.js';

type ProcCache = ReturnType<typeof procCache_get>;

// ── proc jobs ─────────────────────────────────────────────────────────────────

/**
 * Builds flat job entries from the proc cache.
 *
 * @param cache - The proc cache.
 * @returns One entry per known feed.
 */
function procEntries_fromCache(cache: ProcCache): ProcJobEntry[] {
  return cache.feedIDs_get().map((feedID: number): ProcJobEntry => {
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
}

/**
 * Renders job entries as a bordered table.
 *
 * @param page - The entries to render.
 * @param selectedFields - The columns to show.
 */
function procJobs_renderTable(page: ProcJobEntry[], selectedFields: string[]): void {
  const tableData: Record<string, unknown>[] = page.map((e: ProcJobEntry) => {
    const row: Record<string, unknown> = {};
    selectedFields.forEach((f: string) => { row[f] = e[f] ?? ''; });
    return row;
  });
  console.log(screen.table_output(tableData, {
    head: selectedFields,
    title: { title: 'proc jobs', justification: 'center' },
    typeColors: { string: 'green', number: 'yellow', boolean: 'cyan', object: 'magenta' },
  }));
}

/**
 * Renders job entries as colorized, tab-separated lines.
 *
 * @param page - The entries to render.
 * @param selectedFields - The columns to show.
 */
function procJobs_renderLines(page: ProcJobEntry[], selectedFields: string[]): void {
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
}

/**
 * Handles `proc jobs [inspect|list]`: lists cached feed jobs with optional
 * search, sort, paging, field selection, and CSV/table output.
 *
 * @param args - Arguments following `proc jobs`.
 */
async function jobs_subcmd(args: string[]): Promise<void> {
  const second: string | undefined = args[0];

  if (second === 'inspect') {
    table_display(
      [...ALL_JOB_FIELDS].map((f: string) => ({ field: f })),
      ['field'],
      { title: { title: 'proc jobs fields', justification: 'center' } }
    );
    return;
  }

  const listArgs: string[] = second === 'list' ? args.slice(1) : args;
  const parsed: ParsedArgs = commandArgs_process(listArgs);

  let entries: ProcJobEntry[] = procEntries_fromCache(procCache_get());
  entries = procEntries_filterBySearch(entries, String(parsed['search'] ?? ''));

  if (entries.length === 0) {
    console.log(chalk.gray('No feeds in cache.'));
    return;
  }

  const sortField: string = String(parsed['sort'] ?? '');
  if (sortField) entries = list_applySort(entries, sortField, !!parsed['reverse']);

  const showAll: boolean = !!parsed['all'];
  const limit: number = showAll ? entries.length : Math.max(1, Number(parsed['limit'] ?? 20));
  const page: ProcJobEntry[] = entries.slice(0, limit);
  const selectedFields: string[] = jobFields_select(String(parsed['fields'] ?? ''));

  if (parsed['csv']) {
    console.log(procCsv_render(page, selectedFields));
    return;
  }
  if (parsed['table']) {
    procJobs_renderTable(page, selectedFields);
    return;
  }

  procJobs_renderLines(page, selectedFields);

  if (!showAll && entries.length > limit) {
    console.log(chalk.gray(`  … ${entries.length - limit} more. Use --all or --limit <n>.`));
  }
}

// ── proc subcommand handlers ────────────────────────────────────────────────

/**
 * Handles `proc refresh [feed]`: refreshes the cache for one feed or all.
 *
 * @param args - Full command args (`args[1]` is the optional feed).
 */
async function procRefresh_handle(args: string[]): Promise<void> {
  const feedArg: string | undefined = args[1];
  let feedID: number | undefined;

  if (feedArg) {
    const parsedId: number | null = feedId_parse(feedArg);
    if (parsedId === null) {
      console.error(chalk.red(`proc refresh: invalid feed ID '${feedArg}'`));
      return;
    }
    feedID = parsedId;
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
}

/**
 * Handles `proc find <query>`: locates instances by id/plugin-name and prints
 * their /proc paths.
 *
 * @param args - Full command args (`args[1]` is the query).
 */
async function procFind_handle(args: string[]): Promise<void> {
  const query: string | undefined = args[1];
  if (!query) {
    console.error(chalk.red('Usage: proc find <instance_id | plugin_name_substring>'));
    return;
  }

  spinner.start(`Finding "${query}"...`);

  try {
    const cache: ProcCache = procCache_get();
    const result: Result<Array<{ id: number; feedID: number; pluginName: string }>> = await jobs_find(query);
    if (!result.ok) {
      spinner.stop();
      console.error(chalk.red(`Search failed.`));
      return;
    }

    const matches: Array<{ id: number; feedID: number; pluginName: string }> = result.value;
    if (matches.length === 0) {
      spinner.stop();
      console.error(chalk.yellow(`No instances found matching "${query}".`));
      return;
    }

    const feedIDs: number[] = [...new Set(matches.map((m) => m.feedID))];
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
}

/**
 * Handles `proc feeds <query>`: lists cached feeds whose title matches.
 *
 * @param args - Full command args (`args[1]` is the query).
 */
async function procFeeds_handle(args: string[]): Promise<void> {
  const query: string | undefined = args[1];
  if (!query) {
    console.error(chalk.red('Usage: proc feeds <title_substring>'));
    return;
  }

  const cache: ProcCache = procCache_get();
  const matches: ProcFeed[] = cache.feeds_find(query);

  if (matches.length === 0) {
    console.error(chalk.yellow(`No feeds found with title containing "${query}".`));
    return;
  }

  for (const feed of matches) {
    const status: string = feedStatus_derive(feed);
    console.log(`/proc/jobs/feed_${feed.id}  ${statusColor(status)}  ${chalk.dim(feed.title)}`);
  }
}

/**
 * Handles `proc stat [feed]`: prints a cache summary or a single feed's detail.
 *
 * @param args - Full command args (`args[1]` is the optional feed).
 */
async function procStat_handle(args: string[]): Promise<void> {
  const cache: ProcCache = procCache_get();
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

  const feedID: number | null = feedId_parse(feedArg);
  if (feedID === null) {
    console.error(chalk.red(`proc stat: invalid feed ID '${feedArg}'`));
    return;
  }
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
    await procRefresh_handle(args);
    return;
  }
  if (subcommand === 'jobs') {
    await jobs_subcmd(args.slice(1));
    return;
  }
  if (subcommand === 'find') {
    await procFind_handle(args);
    return;
  }
  if (subcommand === 'feeds') {
    await procFeeds_handle(args);
    return;
  }
  if (subcommand === 'stat') {
    await procStat_handle(args);
    return;
  }

  console.error(chalk.red(`proc: unknown subcommand '${subcommand}'. Use proc --help.`));
}
