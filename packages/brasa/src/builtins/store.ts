/**
 * @file Builtin store command.
 * Manages peer store interactions (list, search, install).
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from './utils.js';
import { store_listPlugins, store_searchPlugins } from '@fnndsc/chili/commands/store/list.js';
import { grid_render, long_render } from '@fnndsc/chili/views/ls.js';
import { spinner } from '../lib/spinner.js';
import { plugin_addInteractive } from './res/plugin.js';
import { type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import {
  DEFAULT_STORE_URL,
  storeUrl_get,
  storeUrl_isDefault,
  storeUrl_set,
  storeUrl_clear,
  storeConfig_persist,
} from '../config/storeConfig.js';

/**
 * Handles store commands.
 *
 * @param args - command arguments.
 * @returns An envelope carrying the rendered store output.
 */
export async function builtin_store(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string = parsed._[0];

  if (!subcommand) {
     return envelope_ok(`${chalk.red("Usage: store <list|search|install> ...")}\n`);
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
         return envelope_ok('No plugins found in store.\n');
       }

       // Use grid render by default, or long render if -l flag.
       return envelope_ok(parsed.l ? `${long_render(items, { human: !!parsed.h })}\n` : `${grid_render(items)}\n`);

    } else if (subcommand === 'search') {
       const query: string = parsed._[1];
       if (!query) {
          spinner.stop();
          return envelope_ok(`${chalk.red("Usage: store search <query>")}\n`);
       }

       const items = await store_searchPlugins(query, storeOptions);
       spinner.stop();

       if (items.length === 0) {
         return envelope_ok(`No plugins found matching '${query}'.\n`);
       }

       return envelope_ok(parsed.l ? `${long_render(items, { human: !!parsed.h })}\n` : `${grid_render(items)}\n`);

    } else if (subcommand === 'install') {
       spinner.stop();
       const installParsed: ParsedArgs = { ...parsed, _: [parsed._[0], parsed._[1]] };
       return await plugin_addInteractive(installParsed);
    } else if (subcommand === 'inspect') {
       spinner.stop();
       const current: string = storeUrl_get();
       const isDefault: boolean = storeUrl_isDefault();
       return envelope_ok(`${chalk.bold('Peer store URL:')} ${chalk.blue(current)}${isDefault ? chalk.gray(' (default)') : chalk.yellow(' (custom)')}\n`);
    } else if (subcommand === 'set') {
       spinner.stop();
       const url: string | undefined = parsed._[1];
       if (!url) {
         process.exitCode = 1;
         return envelope_error('', undefined, `${chalk.red('Usage: store set <url>')}\n`);
       }
       storeUrl_set(url);
       await storeConfig_persist();
       return envelope_ok(`${chalk.green(`Store URL set to: ${chalk.blue(url)}`)}\n`);
    } else if (subcommand === 'reset') {
       spinner.stop();
       storeUrl_clear();
       await storeConfig_persist();
       return envelope_ok(`${chalk.green(`Store URL reset to default: ${chalk.blue(DEFAULT_STORE_URL)}`)}\n`);
    }
    spinner.stop();
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`Unknown subcommand: ${subcommand}. Usage: store <list|search|install|inspect|set|reset>`)}\n`);
  } catch (e: unknown) {
    spinner.stop();
    const msg: string = e instanceof Error ? e.message : String(e);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`Store error: ${msg}`)}\n`);
  }
}
