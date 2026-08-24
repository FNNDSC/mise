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
import { commandArgs_process, ParsedArgs, cliOptions_from } from '../utils.js';
import { groups_fetchList, GroupListResult } from '@fnndsc/chili/commands/groups/list.js';
import { groupFields_fetch } from '@fnndsc/chili/commands/groups/fields.js';
import {
  groupMembers_fetch,
  groupReference_resolve,
  GroupReference,
  groupUser_add,
  groupUser_remove,
  GroupMember,
  GroupMembershipResult,
} from '@fnndsc/chili/commands/groups/membership.js';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import { authorizationFailure_is, sudoHint_build } from '../../core/elevation.js';

/**
 * Renders an error for a failed group membership operation.
 *
 * @param message - User-facing error or usage detail.
 * @returns An error command envelope.
 */
function group_error(message: string): CommandEnvelope {
  process.exitCode = 1;
  return envelope_error('', undefined, `${chalk.red(message)}\n`);
}

/**
 * Renders the human-readable name and stable numeric ID of one group.
 *
 * @param group - Resolved CUBE group identity.
 * @returns Operator-facing group label.
 */
function group_label(group: GroupReference): string {
  return `${group.name} (${group.id})`;
}

/**
 * Applies one membership operation to every named user and renders its outcome.
 *
 * Current membership is read once so adding an existing member or removing a
 * non-member is an idempotent no-op. CUBE mutations remain individual requests:
 * all requested users are attempted and a partial batch reports every result.
 *
 * @param group - Resolved target group.
 * @param usernames - Usernames in operator-supplied order.
 * @param operation - Whether this batch adds or removes members.
 * @returns Success envelope, or an error envelope after any failed mutation.
 */
async function groupMembership_batch(
  group: GroupReference,
  usernames: string[],
  operation: 'add' | 'remove',
): Promise<CommandEnvelope> {
  const existing: GroupMembershipResult<GroupMember[]> = await groupMembers_fetch(group.id);
  if (!existing.ok) return group_error(existing.error);

  const members: Set<string> = new Set(existing.value.map(
    (member: GroupMember): string => member.username,
  ));
  let rendered: string = '';
  let renderedErr: string = '';
  let failures: number = 0;
  let elevationHintShown: boolean = false;

  for (const username of usernames) {
    const present: boolean = members.has(username);
    if (operation === 'add' && present) {
      rendered += `${chalk.gray(`${username} is already a member of ${group_label(group)}.`)}\n`;
      continue;
    }
    if (operation === 'remove' && !present) {
      rendered += `${chalk.gray(`${username} was not a member of ${group_label(group)}.`)}\n`;
      continue;
    }

    const result: GroupMembershipResult<GroupMember | boolean> = operation === 'add'
      ? await groupUser_add(group.id, username)
      : await groupUser_remove(group.id, username);
    if (!result.ok) {
      failures += 1;
      renderedErr += `${chalk.red(`Could not ${operation} ${username} ${operation === 'add' ? 'to' : 'from'} ${group_label(group)}: ${result.error}`)}\n`;
      if (!elevationHintShown && authorizationFailure_is(result.error)) {
        renderedErr += sudoHint_build(
          `group ${operation}user`,
          [group.name, ...usernames],
        );
        elevationHintShown = true;
      }
      continue;
    }

    if (operation === 'add') {
      members.add(username);
      rendered += `${chalk.green(`Added ${username} to ${group_label(group)}.`)}\n`;
    } else {
      members.delete(username);
      rendered += `${chalk.green(`Removed ${username} from ${group_label(group)}.`)}\n`;
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return envelope_error(rendered, undefined, renderedErr);
  }
  return envelope_ok(rendered);
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
      const { groups, selectedFields, totalCount }: GroupListResult = await groups_fetchList(cliOptions_from(parsed));
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
    const reference: string | undefined = parsed._[1];
    if (reference !== undefined) {
      const resolved = await groupReference_resolve(reference);
      if (!resolved.ok) return group_error(resolved.error);
      return envelope_ok(table_render(
        [{ id: resolved.value.id, name: resolved.value.name }],
        ['id', 'name'],
        { title: { title: `Group ${group_label(resolved.value)}`, justification: 'center' } },
      ));
    }
    const fields: string[] | null = await groupFields_fetch();
    if (fields && fields.length > 0) {
      return envelope_ok(table_render(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Group fields', justification: 'center' } }));
    }
    return envelope_ok(`${chalk.gray('No fields found for groups.')}\n`);
  }

  if (subcommand === 'members') {
    const reference: string | undefined = parsed._[1];
    if (reference === undefined) return group_error('Usage: group members <group>');
    const resolved = await groupReference_resolve(reference);
    if (!resolved.ok) return group_error(resolved.error);
    const result: GroupMembershipResult<GroupMember[]> = await groupMembers_fetch(resolved.value.id);
    if (!result.ok) return group_error(result.error);
    if (result.value.length === 0) {
      return envelope_ok(`${chalk.gray(`Group ${group_label(resolved.value)} has no users.`)}\n`);
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
      { title: { title: `Group ${group_label(resolved.value)} users`, justification: 'center' } },
    ));
  }

  if (subcommand === 'adduser' || subcommand === 'removeuser') {
    const reference: string | undefined = parsed._[1];
    const usernames: string[] = parsed._.slice(2);
    if (reference === undefined || usernames.length === 0) {
      return group_error(`Usage: group ${subcommand} <group> <username...>`);
    }
    const resolved = await groupReference_resolve(reference);
    if (!resolved.ok) return group_error(resolved.error);
    return groupMembership_batch(resolved.value, usernames, subcommand === 'adduser' ? 'add' : 'remove');
  }

  process.exitCode = 1;
  return envelope_error(`${chalk.red(`Unknown subcommand: ${subcommand}. Usage: groups <list|search|inspect|members|adduser|removeuser>`)}\n`);
}
