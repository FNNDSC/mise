/**
 * @file Builtin pluginmeta command.
 *
 * Subcommands: list, search, inspect
 * Aliases: pluginmeta / pluginmetas / meta / metas
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { pluginMetas_fetchList, PluginMetaListResult } from '@fnndsc/chili/commands/pluginmetas/list.js';
import { pluginMetaFields_fetch } from '@fnndsc/chili/commands/pluginmetas/fields.js';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

/**
 * Builtin handler for the `pluginmeta` command.
 *
 * @param args - Parsed command arguments for the plugin-meta command.
 */
export async function builtin_pluginmeta(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (!subcommand || subcommand === 'list') {
    try {
      const { pluginMetas, selectedFields, totalCount }: PluginMetaListResult = await pluginMetas_fetchList(parsed as unknown as CLIoptions);
      if (pluginMetas.length === 0) { return envelope_ok(`${chalk.gray('No plugin metas found.')}\n`); }
      return envelope_ok(table_render(pluginMetas, selectedFields, { title: { title: 'Plugin Metas', justification: 'center' }, pagination: totalCount !== undefined ? { shown: pluginMetas.length, total: totalCount } : undefined }));
    } catch (e: unknown) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`pluginmeta error: ${e instanceof Error ? e.message : String(e)}`)}\n`);
    }
  }

  if (subcommand === 'search') {
    const query: string = parsed._[1] ?? '';
    return builtin_pluginmeta([...args.filter((a: string) => a !== subcommand), `--search`, query]);
  }

  if (subcommand === 'inspect') {
    const fields: string[] | null = await pluginMetaFields_fetch();
    if (fields && fields.length > 0) {
      return envelope_ok(table_render(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Plugin Meta fields', justification: 'center' } }));
    }
    return envelope_ok(`${chalk.gray('No fields found for plugin metas.')}\n`);
  }

  process.exitCode = 1;
  return envelope_error(`${chalk.red(`Unknown subcommand: ${subcommand}. Usage: pluginmetas <list|search|inspect>`)}\n`);
}
