/**
 * @file Builtin connect command.
 * Establishes a connection to ChRIS.
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { connect_login } from '@fnndsc/chili/commands/connect/login.js';
import { login_render } from '@fnndsc/chili/views/connect.js';
import { session } from '../../session/index.js';
import { chrisContext } from '@fnndsc/cumin';

/**
 * Connects to a ChRIS CUBE instance using provided credentials.
 *
 * @param args - An array of arguments containing user, password, and URL.
 * @returns A Promise that resolves when the connection attempt is complete.
 */
export async function builtin_connect(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const user: string = parsed.user as string;
  const password: string = parsed.password as string;
  const url: string = parsed._[0] as string;

  if (user && password && url) {
    try {
      const success: boolean = await connect_login({ user, password, url, debug: false });
      if (success) {
        session.offline = false;
        // Refresh context to update prompt with new user/url
        await chrisContext.currentContext_update();
      }
      console.log(login_render(success, url, user));
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      console.log(login_render(false, url, user));
      console.error(chalk.red(`Connection failed: ${msg}`));
    }
  } else {
    console.log(chalk.red('Usage: connect --user <username> --password <password> <url>'));
  }
}
