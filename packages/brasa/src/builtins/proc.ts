/**
 * @file Builtin proc command.
 * Manages the /proc VFS cache (job monitoring).
 */
import chalk from 'chalk';
import { context_getSingle, procCache_refresh, procFeed_ensureLoaded, procRoster_sync, procTopology_await, procTopology_retry, procTopology_status, procTopology_warmup, jobs_find, type ProcTopologyStatus } from '@fnndsc/salsa';
import { path_extractFeedID, path_extractPluginInstanceID, path_isInFeed, procCache_get, type ProcCacheLifecycle, type ProcFeed, type ProcFeedScopeCounts, type ProcInstance, type ProcWarmupProgress, type Result, type CommandEnvelope, type SingleContext, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { FEED_LIST_MODEL_KIND, type FeedListModel } from '@fnndsc/menu';
import { spinner } from '../lib/spinner.js';
import { commandArgs_process, type ParsedArgs } from './utils.js';
import { builtin_cd } from './fs/cd.js';
import { procWatch_add, procWatch_remove, procWatch_list, watchSubject_parse, type ProcWatchEntry } from './procWatch.js';
import { session } from '../session/index.js';
import { list_applySort } from '@fnndsc/chili/utils/sort.js';
import { screen, table_render } from '@fnndsc/chili/screen/screen.js';
import {
  ProcJobEntry, ALL_JOB_FIELDS,
  feedStatus_derive, statusColor, jobFields_select,
  procEntries_filterBySearch, procCsv_render, feedId_parse,
} from './proc.helpers.js';

type ProcCache = ReturnType<typeof procCache_get>;

/**
 * Refuses a global cache query while topology warm-up is incomplete.
 *
 * @param command - Command the user can repeat with `--force`.
 * @param force - Whether to await the active warm-up instead of refusing.
 * @returns An error envelope when blocked, otherwise null.
 */
async function procWarmup_guard(command: string, force: boolean): Promise<CommandEnvelope | null> {
  const cache: ProcCache = procCache_get();
  const progress: ProcWarmupProgress = cache.warmupProgress_get();
  const topology: ProcTopologyStatus = procTopology_status();
  if (cache.lifecycle_get().checkpointAt && !force) return null;
  if (!progress.active && topology.state !== 'running' && topology.state !== 'failed') return null;

  if (topology.state === 'failed') {
    process.exitCode = 1;
    const reason: string = topology.failure ? `: ${topology.failure}` : '';
    return envelope_error('', undefined,
      `${chalk.red(`proc: the visible-job index failed to warm${reason}.`)}\n` +
      'Global queries are disabled to avoid incomplete results. Run `proc retry` to continue from the failed page.\n'
    );
  }

  if (force) {
    spinner.start('Waiting for the complete /proc job index...');
    try {
      await procTopology_await();
      const cache: ProcCache = procCache_get();
      const settled: ProcTopologyStatus = procTopology_status();
      if (settled.state !== 'complete' || cache.warmupProgress_get().active || !cache.warmupComplete) {
        throw new Error('the topology sweep did not complete');
      }
      spinner.stop();
      return null;
    } catch (error: unknown) {
      spinner.stop();
      const message: string = error instanceof Error ? error.message : String(error);
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`proc warm-up failed: ${message}`)}\n`);
    }
  }

  const percent: number = progress.total > 0
    ? Math.min(99, Math.floor((progress.loaded / progress.total) * 100))
    : 0;
  const count: string = progress.total > 0
    ? `${progress.loaded}/${progress.total}, ${percent}%`
    : 'initializing';
  process.exitCode = 1;
  return envelope_error('', undefined,
    `${chalk.yellow(`proc: the visible-job index is still warming (${count}).`)}\n` +
    'This query could return incomplete results.\n\n' +
    'Wait for warm-up to finish, or run:\n' +
    `  ${command} --force\n\n` +
    '--force waits for the complete index and may take some time.\n'
  );
}

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
 * @returns The rendered table.
 */
function procJobs_renderTable(page: ProcJobEntry[], selectedFields: string[]): string {
  const tableData: Record<string, unknown>[] = page.map((e: ProcJobEntry) => {
    const row: Record<string, unknown> = {};
    selectedFields.forEach((f: string) => { row[f] = e[f] ?? ''; });
    return row;
  });
  return `${screen.table_output(tableData, {
    head: selectedFields,
    title: { title: 'proc jobs', justification: 'center' },
    typeColors: { string: 'green', number: 'yellow', boolean: 'cyan', object: 'magenta' },
  })}\n`;
}

/**
 * Renders job entries as colorized, tab-separated lines.
 *
 * @param page - The entries to render.
 * @param selectedFields - The columns to show.
 * @returns The rendered lines.
 */
function procJobs_renderLines(page: ProcJobEntry[], selectedFields: string[]): string {
  let out: string = '';
  for (const e of page) {
    const cols: string[] = selectedFields.map((f: string) => {
      const val: string = String(e[f] ?? '');
      if (f === 'id')     return chalk.bold(val);
      if (f === 'title')  return chalk.cyan(val);
      if (f === 'status') return statusColor(val);
      if (f === 'erroredJobs' && e.erroredJobs > 0) return chalk.red(val);
      return val;
    });
    out += `${cols.join('\t')}\n`;
  }
  return out;
}

/**
 * Handles `proc jobs [inspect|list]`: lists cached feed jobs with optional
 * search, sort, paging, field selection, and CSV/table output.
 *
 * @param args - Arguments following `proc jobs`.
 * @returns An envelope carrying the listing.
 */
async function jobs_subcmd(args: string[]): Promise<CommandEnvelope> {
  const second: string | undefined = args[0];

  if (second === 'inspect') {
    return envelope_ok(table_render(
      [...ALL_JOB_FIELDS].map((f: string) => ({ field: f })),
      ['field'],
      { title: { title: 'proc jobs fields', justification: 'center' } }
    ));
  }

  const listArgs: string[] = second === 'list' ? args.slice(1) : args;
  const parsed: ParsedArgs = commandArgs_process(listArgs);
  const blocked: CommandEnvelope | null = await procWarmup_guard('proc jobs list', !!parsed['force']);
  if (blocked) return blocked;
  await procRoster_sync();

  let entries: ProcJobEntry[] = procEntries_fromCache(procCache_get());
  entries = procEntries_filterBySearch(entries, String(parsed['search'] ?? ''));

  if (entries.length === 0) {
    return envelope_ok(`${chalk.gray('No feeds in cache.')}\n`);
  }

  const sortField: string = String(parsed['sort'] ?? '');
  if (sortField) entries = list_applySort(entries, sortField, !!parsed['reverse']);

  const showAll: boolean = !!parsed['all'];
  const limit: number = showAll ? entries.length : Math.max(1, Number(parsed['limit'] ?? 20));
  const page: ProcJobEntry[] = entries.slice(0, limit);
  const selectedFields: string[] = jobFields_select(String(parsed['fields'] ?? ''));

  if (parsed['csv']) {
    return envelope_ok(`${procCsv_render(page, selectedFields)}\n`);
  }
  if (parsed['table']) {
    return envelope_ok(procJobs_renderTable(page, selectedFields));
  }

  let rendered: string = procJobs_renderLines(page, selectedFields);
  if (!showAll && entries.length > limit) {
    rendered += `${chalk.gray(`  … ${entries.length - limit} more. Use --all or --limit <n>.`)}\n`;
  }
  return envelope_ok(rendered);
}

// ── proc subcommand handlers ────────────────────────────────────────────────

/**
 * Handles `proc refresh [feed]`: refreshes the cache for one feed or all.
 *
 * @param args - Full command args (`args[1]` is the optional feed).
 * @returns An envelope reporting the refresh outcome.
 */
async function procRefresh_handle(args: string[]): Promise<CommandEnvelope> {
  const feedArg: string | undefined = args[1];
  let feedID: number | undefined;

  if (feedArg) {
    const parsedId: number | null = feedId_parse(feedArg);
    if (parsedId === null) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`proc refresh: invalid feed ID '${feedArg}'`)}\n`);
    }
    feedID = parsedId;
  }

  const scope: string = feedID !== undefined ? `feed_${feedID}` : 'all feeds';
  spinner.start(`Refreshing /proc cache (${scope})...`);

  try {
    await procCache_refresh(feedID);
    if (feedID === undefined) {
      void procTopology_warmup().catch((): void => { /* surfaced by proc topology status */ });
    }
    spinner.stop();
    return envelope_ok(`${chalk.green(`/proc cache refreshed (${scope})`)}\n`);
  } catch (error: unknown) {
    spinner.stop();
    const msg: string = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`proc refresh failed: ${msg}`)}\n`);
  }
}

/**
 * Resumes the session's failed global topology sweep at its failed page.
 *
 * @returns An envelope confirming the retained progress, or a clear error when
 * there is no failed sweep to retry.
 */
function procRetry_handle(): CommandEnvelope {
  const topology: ProcTopologyStatus = procTopology_status();
  if (topology.state !== 'failed') {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.yellow('proc retry: no failed topology sweep to retry')}\n`);
  }

  const progress: ProcWarmupProgress = procCache_get().warmupProgress_get();
  try {
    const resumed: Promise<void> = procTopology_retry();
    void resumed.catch((): void => { /* surfaced by proc topology status */ });
    return envelope_ok(
      `${chalk.green(`/proc topology retry resumed at ${progress.loaded}/${progress.total}`)}\n`,
    );
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`proc retry failed: ${message}`)}\n`);
  }
}

/**
 * Handles `proc find <query>`: locates instances by id/plugin-name and reports
 * their /proc paths.
 *
 * @param args - Full command args (`args[1]` is the query).
 * @returns An envelope carrying the matched paths.
 */
async function procFind_handle(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args.slice(1));
  const query: string | undefined = parsed._[0];
  if (!query) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('Usage: proc find <instance_id | plugin_name_substring>')}\n`);
  }

  const numeric: number = parseInt(query, 10);
  const isInstanceID: boolean = !isNaN(numeric) && String(numeric) === query;
  if (!isInstanceID) {
    const blocked: CommandEnvelope | null = await procWarmup_guard(`proc find ${query}`, !!parsed['force']);
    if (blocked) return blocked;
  }

  spinner.start(`Finding "${query}"...`);

  try {
    const cache: ProcCache = procCache_get();
    const result: Result<Array<{ id: number; feedID: number; pluginName: string }>> = await jobs_find(query);
    if (!result.ok) {
      spinner.stop();
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`Search failed.`)}\n`);
    }

    const matches: Array<{ id: number; feedID: number; pluginName: string }> = result.value;
    if (matches.length === 0) {
      spinner.stop();
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.yellow(`No instances found matching "${query}".`)}\n`);
    }

    const feedIDs: number[] = [...new Set(matches.map((m) => m.feedID))];
    await Promise.all(feedIDs.map((feedID: number) => procFeed_ensureLoaded(feedID)));

    spinner.stop();
    let rendered: string = '';
    for (const m of matches) {
      const path: string | null = cache.path_build(m.id);
      if (path) rendered += `${path}\n`;
    }
    return envelope_ok(rendered);
  } catch (error: unknown) {
    spinner.stop();
    const msg: string = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`proc find failed: ${msg}`)}\n`);
  }
}

/**
 * Maps a canonical CFS feed path into its matching `/proc` location.
 *
 * The CFS feed namespace and `/proc` share CUBE's feed and plugin-instance
 * identifiers. A feed root maps directly; a job path maps only after its
 * cached node confirms the same feed. An unknown node is loaded scoped to that
 * one feed rather than by a global scan.
 *
 * @param cwd - Current CFS path to examine.
 * @param cache - Current `/proc` cache.
 * @returns The matching `/proc` path, or null when the CFS path is not canonical.
 */
async function procHere_canonicalPath_get(cwd: string, cache: ProcCache): Promise<string | null> {
  if (!path_isInFeed(cwd)) return null;
  const feedID: number | null = path_extractFeedID(cwd);
  if (feedID === null || !cache.feed_get(feedID)) return null;

  const instanceID: number | null = path_extractPluginInstanceID(cwd);
  if (instanceID === null) return `/proc/jobs/feed_${feedID}`;

  let instance: ProcInstance | undefined = cache.instance_get(instanceID);
  if (!instance || instance.feedID !== feedID) {
    await procFeed_ensureLoaded(feedID);
    instance = cache.instance_get(instanceID);
  }
  if (!instance || instance.feedID !== feedID) return null;
  return cache.path_build(instanceID);
}

/**
 * Returns from a CFS output directory to its producing `/proc` job node.
 *
 * Canonical `/home/<user>/feeds/feed_<id>` paths map directly using CUBE's
 * stable feed and plugin-instance IDs. Other CFS output locations use the
 * session's CUBE-supplied output-path provenance as a fallback.
 *
 * @param args - Full command args. No operands are accepted.
 * @returns The directory-change envelope, or a clear error when provenance is unknown.
 */
async function procHere_handle(args: string[]): Promise<CommandEnvelope> {
  if (args.length > 1) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('Usage: proc here')}\n`);
  }

  const cache: ProcCache = procCache_get();
  const cwd: string = await session.getCWD();
  const canonicalPath: string | null = await procHere_canonicalPath_get(cwd, cache);
  if (canonicalPath) return builtin_cd([canonicalPath]);

  const source: ProcInstance | undefined = cache.outputPath_match(cwd);
  if (!source) {
    process.exitCode = 1;
    return envelope_error('', undefined,
      `${chalk.yellow('proc here: no matching /proc job is known for this path in the current session.')}\n` +
      'Use a canonical CFS feed path, follow a job\'s `data` link first, or use `cd -` to return to the previous directory.\n'
    );
  }

  const procPath: string | null = cache.path_build(source.id);
  if (!procPath) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('proc here: producing job is no longer available in /proc.')}\n`);
  }
  return builtin_cd([procPath]);
}

/**
 * Handles `proc feeds <query>`: lists cached feeds whose title matches.
 *
 * @param args - Full command args (`args[1]` is the query).
 * @returns An envelope carrying the matched feeds.
 */
async function procFeeds_handle(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args.slice(1));
  // No query lists the whole cache-resident roster — the chooser's case.
  const query: string = parsed._[0] ?? '';

  const blocked: CommandEnvelope | null = await procWarmup_guard(
    `proc feeds${query ? ` ${query}` : ''}`, !!parsed['force'],
  );
  if (blocked) return blocked;
  await procRoster_sync();

  const cache: ProcCache = procCache_get();
  const matches: ProcFeed[] = cache.feeds_find(query)
    .sort((a: ProcFeed, b: ProcFeed) => b.creationDate.localeCompare(a.creationDate));

  if (matches.length === 0) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.yellow(
      query ? `No feeds found with title containing "${query}".` : 'No feeds in the cache.',
    )}\n`);
  }

  let rendered: string = '';
  for (const feed of matches) {
    const status: string = feedStatus_derive(feed);
    rendered += `/proc/jobs/feed_${feed.id}  ${statusColor(status)}  ${chalk.dim(feed.title)}\n`;
  }
  const model: FeedListModel = {
    feeds: matches.map((feed: ProcFeed): FeedListModel['feeds'][number] => ({
      id: feed.id,
      title: feed.title,
      owner: feed.ownerUsername,
      status: feedStatus_derive(feed),
      createdAt: feed.creationDate,
    })),
  };
  return envelope_ok(rendered, { kind: FEED_LIST_MODEL_KIND, data: model });
}

/**
 * Handles `proc stat [feed]`: reports a cache summary or a single feed's detail.
 *
 * @param args - Full command args (`args[1]` is the optional feed).
 * @returns An envelope carrying the summary or feed detail.
 */
async function procStat_handle(args: string[]): Promise<CommandEnvelope> {
  const cache: ProcCache = procCache_get();
  const feedArg: string | undefined = args[1];

  if (!feedArg) {
    const warmup: ProcWarmupProgress = cache.warmupProgress_get();
    const topology: ProcTopologyStatus = procTopology_status();
    const lifecycle: ProcCacheLifecycle = cache.lifecycle_get();
    const context: SingleContext = await context_getSingle();
    const counts: ProcFeedScopeCounts = cache.feedScopeCounts_get(context.user ?? '');
    const warmupLine: string = topology.state === 'failed'
      ? chalk.red(`failed${topology.failure ? `: ${topology.failure}` : ''}`)
      : topology.state === 'running' || warmup.active
        ? chalk.yellow(warmup.active ? 'in progress' : 'initializing')
        : cache.warmupComplete
          ? chalk.green('complete')
          : chalk.dim('not started');
    const jobCount: string = warmup.total > 0
      ? `${warmup.loaded}/${warmup.total}`
      : cache.warmupComplete
        ? `${warmup.loaded}/0`
        : `${warmup.loaded}/?`;

    let rendered: string = `${chalk.bold('proc cache summary')}\n`;
    rendered += `  visible feeds  : ${chalk.cyan(String(counts.total))}\n`;
    rendered += `    user         : ${chalk.cyan(String(counts.user))}\n`;
    rendered += `    public       : ${chalk.cyan(String(counts.public))}\n`;
    rendered += `    shared       : ${chalk.cyan(String(counts.shared))}\n`;
    rendered += `  jobs loaded    : ${chalk.cyan(jobCount)}\n`;
    rendered += `  topology sweep : ${warmupLine}\n`;
    rendered += `  cache state    : ${chalk.cyan(lifecycle.state)}\n`;
    if (lifecycle.checkpointAt) rendered += `  checkpoint     : ${chalk.cyan(lifecycle.checkpointAt)}\n`;
    return envelope_ok(rendered);
  }

  const feedID: number | null = feedId_parse(feedArg);
  if (feedID === null) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`proc stat: invalid feed ID '${feedArg}'`)}\n`);
  }
  const feed: ProcFeed | undefined = cache.feed_get(feedID);
  if (!feed) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.yellow(`proc stat: feed_${feedID} not in cache`)}\n`);
  }

  const topoLoaded: boolean = cache.topologyLoaded_has(feedID);
  const instCount: number   = topoLoaded ? cache.instancesForFeed_count(feedID) : -1;
  const status: string      = feedStatus_derive(feed);

  let rendered: string = `${chalk.bold(`feed_${feedID}`)}\n`;
  rendered += `  title          : ${chalk.cyan(feed.title)}\n`;
  rendered += `  status         : ${statusColor(status)}\n`;
  rendered += `  finishedJobs   : ${feed.finishedJobs}\n`;
  rendered += `  erroredJobs    : ${chalk[feed.erroredJobs > 0 ? 'red' : 'white'](String(feed.erroredJobs))}\n`;
  rendered += `  startedJobs    : ${feed.startedJobs}\n`;
  rendered += `  scheduledJobs  : ${feed.scheduledJobs}\n`;
  rendered += `  cancelledJobs  : ${feed.cancelledJobs}\n`;
  rendered += `  createdJobs    : ${feed.createdJobs}\n`;
  rendered += `  topology       : ${topoLoaded ? chalk.green(`loaded (${instCount} instances)`) : chalk.dim('not loaded')}\n`;
  return envelope_ok(rendered);
}

// ── Watches ───────────────────────────────────────────────────────────────────

/** The operator at a console owns its watches under one name. */
const OPERATOR_OWNER: string = 'operator';

/**
 * Handles `proc watch [feed]`: opens an operator watch on a feed (its DAG is
 * then sampled while it runs, and every surface receives the refreshed
 * model), or with no argument lists the session's watches.
 *
 * @param args - Full command args (`args[1]` is the feed).
 * @returns An envelope reporting the watch state or the watch list.
 */
async function procWatch_handle(args: string[]): Promise<CommandEnvelope> {
  const subject: string | undefined = args[1];
  if (subject === undefined) {
    const entries: ProcWatchEntry[] = procWatch_list();
    if (entries.length === 0) return envelope_ok(`${chalk.gray('No watches.')}\n`);
    let rendered: string = '';
    for (const entry of entries) {
      rendered += `/proc/jobs/feed_${entry.feedID}  ${chalk.cyan(entry.state)}  ${chalk.dim(`${entry.owners} owner(s)`)}\n`;
    }
    return envelope_ok(rendered);
  }
  const feedID: number | null = watchSubject_parse(subject);
  if (feedID === null) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`proc watch: not a feed: '${subject}'`)}\n`);
  }
  const state: string = procWatch_add(feedID, OPERATOR_OWNER);
  return envelope_ok(`${chalk.green(`watching /proc/jobs/feed_${feedID}`)} ${chalk.cyan(state)}\n`);
}

/**
 * Handles `proc unwatch <feed>`: releases the operator's watch on a feed.
 *
 * @param args - Full command args (`args[1]` is the feed).
 * @returns An envelope confirming the release.
 */
async function procUnwatch_handle(args: string[]): Promise<CommandEnvelope> {
  const subject: string | undefined = args[1];
  const feedID: number | null = subject === undefined ? null : watchSubject_parse(subject);
  if (feedID === null) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('proc unwatch: a feed is required')}\n`);
  }
  procWatch_remove(feedID, OPERATOR_OWNER);
  return envelope_ok(`${chalk.green(`released /proc/jobs/feed_${feedID}`)}\n`);
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

/**
 * Handles proc commands.
 *
 * @param args - command arguments.
 * @returns An envelope carrying the subcommand's output.
 */
export async function builtin_proc(args: string[]): Promise<CommandEnvelope> {
  const subcommand: string | undefined = args[0];

  if (!subcommand || subcommand === 'refresh') {
    return procRefresh_handle(args);
  }
  if (subcommand === 'retry') {
    return procRetry_handle();
  }
  if (subcommand === 'jobs') {
    return jobs_subcmd(args.slice(1));
  }
  if (subcommand === 'find') {
    return procFind_handle(args);
  }
  if (subcommand === 'here') {
    return procHere_handle(args);
  }
  if (subcommand === 'feeds') {
    return procFeeds_handle(args);
  }
  if (subcommand === 'stat') {
    return procStat_handle(args);
  }
  if (subcommand === 'watch') {
    return procWatch_handle(args);
  }
  if (subcommand === 'unwatch') {
    return procUnwatch_handle(args);
  }

  process.exitCode = 1;
  return envelope_error('', undefined, `${chalk.red(`proc: unknown subcommand '${subcommand}'. Use proc --help.`)}\n`);
}
