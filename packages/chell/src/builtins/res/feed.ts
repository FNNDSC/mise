/**
 * @file Builtin feed command.
 * Manages feeds (list, create).
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { feeds_fetchList, FeedListResult } from '@fnndsc/chili/commands/feeds/list.js';
import { feed_create } from '@fnndsc/chili/commands/feed/create.js';
import { feedList_render, feedCreate_render } from '@fnndsc/chili/views/feed.js';
import { Feed } from '@fnndsc/chili/models/feed.js';
import { chiliCommand_run } from '../../chell.js';

/**
 * Handles feed commands.
 *
 * @param args - command arguments.
 */
export async function builtin_feed(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand = parsed._[0];
  
  if (!subcommand) {
     console.log(chalk.red("Usage: feed <list|create> ..."));
     return;
  }

  try {
    if (subcommand === 'list') {
       const { feeds, selectedFields }: FeedListResult = await feeds_fetchList(parsed as any);
       console.log(feedList_render(feeds, selectedFields, { table: !!parsed.table, csv: !!parsed.csv }));
    } else if (subcommand === 'create') {
       // Requires --dirs and --params flag handling which parsed already has.
       // feed create --dirs ...
       const feed: Feed | null = await feed_create(parsed as any);
       if (feed) {
          console.log(feedCreate_render(feed));
       }
    } else {
       console.log(chalk.yellow('Directive not handled by chell... spawning chili directly'));
       await chiliCommand_run('feeds', ['-s', ...args]);
    }
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`Feed error: ${msg}`));
  }
}
