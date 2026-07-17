/**
 * @file Builtins id, whoami, and whereami.
 * Quick single-line identity queries, reported as command envelopes.
 */
import chalk from 'chalk';
import { context_getSingle } from '@fnndsc/salsa';
import {
  currentUser_get,
  envelope_error,
  envelope_ok,
  type ChrisUser,
  type CommandEnvelope,
  type Result,
  type SingleContext,
} from '@fnndsc/cumin';

/**
 * Reports the current ChRIS identity using Unix `id` notation.
 *
 * CUBE exposes a numeric user ID but no primary-group field. ChELL therefore
 * uses the same POSIX projection as `/etc/passwd`: the primary GID and group
 * name equal the user's ID and username.
 *
 * @param _args - Unused.
 * @returns An envelope carrying numeric UID/GID identity, or an error envelope
 *   when the current CUBE user cannot be resolved.
 */
export async function builtin_id(_args: string[]): Promise<CommandEnvelope> {
  const result: Result<ChrisUser> = await currentUser_get();
  if (!result.ok) {
    process.exitCode = 1;
    return envelope_error(`${chalk.gray('(identity unavailable)')}\n`);
  }

  const user: ChrisUser = result.value;
  return envelope_ok(`uid=${user.id}(${user.username}) gid=${user.id}(${user.username})\n`, {
    kind: 'session.posixIdentity',
    data: {
      uid: user.id,
      user: user.username,
      gid: user.id,
      group: user.username,
    },
  });
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
