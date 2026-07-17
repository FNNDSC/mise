/**
 * @file Builtins id, whoami, and whereami.
 * Quick single-line identity queries, reported as command envelopes.
 */
import chalk from 'chalk';
import { context_getSingle } from '@fnndsc/salsa';
import {
  currentIdentity_get,
  envelope_error,
  envelope_ok,
  type ChrisGroup,
  type ChrisIdentity,
  type CommandEnvelope,
  type Result,
  type SingleContext,
} from '@fnndsc/cumin';

/** A Unix-style group entry projected from CUBE identity data. */
interface PosixGroupIdentity {
  gid: number;
  group: string;
}

/**
 * Reports the current ChRIS identity using Unix `id` notation.
 *
 * CUBE exposes a numeric user ID but no primary-group field. ChELL therefore
 * uses the same POSIX projection as `/etc/passwd`: the primary GID and group
 * name equal the user's ID and username.
 *
 * @param _args - Unused.
 * @returns An envelope carrying numeric UID/GID identity and every CUBE group
 *   membership, or an error envelope when identity cannot be resolved.
 */
export async function builtin_id(_args: string[]): Promise<CommandEnvelope> {
  const result: Result<ChrisIdentity> = await currentIdentity_get();
  if (!result.ok) {
    process.exitCode = 1;
    return envelope_error(`${chalk.gray('(identity unavailable)')}\n`);
  }

  const identity: ChrisIdentity = result.value;
  const primaryGroup: PosixGroupIdentity = {
    gid: identity.user.id,
    group: identity.user.username,
  };
  const memberships: PosixGroupIdentity[] = identity.groups
    .map((membership: ChrisGroup): PosixGroupIdentity => ({
      gid: membership.id,
      group: membership.name,
    }))
    .filter((membership: PosixGroupIdentity): boolean =>
      membership.gid !== primaryGroup.gid || membership.group !== primaryGroup.group)
    .sort((left: PosixGroupIdentity, right: PosixGroupIdentity): number =>
      left.gid - right.gid || left.group.localeCompare(right.group));
  const groups: PosixGroupIdentity[] = [primaryGroup, ...memberships];
  const renderedGroups: string = groups
    .map((membership: PosixGroupIdentity): string => `${membership.gid}(${membership.group})`)
    .join(',');

  return envelope_ok(
    `uid=${identity.user.id}(${identity.user.username}) `
      + `gid=${primaryGroup.gid}(${primaryGroup.group}) groups=${renderedGroups}\n`,
    {
      kind: 'session.posixIdentity',
      data: {
        uid: identity.user.id,
        user: identity.user.username,
        gid: primaryGroup.gid,
        group: primaryGroup.group,
        groups,
      },
    },
  );
}

/**
 * Reports the current authenticated ChRIS username.
 *
 * @param _args - Unused.
 * @returns An envelope carrying the username, or an error envelope with a
 *   not-connected notice when no user is authenticated.
 */
export async function builtin_whoami(_args: string[]): Promise<CommandEnvelope> {
  const context: SingleContext = await context_getSingle();
  if (context.user) {
    return envelope_ok(`${chalk.cyan(context.user)}\n`, {
      kind: 'session.identity',
      data: { user: context.user },
    });
  }
  process.exitCode = 1;
  return envelope_error(`${chalk.gray('(not connected)')}\n`);
}

/**
 * Reports the current CUBE URI.
 *
 * @param _args - Unused.
 * @returns An envelope carrying the CUBE URL, or an error envelope with a
 *   not-connected notice when no connection exists.
 */
export async function builtin_whereami(_args: string[]): Promise<CommandEnvelope> {
  const context: SingleContext = await context_getSingle();
  if (context.URL) {
    return envelope_ok(`${chalk.blue(context.URL)}\n`, {
      kind: 'session.cube',
      data: { url: context.URL },
    });
  }
  process.exitCode = 1;
  return envelope_error(`${chalk.gray('(not connected)')}\n`);
}
