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
import { ansi_visibleLength, path_truncate } from './utils.js';

/** Fraction of terminal width allowed before path truncation kicks in. */
const FILL_RATIO: number = 0.8;

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

    const glyph: string = ctx.lastExitCode !== 0 ? chalk.red('$ ') : chalk.green('$ ');
    const warmup: string = ctx.procWarmup
      ? chalk.dim(` [proc: ${ctx.procWarmup.loaded}]`)
      : '';
    return (
      modePrefix +
      chalk.green(ctx.user) +
      '@' +
      chalk.cyan(ctx.uri) +
      ':' +
      chalk.yellow(path) +
      warmup +
      glyph
    );
  }
}
