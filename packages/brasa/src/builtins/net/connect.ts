/**
 * @file Builtin connect command.
 * Establishes a connection to ChRIS.
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { connect_login } from '@fnndsc/chili/commands/connect/login.js';
import { login_render } from '@fnndsc/chili/views/connect.js';
import { session } from '../../session/index.js';
import { chrisContext, type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';

/**
 * Connects to a ChRIS CUBE instance using provided credentials.
 *
 * @param args - An array of arguments containing user, password, and URL.
 * @returns An envelope carrying the login result.
 */
export async function builtin_connect(args: string[]): Promise<CommandEnvelope> {
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
      return envelope_ok(`${login_render(success, url, user)}\n`);
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      process.exitCode = 1;
      return envelope_error(`${login_render(false, url, user)}\n`, undefined, `${chalk.red(`Connection failed: ${msg}`)}\n`);
    }
  }
  return envelope_ok(`${chalk.red('Usage: connect --user <username> --password <password> <url>')}\n`);
}
