/**
 * @file Builtin proc command.
 * Manages the /proc VFS cache (job monitoring).
 */
import chalk from 'chalk';
import { procCache_refresh, job_feedID_get } from '@fnndsc/salsa';
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
    const idArg: string | undefined = args[1];
    if (!idArg) {
      console.error(chalk.red('Usage: proc find <instance_id>'));
      return;
    }
    const instanceID: number = parseInt(idArg, 10);
    if (isNaN(instanceID)) {
      console.error(chalk.red(`proc find: invalid instance ID '${idArg}'`));
      return;
    }

    spinner.start(`Finding instance ${instanceID}...`);

    try {
      const cache = procCache_get();

      // Check cache first (instance may already be loaded)
      let path: string | null = cache.path_build(instanceID);

      if (!path) {
        // Not in cache — look up its feed via API, then lazy-load that feed
        const feedResult: Result<number> = await job_feedID_get(instanceID);
        if (!feedResult.ok) {
          spinner.stop();
          console.error(chalk.yellow(`Instance ${instanceID} not found.`));
          return;
        }
        const feedID: number = feedResult.value;

        // Ensure feed is registered
        if (!cache.feed_get(feedID)) {
          cache.feed_add({ id: feedID, title: `feed_${feedID}` });
        }

        // Load instances for this feed
        await procCache_refresh(feedID);
        path = cache.path_build(instanceID);
      }

      spinner.stop();

      if (path) {
        console.log(path);
      } else {
        console.error(chalk.yellow(`Instance ${instanceID} path could not be reconstructed.`));
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
