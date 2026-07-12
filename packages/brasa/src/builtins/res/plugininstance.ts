/**
 * @file Builtin plugininstance command.
 *
 * Subcommands: list, search, inspect
 * Aliases: plugininstance / plugininstances / instance / instances / job / jobs
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { pluginInstances_fetchList, PluginInstanceListResult } from '@fnndsc/chili/commands/plugininstances/list.js';
import { pluginInstanceFields_fetch } from '@fnndsc/chili/commands/plugininstances/fields.js';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

/**
 * Builtin handler for the `plugininstance` command.
 *
 * @param args - Parsed command arguments for the plugin-instance command.
 */
export async function builtin_plugininstance(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (!subcommand || subcommand === 'list') {
    try {
      const { pluginInstances, selectedFields, totalCount }: PluginInstanceListResult = await pluginInstances_fetchList(parsed as unknown as CLIoptions);
      if (pluginInstances.length === 0) { return envelope_ok(`${chalk.gray('No plugin instances found.')}\n`); }
      return envelope_ok(table_render(pluginInstances, selectedFields, { title: { title: 'Plugin Instances', justification: 'center' }, pagination: totalCount !== undefined ? { shown: pluginInstances.length, total: totalCount } : undefined }));
    } catch (e: unknown) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`plugininstance error: ${e instanceof Error ? e.message : String(e)}`)}\n`);
    }
  }

  if (subcommand === 'search') {
    const query: string = parsed._[1] ?? '';
    return builtin_plugininstance([...args.filter((a: string) => a !== subcommand), `--search`, query]);
  }

  if (subcommand === 'inspect') {
    const fields: string[] | null = await pluginInstanceFields_fetch();
    if (fields && fields.length > 0) {
      return envelope_ok(table_render(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Plugin Instance fields', justification: 'center' } }));
    }
    return envelope_ok(`${chalk.gray('No fields found for plugin instances.')}\n`);
  }

  process.exitCode = 1;
  return envelope_error(`${chalk.red(`Unknown subcommand: ${subcommand}. Usage: plugininstances <list|search|inspect>`)}\n`);
}
