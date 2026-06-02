/**
 * @file Builtin feed command.
 * Manages feeds (list, create).
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { feeds_fetchList, FeedListResult } from '@fnndsc/chili/commands/feeds/list.js';
import { feedFields_fetch } from '@fnndsc/chili/commands/feeds/fields.js';
import { feed_create } from '@fnndsc/chili/commands/feed/create.js';
import { feedList_render, feedCreate_render } from '@fnndsc/chili/views/feed.js';
import { Feed } from '@fnndsc/chili/models/feed.js';
import { chiliCommand_run } from '../../chell.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import { table_display } from '@fnndsc/chili/screen/screen.js';

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
       const { feeds, selectedFields, totalCount }: FeedListResult = await feeds_fetchList(parsed as unknown as CLIoptions);
       console.log(feedList_render(feeds, selectedFields, { table: !!parsed.table, csv: !!parsed.csv }));
       if (totalCount !== undefined && feeds.length < totalCount) {
         console.log(chalk.dim(`  ↓ showing ${feeds.length} of ${totalCount}  ·  --all to fetch all  ·  --limit <n> for page size`));
       }
    } else if (subcommand === 'create') {
       const feed: Feed | null = await feed_create(parsed as unknown as CLIoptions);
       if (feed) {
          console.log(feedCreate_render(feed));
       }
    } else if (subcommand === 'inspect') {
       const fields: string[] | null = await feedFields_fetch();
       if (fields && fields.length > 0) {
         table_display(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Feed fields', justification: 'center' } });
       } else {
         console.log(chalk.gray('No fields found.'));
       }
    } else if (subcommand === 'search') {
       const query: string = parsed._[1] ?? '';
       await builtin_feed(['list', '--search', query]);
    } else {
       console.log(chalk.yellow('Directive not handled by chell... spawning chili directly'));
       await chiliCommand_run('feeds', ['-s', ...args]);
    }
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`Feed error: ${msg}`));
  }
}
