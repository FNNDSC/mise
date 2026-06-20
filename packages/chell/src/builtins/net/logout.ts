/**
 * @file Builtin logout command.
 * Disconnects from ChRIS.
 */
import chalk from 'chalk';
import { connect_logout } from '@fnndsc/chili/commands/connect/logout.js';
import { logout_render } from '@fnndsc/chili/views/connect.js';

/**
 * Logs out from the current ChRIS CUBE session.
 *
 * @returns A Promise that resolves when the logout operation is complete.
 */
export async function builtin_logout(): Promise<void> {
  try {
    await connect_logout();
    console.log(logout_render(true));
  } catch (error: unknown) {
    console.log(logout_render(false));
    const msg: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Logout failed: ${msg}`));
  }
}
