/**
 * @file Builtin plugininstance command.
 *
 * Subcommands: list, search, inspect
 * Aliases: plugininstance / plugininstances / instance / instances / job / jobs
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { pluginInstances_fetchList, PluginInstanceListResult } from '@fnndsc/chili/commands/plugininstances/list.js';
import { pluginInstanceFields_fetch } from '@fnndsc/chili/commands/plugininstances/fields.js';
import { table_display } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

export async function builtin_plugininstance(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (!subcommand || subcommand === 'list') {
    try {
      const { pluginInstances, selectedFields, totalCount }: PluginInstanceListResult = await pluginInstances_fetchList(parsed as unknown as CLIoptions);
      if (pluginInstances.length === 0) { console.log(chalk.gray('No plugin instances found.')); return; }
      table_display(pluginInstances, selectedFields, { title: { title: 'Plugin Instances', justification: 'center' }, pagination: totalCount !== undefined ? { shown: pluginInstances.length, total: totalCount } : undefined });
    } catch (e: unknown) {
      process.exitCode = 1;
      console.error(chalk.red(`plugininstance error: ${e instanceof Error ? e.message : String(e)}`));
    }
    return;
  }

  if (subcommand === 'search') {
    const query: string = parsed._[1] ?? '';
    await builtin_plugininstance([...args.filter((a: string) => a !== subcommand), `--search`, query]);
    return;
  }

  if (subcommand === 'inspect') {
    const fields: string[] | null = await pluginInstanceFields_fetch();
    if (fields && fields.length > 0) {
      table_display(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Plugin Instance fields', justification: 'center' } });
    } else {
      console.log(chalk.gray('No fields found for plugin instances.'));
    }
    return;
  }

  process.exitCode = 1;
  console.log(chalk.red(`Unknown subcommand: ${subcommand}. Usage: plugininstances <list|search|inspect>`));
}
