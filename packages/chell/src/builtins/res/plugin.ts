/**
 * @file Builtin plugin command.
 * Manages plugins (list, run).
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { plugins_fetchList } from '@fnndsc/chili/commands/plugins/list.js';
import { plugin_execute } from '@fnndsc/chili/commands/plugin/run.js';
import { pluginList_render, pluginRun_render } from '@fnndsc/chili/views/plugin.js';
import { PluginInstance } from '@fnndsc/chili/models/plugin.js';
import { chiliCommand_run } from '../../chell.js';

/**
 * Handles plugin commands.
 *
 * @param args - command arguments.
 */
export async function builtin_plugin(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand = parsed._[0];
  
  if (!subcommand) {
     console.log(chalk.red("Usage: plugin <list|run> ..."));
     return;
  }

  try {
    if (subcommand === 'list') {
       const { plugins, selectedFields } = await plugins_fetchList(parsed as any);
       console.log(pluginList_render(plugins, selectedFields, { table: !!parsed.table, csv: !!parsed.csv }));
    } else if (subcommand === 'run') {
       const searchable = parsed._[1];
       if (!searchable) {
          console.log(chalk.red("Usage: plugin run <plugin> [args...]"));
          return;
       }
       const params = args.slice(2).join(' ');
       const instance: PluginInstance | null = await plugin_execute(searchable, params);
       if (instance) {
          console.log(pluginRun_render(instance));
       } else {
          console.error(chalk.red("Plugin execution failed."));
       }
    } else {
       console.log(chalk.yellow('Directive not handled by chell... spawning chili directly'));
       await chiliCommand_run('plugins', ['-s', ...args]);
    }
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`Plugin error: ${msg}`));
  }
}
