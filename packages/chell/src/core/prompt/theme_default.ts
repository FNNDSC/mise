/**
 * @file Default prompt theme.
 *
 * Single-line prompt that fits within 80% of the terminal width.
 * When the path causes overflow the oldest ancestors are dropped and
 * replaced with `...`; if even the leaf alone is too long it is
 * front-truncated to fit.
 *
 * Format: [PHYSICAL] user@uri:path$
 *
 * @module
 */

import chalk from 'chalk';
import type { PromptContext, PromptTheme } from './index.js';

/** Fraction of terminal width allowed before path truncation kicks in. */
const FILL_RATIO: number = 0.8;

/**
 * Returns the visible (non-ANSI) length of a string.
 *
 * @param s - String possibly containing ANSI escape codes.
 * @returns Number of visible columns.
 */
function ansi_visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * Truncates a filesystem path to fit within `maxLen` visible columns.
 *
 * Drops leading path segments (oldest ancestors) replacing them with
 * `...`, then — if the leaf alone still exceeds the budget — truncates
 * the leaf itself from the front.
 *
 * @param path - Absolute or relative path string.
 * @param maxLen - Maximum number of visible columns allowed.
 * @returns Truncated path string (no ANSI codes).
 */
function path_truncate(path: string, maxLen: number): string {
  if (maxLen <= 0) return '...';
  if (path.length <= maxLen) return path;

  const segments: string[] = path.split('/').filter(Boolean);

  // Drop ancestors from the front until it fits
  for (let drop: number = 1; drop < segments.length; drop++) {
    const candidate: string = '.../' + segments.slice(drop).join('/');
    if (candidate.length <= maxLen) return candidate;
  }

  // Even the leaf alone won't fit — front-truncate it
  const leaf: string = segments[segments.length - 1] ?? path;
  const budget: number = maxLen - 3; // reserve 3 chars for '...'
  return '...' + leaf.slice(-Math.max(budget, 0));
}

/**
 * Default single-line prompt theme with smart path truncation.
 */
export class ThemeDefault implements PromptTheme {
  render(ctx: PromptContext): string {
    const limit: number = Math.floor(ctx.terminalWidth * FILL_RATIO);
    const modePrefix: string = ctx.physicalMode ? chalk.magenta('[PHYSICAL] ') : '';

    // Compute fixed visible length: modePrefix + user + '@' + uri + ':' + '$ '
    const fixedVisible: number =
      ansi_visibleLength(modePrefix) +
      ctx.user.length +
      1 + // '@'
      ctx.uri.length +
      1 + // ':'
      2;  // '$ '

    const pathBudget: number = limit - fixedVisible;
    const path: string = path_truncate(ctx.cwd, pathBudget);

    return (
      modePrefix +
      chalk.green(ctx.user) +
      '@' +
      chalk.cyan(ctx.uri) +
      ':' +
      chalk.yellow(path) +
      '$ '
    );
  }
}
