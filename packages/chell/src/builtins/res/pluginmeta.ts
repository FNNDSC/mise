/**
 * @file Builtin pluginmeta command.
 *
 * Subcommands: list, search, inspect
 * Aliases: pluginmeta / pluginmetas / meta / metas
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { pluginMetas_fetchList, PluginMetaListResult } from '@fnndsc/chili/commands/pluginmetas/list.js';
import { pluginMetaFields_fetch } from '@fnndsc/chili/commands/pluginmetas/fields.js';
import { table_display } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

export async function builtin_pluginmeta(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (!subcommand || subcommand === 'list') {
    try {
      const { pluginMetas, selectedFields }: PluginMetaListResult = await pluginMetas_fetchList(parsed as unknown as CLIoptions);
      if (pluginMetas.length === 0) { console.log(chalk.gray('No plugin metas found.')); return; }
      table_display(pluginMetas, selectedFields, { title: { title: 'Plugin Metas', justification: 'center' } });
    } catch (e: unknown) {
      process.exitCode = 1;
      console.error(chalk.red(`pluginmeta error: ${e instanceof Error ? e.message : String(e)}`));
    }
    return;
  }

  if (subcommand === 'search') {
    const query: string = parsed._[1] ?? '';
    await builtin_pluginmeta([...args.filter((a: string) => a !== subcommand), `--search`, query]);
    return;
  }

  if (subcommand === 'inspect') {
    const fields: string[] | null = await pluginMetaFields_fetch();
    if (fields && fields.length > 0) {
      table_display(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Plugin Meta fields', justification: 'center' } });
    } else {
      console.log(chalk.gray('No fields found for plugin metas.'));
    }
    return;
  }

  process.exitCode = 1;
  console.log(chalk.red(`Unknown subcommand: ${subcommand}. Usage: pluginmetas <list|search|inspect>`));
}
