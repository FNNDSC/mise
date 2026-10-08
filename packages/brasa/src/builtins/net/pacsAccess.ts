/**
 * @file Whether CUBE refused a PACS request, and what to tell the operator.
 *
 * CUBE serves its PACS endpoints only to members of its `pacs_users`
 * group; anyone else gets "You do not have permission to perform this
 * action." That refusal used to read as an empty server list (`pacs list`:
 * "No PACS servers registered in CUBE.") or as two raw stack lines from a
 * query, and neither said what to do about it.
 *
 * @module
 */
import chalk from 'chalk';

/** CUBE's words for a request this account may not make, and the HTTP codes that carry them. */
const REFUSAL: RegExp = /do not have permission|permission denied|\b403\b|forbidden/i;

/**
 * Whether any of the messages is CUBE refusing the request for want of permission.
 *
 * @param messages - The failure messages a command collected.
 * @returns True when at least one is a permission refusal.
 */
export function pacsRefusal_is(messages: ReadonlyArray<string>): boolean {
  return messages.some((message: string): boolean => REFUSAL.test(message));
}

/**
 * What the operator reads when CUBE refused PACS access: who decides, and
 * where the grant is made.
 *
 * @returns The hint, two lines, ending in a newline.
 */
export function pacsRefusal_hint(): string {
  return `${chalk.yellow('CUBE refused PACS access for this account: PACS needs membership in the CUBE group pacs_users.')}\n`
    + `${chalk.gray('Ask a ChRIS administrator to grant it. Where CUBE takes its groups from a directory (Authentik, LDAP), the grant is made there: a membership added in CUBE alone is undone at the next login.')}\n`;
}
