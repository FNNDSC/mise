/**
 * @file Builtin plugininstance command.
 *
 * Subcommands: list, search, inspect
 * Aliases: plugininstance / plugininstances / instance / instances / job / jobs
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { commandArgs_process, ParsedArgs, cliOptions_from } from '../utils.js';
import { pluginInstances_fetchList, PluginInstanceListResult } from '@fnndsc/chili/commands/plugininstances/list.js';
import { pluginInstanceFields_fetch } from '@fnndsc/chili/commands/plugininstances/fields.js';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import type { PluginInstanceRow } from '../../api/models.js';

/**
 * Projects a listed row onto the wire's instance model: the fields the
 * listing selected, typed; a field the listing did not select is absent.
 *
 * @param row - One table row as chili fetched it.
 * @returns The typed row.
 */
function instanceRow_project(row: Record<string, unknown>): PluginInstanceRow {
  const text = (key: string): string | undefined => (typeof row[key] === 'string' && row[key] !== '' ? String(row[key]) : undefined);
  const numeric = (key: string): number | undefined => {
    const value: unknown = row[key];
    if (value === undefined || value === null || value === '') return undefined;
    const parsed: number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const pluginName: string | undefined = text('plugin_name');
  const pluginVersion: string | undefined = text('plugin_version');
  const feedId: number | undefined = numeric('feed_id');
  const owner: string | undefined = text('owner_username');
  const status: string | undefined = text('status');
  const startedAt: string | undefined = text('start_date');
  return {
    id: numeric('id') ?? 0,
    ...(pluginName !== undefined ? { pluginName } : {}),
    ...(pluginVersion !== undefined ? { pluginVersion } : {}),
    ...(feedId !== undefined ? { feedId } : {}),
    ...(owner !== undefined ? { owner } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
  };
}

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
      const { pluginInstances, selectedFields, totalCount }: PluginInstanceListResult = await pluginInstances_fetchList(cliOptions_from(parsed));
      // The listing is a model as well as a table: the run history a surface
      // reads (a catalogue's RECENT block) rather than scrapes.
      const model = { kind: 'plugininstance.list' as const, data: pluginInstances.map(instanceRow_project) };
      if (pluginInstances.length === 0) { return envelope_ok(`${chalk.gray('No plugin instances found.')}\n`, model); }
      return envelope_ok(table_render(pluginInstances, selectedFields, { title: { title: 'Plugin Instances', justification: 'center' }, pagination: totalCount !== undefined ? { shown: pluginInstances.length, total: totalCount } : undefined }), model);
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
