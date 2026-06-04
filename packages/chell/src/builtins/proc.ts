/**
 * @file Builtin proc command.
 * Manages the /proc VFS cache (job monitoring).
 */
import chalk from 'chalk';
import { procCache_refresh, job_feedID_get, jobs_searchByPluginName } from '@fnndsc/salsa';
import { procCache_get, Result } from '@fnndsc/cumin';
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

    const numericID: number = parseInt(query, 10);
    const isNumeric: boolean = !isNaN(numericID) && String(numericID) === query;

    spinner.start(`Finding ${isNumeric ? `instance ${numericID}` : `"${query}"`}...`);

    try {
      const cache = procCache_get();

      if (isNumeric) {
        // Numeric: find by instance ID
        let path: string | null = cache.path_build(numericID);

        if (!path) {
          const feedResult: Result<number> = await job_feedID_get(numericID);
          if (!feedResult.ok) {
            spinner.stop();
            console.error(chalk.yellow(`Instance ${numericID} not found.`));
            return;
          }
          const feedID: number = feedResult.value;
          if (!cache.feed_get(feedID)) {
            cache.feed_add({ id: feedID, title: `feed_${feedID}` });
          }
          await procCache_refresh(feedID);
          path = cache.path_build(numericID);
        }

        spinner.stop();
        if (path) {
          console.log(path);
        } else {
          console.error(chalk.yellow(`Instance ${numericID} path could not be reconstructed.`));
        }

      } else {
        // String: search by plugin name, return all matching paths
        const searchResult = await jobs_searchByPluginName(query);
        if (!searchResult.ok) {
          spinner.stop();
          console.error(chalk.red(`Search failed.`));
          return;
        }

        const matches = searchResult.value;
        if (matches.length === 0) {
          spinner.stop();
          console.error(chalk.yellow(`No instances found matching "${query}".`));
          return;
        }

        // Load instances for each unique feed encountered
        const feedsSeen: Set<number> = new Set();
        for (const m of matches) {
          if (!feedsSeen.has(m.feedID)) {
            feedsSeen.add(m.feedID);
            if (!cache.feed_get(m.feedID)) {
              cache.feed_add({ id: m.feedID, title: `feed_${m.feedID}` });
            }
            await procCache_refresh(m.feedID);
          }
        }

        spinner.stop();
        for (const m of matches) {
          const path: string | null = cache.path_build(m.id);
          if (path) {
            console.log(`${path}  [${m.status}]`);
          }
        }
      }

    } catch (error: unknown) {
      spinner.stop();
      const msg: string = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`proc find failed: ${msg}`));
    }
    return;
  }

  console.error(chalk.red(`proc: unknown subcommand '${subcommand}'. Usage: proc refresh [feed_id] | proc find <id>`));
}
