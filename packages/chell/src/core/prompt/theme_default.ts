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
import { procPromptState_get, type ProcPromptState } from '@fnndsc/cumin/proc-prompt';
import type { PromptContext, PromptTheme } from './index.js';
import { PROMPT_PALETTE, statusColor_get, type HexColor } from './palette.js';
import {
  ansi_visibleLength,
  homePath_abbreviate,
  path_truncate,
  procProgress_format,
} from './utils.js';

/** Fraction of terminal width allowed before path truncation kicks in. */
const FILL_RATIO: number = 0.8;

/** Human-readable prompt label for each process-index state. */
const PROC_STATE_LABELS: Record<ProcPromptState, string> = {
  cold: 'cold',
  cached: 'cached, refreshing',
  failed: 'failed',
};

/**
 * Default single-line prompt theme with smart path truncation.
 */
export class ThemeDefault implements PromptTheme {
  render(ctx: PromptContext): string {
    const limit: number = Math.floor(ctx.terminalWidth * FILL_RATIO);
    const modePrefix: string = ctx.physicalMode
      ? chalk.hex(PROMPT_PALETTE.PHYSICAL.bg)('[PHYSICAL] ')
      : '';

    // Compute fixed visible length: modePrefix + user + '@' + uri + ':' + '$ '
    const fixedVisible: number =
      ansi_visibleLength(modePrefix) +
      ctx.user.length +
      1 + // '@'
      ctx.uri.length +
      1 + // ':'
      2;  // '$ '

    const pathBudget: number = limit - fixedVisible;
    const displayPath: string = homePath_abbreviate(ctx.cwd, ctx.user);
    const path: string = path_truncate(displayPath, pathBudget);

    const glyphColor: HexColor = statusColor_get(ctx.lastExitCode);
    const glyph: string = chalk.hex(glyphColor)('$ ');
    let warmup: string = '';
    if (ctx.procWarmup) {
      const state: ProcPromptState = procPromptState_get(ctx.procWarmup);
      const color: HexColor = state === 'failed'
        ? PROMPT_PALETTE.ERROR
        : PROMPT_PALETTE.WARMUP;
      warmup = chalk.hex(color)(
        ` [proc ${PROC_STATE_LABELS[state]}: ${procProgress_format(ctx.procWarmup.loaded, ctx.procWarmup.total ?? 0)}]`,
      );
    }
    return (
      modePrefix +
      chalk.hex(PROMPT_PALETTE.USER.bg)(ctx.user) +
      '@' +
      chalk.hex(PROMPT_PALETTE.HOST.bg)(ctx.uri) +
      ':' +
      chalk.hex(PROMPT_PALETTE.DIR.bg)(path) +
      warmup +
      glyph
    );
  }
}
