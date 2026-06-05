/**
 * @file Builtin proc command.
 * Manages the /proc VFS cache (job monitoring).
 */
import chalk from 'chalk';
import { procCache_refresh, procFeed_ensureLoaded, jobs_find } from '@fnndsc/salsa';
import { procCache_get, type ProcFeed, type ProcWarmupProgress } from '@fnndsc/cumin';
import { spinner } from '../lib/spinner.js';

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

  if (subcommand === 'find') {
    const query: string | undefined = args[1];
    if (!query) {
      console.error(chalk.red('Usage: proc find <instance_id | plugin_name_substring>'));
      return;
    }

    spinner.start(`Finding "${query}"...`);

    try {
      const cache = procCache_get();

      // Unified search: cache-first, API fallback for both ID and name
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

      // Ensure topology loaded for all matched feeds in parallel.
      // Uses procFeed_ensureLoaded (not procCache_refresh) so warmup work
      // is reused — only fetches feeds that aren't already in the cache.
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
      let status: string;
      if (feed.erroredJobs > 0) status = 'finishedWithError';
      else if (feed.startedJobs + feed.scheduledJobs + feed.createdJobs > 0) status = 'running';
      else if (feed.cancelledJobs > 0 && feed.finishedJobs === 0) status = 'cancelled';
      else if (feed.finishedJobs > 0) status = 'finishedSuccessfully';
      else status = 'empty';

      const statusColor: string =
        status === 'finishedSuccessfully' ? chalk.green(status) :
        status === 'finishedWithError'    ? chalk.red(status) :
        status === 'running'              ? chalk.yellow(status) :
        status === 'cancelled'            ? chalk.dim(status) :
        chalk.gray(status);

      console.log(`/proc/jobs/feed_${feed.id}  ${statusColor}  ${chalk.dim(feed.title)}`);
    }
    return;
  }

  if (subcommand === 'stat') {
    const cache = procCache_get();
    const feedArg: string | undefined = args[1];

    if (!feedArg) {
      // Cache-level summary
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
    const instCount: number = topoLoaded ? cache.instancesForFeed_count(feedID) : -1;

    // Derive status (mirrors feedStatus_derive in proc.ts)
    let status: string;
    if (feed.erroredJobs > 0) status = 'finishedWithError';
    else if (feed.startedJobs + feed.scheduledJobs + feed.createdJobs > 0) status = 'running';
    else if (feed.cancelledJobs > 0 && feed.finishedJobs === 0) status = 'cancelled';
    else if (feed.finishedJobs > 0) status = 'finishedSuccessfully';
    else status = 'empty';

    const statusColor: string =
      status === 'finishedSuccessfully' ? chalk.green(status) :
      status === 'finishedWithError'    ? chalk.red(status) :
      status === 'running'              ? chalk.yellow(status) :
      status === 'cancelled'            ? chalk.dim(status) :
      chalk.gray(status);

    console.log(chalk.bold(`feed_${feedID}`));
    console.log(`  title          : ${chalk.cyan(feed.title)}`);
    console.log(`  status         : ${statusColor}`);
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
