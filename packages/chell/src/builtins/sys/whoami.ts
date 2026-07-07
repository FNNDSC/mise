/**
 * @file Builtins whoami and whereami.
 * Quick single-line identity queries, reported as command envelopes.
 */
import chalk from 'chalk';
import { context_getSingle } from '@fnndsc/salsa';
import { SingleContext, CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';

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
