/**
 * @file Builtin store command.
 * Manages peer store interactions (list, search).
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from './utils.js';
import { store_listPlugins, store_searchPlugins } from '@fnndsc/chili/commands/store/list.js';
import { grid_render, long_render } from '@fnndsc/chili/views/ls.js';
import { spinner } from '../lib/spinner.js';

/**
 * Handles store commands.
 *
 * @param args - command arguments.
 */
export async function builtin_store(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand = parsed._[0];

  if (!subcommand) {
     console.log(chalk.red("Usage: store <list|search> ..."));
     return;
  }

  const storeOptions = {
    store: parsed.store as string | undefined
  };

  try {
    spinner.start('Fetching from store...');
    
    if (subcommand === 'list') {
       const items = await store_listPlugins(storeOptions);
       spinner.stop();
       
       if (items.length === 0) {
         console.log('No plugins found in store.');
         return;
       }

       // Use grid render by default, or long render if -l flag (handled by view options in future, 
       // but currently ls view helpers accept options).
       // chell's ls uses args to parse flags. Here we have parsed args.
       // parsed.l is boolean.
       if (parsed.l) {
         console.log(long_render(items, { human: !!parsed.h }));
       } else {
         console.log(grid_render(items));
       }

    } else if (subcommand === 'search') {
       const query = parsed._[1];
       if (!query) {
          spinner.stop();
          console.log(chalk.red("Usage: store search <query>"));
          return;
       }
       
       const items = await store_searchPlugins(query, storeOptions);
       spinner.stop();

       if (items.length === 0) {
         console.log(`No plugins found matching '${query}'.`);
         return;
       }

       if (parsed.l) {
         console.log(long_render(items, { human: !!parsed.h }));
       } else {
         console.log(grid_render(items));
       }

    } else {
       spinner.stop();
       console.log(chalk.red(`Unknown subcommand: ${subcommand}`));
    }
  } catch (e: unknown) {
    spinner.stop();
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`Store error: ${msg}`));
  }
}
