/**
 * @file Powerlevel10k-inspired prompt theme.
 *
 * Two-line prompt:
 *   Line 1 — coloured segment bar: 🌐 host  👤 user  📂 dir  [🏥 pacs]  [🔬 PHYSICAL]
 *   Line 2 — input line: ❯
 *
 * readline uses only the last line's visible width for cursor and
 * tab-completion alignment, so the segment bar on line 1 never
 * interferes with line editing.
 *
 * @module
 */

import chalk from 'chalk';
import type { PromptContext, PromptTheme } from './index.js';

/** Visible separator between segments. */
const SEP: string = '  ';

/**
 * Strips the scheme and trailing `/api/v1/` from a CUBE URL, leaving
 * just `host:port`.
 *
 * @param uri - Full CUBE API URL string.
 * @returns Abbreviated host[:port] string.
 */
function uri_abbreviate(uri: string): string {
  return uri
    .replace(/^https?:\/\//, '')
    .replace(/\/api\/v1\/?$/, '');
}

/**
 * Returns the last path segment (leaf directory name).
 *
 * @param cwd - Current working directory path.
 * @returns Leaf segment, or '/' if at root.
 */
function path_leafGet(cwd: string): string {
  if (cwd === '/' || cwd === '') return '/';
  const segments: string[] = cwd.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '/';
}

/**
 * Powerlevel10k-inspired two-line prompt theme.
 */
export class ThemeP10k implements PromptTheme {
  render(ctx: PromptContext): string {
    const host: string = uri_abbreviate(ctx.uri);
    const leaf: string = path_leafGet(ctx.cwd);

    const segments: string[] = [
      chalk.cyan(`🌐 ${host}`),
      chalk.green(`👤 ${ctx.user}`),
      chalk.yellow(`📂 ${leaf}`),
    ];

    if (ctx.pacsserver) {
      segments.push(chalk.magenta(`🏥 ${ctx.pacsserver}`));
    }

    if (ctx.physicalMode) {
      segments.push(chalk.magenta('🔬 PHYSICAL'));
    }

    const line1: string = segments.join(SEP);
    const line2: string = chalk.green('❯') + ' ';
    return `${line1}\n${line2}`;
  }
}
