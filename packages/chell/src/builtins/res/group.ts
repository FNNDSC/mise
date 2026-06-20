/**
 * @file Builtin group command.
 *
 * Subcommands: list, search, inspect
 * [admin]: create, delete, adduser, removeuser
 * Singular/plural aliases: group / groups
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { groups_fetchList, GroupListResult } from '@fnndsc/chili/commands/groups/list.js';
import { groupFields_fetch } from '@fnndsc/chili/commands/groups/fields.js';
import { table_display } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

/**
 * Builtin handler for the `group` command.
 *
 * @param args - Parsed command arguments for the group command.
 */
export async function builtin_group(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (!subcommand || subcommand === 'list') {
    try {
      const { groups, selectedFields, totalCount }: GroupListResult = await groups_fetchList(parsed as unknown as CLIoptions);
      if (groups.length === 0) { console.log(chalk.gray('No groups found.')); return; }
      table_display(groups, selectedFields, { title: { title: 'Groups', justification: 'center' }, pagination: totalCount !== undefined ? { shown: groups.length, total: totalCount } : undefined });
    } catch (e: unknown) {
      process.exitCode = 1;
      console.error(chalk.red(`group error: ${e instanceof Error ? e.message : String(e)}`));
    }
    return;
  }

  if (subcommand === 'search') {
    const query: string = parsed._[1] ?? '';
    await builtin_group([...args.filter((a: string) => a !== subcommand), `--search`, query]);
    return;
  }

  if (subcommand === 'inspect') {
    const fields: string[] | null = await groupFields_fetch();
    if (fields && fields.length > 0) {
      table_display(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Group fields', justification: 'center' } });
    } else {
      console.log(chalk.gray('No fields found for groups.'));
    }
    return;
  }

  process.exitCode = 1;
  console.log(chalk.red(`Unknown subcommand: ${subcommand}. Usage: groups <list|search|inspect>`));
}
