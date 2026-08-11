/**
 * @file Builtin group command.
 *
 * Subcommands: list, search, inspect, members, adduser, removeuser
 * [admin]: create, delete, adduser, removeuser
 * Singular/plural aliases: group / groups
 */
import chalk from 'chalk';
import {
  CommandEnvelope,
  envelope_ok,
  envelope_error,
} from '@fnndsc/cumin';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { groups_fetchList, GroupListResult } from '@fnndsc/chili/commands/groups/list.js';
import { groupFields_fetch } from '@fnndsc/chili/commands/groups/fields.js';
import {
  groupMembers_fetch,
  groupUser_add,
  groupUser_remove,
  GroupMember,
  GroupMembershipResult,
} from '@fnndsc/chili/commands/groups/membership.js';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

/**
 * Parses a numeric group operand.
 *
 * @param raw - Raw group ID argument.
 * @returns The numeric group ID, or null when command usage is invalid.
 */
function groupID_parse(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Renders an error for a failed group membership operation.
 *
 * @param message - User-facing error or usage detail.
 * @returns An error command envelope.
 */
function groupMembership_error(message: string): CommandEnvelope {
  process.exitCode = 1;
  return envelope_error('', undefined, `${chalk.red(message)}\n`);
}

/**
 * Builtin handler for the `group` command.
 *
 * @param args - Parsed command arguments for the group command.
 * @returns An envelope carrying a group listing, membership result, or usage error.
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
    const search: string = query.includes(':') ? query : `name_icontains:${query}`;
    return builtin_group(['--search', search]);
  }

  if (subcommand === 'inspect') {
    const fields: string[] | null = await groupFields_fetch();
    if (fields && fields.length > 0) {
      return envelope_ok(table_render(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Group fields', justification: 'center' } }));
    }
    return envelope_ok(`${chalk.gray('No fields found for groups.')}\n`);
  }

  if (subcommand === 'members') {
    const groupID: number | null = groupID_parse(parsed._[1]);
    if (groupID === null) return groupMembership_error('Usage: group members <id>');
    const result: GroupMembershipResult<GroupMember[]> = await groupMembers_fetch(groupID);
    if (!result.ok) return groupMembership_error(result.error);
    if (result.value.length === 0) {
      return envelope_ok(`${chalk.gray(`Group ${groupID} has no users.`)}\n`);
    }
    const rows: Record<string, unknown>[] = result.value.map(
      (member: GroupMember): Record<string, unknown> => ({
        id: member.id,
        username: member.username,
      }),
    );
    return envelope_ok(table_render(
      rows,
      ['id', 'username'],
      { title: { title: `Group ${groupID} users`, justification: 'center' } },
    ));
  }

  if (subcommand === 'adduser' || subcommand === 'removeuser') {
    const groupID: number | null = groupID_parse(parsed._[1]);
    const username: string | undefined = parsed._[2];
    if (groupID === null || username === undefined || username.length === 0) {
      return groupMembership_error(`Usage: group ${subcommand} <id> <username>`);
    }
    if (subcommand === 'adduser') {
      const result: GroupMembershipResult<GroupMember> = await groupUser_add(groupID, username);
      if (!result.ok) return groupMembership_error(result.error);
      return envelope_ok(`${chalk.green(`Added ${result.value.username} to group ${groupID}.`)}\n`);
    }
    const result: GroupMembershipResult<boolean> = await groupUser_remove(groupID, username);
    if (!result.ok) return groupMembership_error(result.error);
    return envelope_ok(`${chalk.green(`Removed ${username} from group ${groupID}.`)}\n`);
  }

  process.exitCode = 1;
  return envelope_error(`${chalk.red(`Unknown subcommand: ${subcommand}. Usage: groups <list|search|inspect|members|adduser|removeuser>`)}\n`);
}
