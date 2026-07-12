/**
 * @file Builtin logout command.
 * Disconnects from ChRIS.
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok } from '@fnndsc/cumin';
import { connect_logout } from '@fnndsc/chili/commands/connect/logout.js';
import { logout_render } from '@fnndsc/chili/views/connect.js';

/**
 * Logs out from the current ChRIS CUBE session.
 *
 * @returns An envelope carrying the logout notice; on failure the data channel
 *   still reports the logout and the error channel carries the reason.
 */
export async function builtin_logout(): Promise<CommandEnvelope> {
  try {
    await connect_logout();
    return envelope_ok(`${logout_render(true)}\n`);
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    const envelope: CommandEnvelope = envelope_ok(`${logout_render(false)}\n`);
    envelope.renderedErr = `${chalk.red(`Logout failed: ${msg}`)}\n`;
    return envelope;
  }
}
