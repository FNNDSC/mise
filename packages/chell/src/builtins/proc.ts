/**
 * @file Builtin proc command.
 * Manages the /proc VFS cache (job monitoring).
 */
import chalk from 'chalk';
import { procCache_refresh, jobs_find } from '@fnndsc/salsa';
import { procCache_get } from '@fnndsc/cumin';
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

      // Ensure each matched feed's instance tree is loaded for path reconstruction
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

    } catch (error: unknown) {
      spinner.stop();
      const msg: string = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`proc find failed: ${msg}`));
    }
    return;
  }

  console.error(chalk.red(`proc: unknown subcommand '${subcommand}'. Usage: proc refresh [feed_id] | proc find <id>`));
}
