/**
 * @file Builtin group command.
 *
 * Subcommands: list, search, inspect
 * [admin]: create, delete, adduser, removeuser
 * Singular/plural aliases: group / groups
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { groups_fetchList, GroupListResult } from '@fnndsc/chili/commands/groups/list.js';
import { groupFields_fetch } from '@fnndsc/chili/commands/groups/fields.js';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

/**
 * Builtin handler for the `group` command.
 *
 * @param args - Parsed command arguments for the group command.
 * @returns An envelope carrying the group listing or fields.
 */
export async function builtin_group(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (!subcommand || subcommand === 'list') {
    try {
      const { groups, selectedFields, totalCount }: GroupListResult = await groups_fetchList(parsed as unknown as CLIoptions);
      if (groups.length === 0) { return envelope_ok(`${chalk.gray('No groups found.')}\n`); }
      return envelope_ok(table_render(groups, selectedFields, { title: { title: 'Groups', justification: 'center' }, pagination: totalCount !== undefined ? { shown: groups.length, total: totalCount } : undefined }));
    } catch (e: unknown) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`group error: ${e instanceof Error ? e.message : String(e)}`)}\n`);
    }
  }

  if (subcommand === 'search') {
    const query: string = parsed._[1] ?? '';
    return builtin_group([...args.filter((a: string) => a !== subcommand), `--search`, query]);
  }

  if (subcommand === 'inspect') {
    const fields: string[] | null = await groupFields_fetch();
    if (fields && fields.length > 0) {
      return envelope_ok(table_render(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Group fields', justification: 'center' } }));
    }
    return envelope_ok(`${chalk.gray('No fields found for groups.')}\n`);
  }

  process.exitCode = 1;
  return envelope_error(`${chalk.red(`Unknown subcommand: ${subcommand}. Usage: groups <list|search|inspect>`)}\n`);
}
