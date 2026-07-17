/**
 * @file Powerlevel10k-inspired prompt theme.
 *
 * Two-line prompt:
 *   Line 1 — coloured segment bar with background fills and powerline separators
 *             🌐 host ❯ [🗄️ pacs ❯] 👤 user ❯ 📂 path ❯ [⏱ HH:MM ❯] [⚡ Xs ❯] [✖ N ❯]
 *   Line 2 — input line: ❯
 *
 * Powerline separator (U+E0B0) requires a Nerd Font in the terminal.
 * readline uses only the last line's visible width for cursor and
 * tab-completion alignment, so line 1 never interferes with line editing.
 *
 * @module
 */

import chalk from 'chalk';
import type { PromptContext, PromptTheme } from './index.js';
import {
  PROMPT_PALETTE,
  statusColor_get,
  type HexColor,
  type PromptColorPair,
} from './palette.js';
import {
  ansi_visibleLength,
  homePath_abbreviate,
  path_truncate,
  procProgress_format,
} from './utils.js';

/** Powerline right-arrow separator (Nerd Font U+E0B0). */
const POWERLINE: string = '';

/** Fraction of terminal width the segment bar should not exceed. */
const FILL_RATIO: number = 0.95;

/** Minimum command duration (ms) before the duration segment appears. */
const DURATION_THRESHOLD_MS: number = 3_000;

/** Visible content and colour pair for one rendered prompt segment. */
interface SegmentSpec {
  text: string;
  color: PromptColorPair;
}

/**
 * Renders one segment: padded text on its background colour.
 *
 * @param text - Visible text content (may include emoji).
 * @param c - Background/foreground hex pair.
 * @returns ANSI-coded segment string.
 */
function segment_render(text: string, c: PromptColorPair): string {
  return chalk.hex(c.fg).bgHex(c.bg)(` ${text} `);
}

/**
 * Renders the powerline separator transitioning from one segment bg to the next.
 *
 * @param from - Colour pair of the departing segment.
 * @param to - Colour pair of the arriving segment.
 * @returns ANSI-coded separator character.
 */
function separator_render(from: PromptColorPair, to: PromptColorPair): string {
  return chalk.hex(from.bg).bgHex(to.bg)(POWERLINE);
}

/**
 * Renders the final powerline separator: segment bg fading to terminal default.
 *
 * @param from - Colour pair of the last segment.
 * @returns ANSI-coded trailing separator character.
 */
function separator_final(from: PromptColorPair): string {
  return chalk.hex(from.bg)(POWERLINE);
}

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
 * Formats a duration in milliseconds as a human-readable string.
 * Examples: "2s", "1m 5s"
 *
 * @param ms - Duration in milliseconds.
 * @returns Formatted duration string.
 */
function duration_format(ms: number): string {
  const totalSeconds: number = Math.floor(ms / 1000);
  const minutes: number = Math.floor(totalSeconds / 60);
  const seconds: number = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${totalSeconds}s`;
}

/**
 * Returns the current time as HH:MM (24-hour).
 *
 * @returns Time string in HH:MM format.
 */
function time_now(): string {
  const now: Date = new Date();
  const hh: string = String(now.getHours()).padStart(2, '0');
  const mm: string = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Powerlevel10k-inspired two-line prompt theme with background-coloured segments.
 * Segment order: host [pacs] [physical] user dir [time] [duration] [status]
 */
export class ThemeP10k implements PromptTheme {
  render(ctx: PromptContext): string {
    const host: string = uri_abbreviate(ctx.uri);

    // Left segments: host → [pacs] → [physical] → user
    const fixed: SegmentSpec[] = [
      { text: `🌐 ${host}`, color: PROMPT_PALETTE.HOST },
    ];

    if (ctx.pacsserver && ctx.p10kSegments.pacs) {
      fixed.push({ text: `🗄️ ${ctx.pacsserver}`, color: PROMPT_PALETTE.PACS });
    }

    if (ctx.physicalMode) {
      fixed.push({ text: '🔬 PHYSICAL', color: PROMPT_PALETTE.PHYSICAL });
    }

    fixed.push({ text: `👤 ${ctx.user}`, color: PROMPT_PALETTE.USER });

    // Optional trailing segments (after dir)
    const trailing: SegmentSpec[] = [];

    if (ctx.p10kSegments.time) {
      trailing.push({ text: `⏱ ${time_now()}`, color: PROMPT_PALETTE.TIME });
    }

    if (ctx.p10kSegments.duration && ctx.lastCommandDurationMs >= DURATION_THRESHOLD_MS) {
      trailing.push({
        text: `⚡ ${duration_format(ctx.lastCommandDurationMs)}`,
        color: PROMPT_PALETTE.DURATION,
      });
    }

    if (ctx.p10kSegments.status && ctx.lastExitCode !== 0) {
      trailing.push({ text: `✖ ${ctx.lastExitCode}`, color: PROMPT_PALETTE.STATUS });
    }

    if (ctx.procWarmup) {
      const restored: string = ctx.procWarmup.restored ? 'cached, syncing ' : '';
      trailing.push({
        text: `⚙ proc: ${restored}${procProgress_format(ctx.procWarmup.loaded, ctx.procWarmup.total ?? 0)}`,
        color: PROMPT_PALETTE.TIME,
      });
    }

    // Compute path budget: terminal limit minus fixed + trailing segment overhead + dir overhead
    const limit: number = Math.floor(ctx.terminalWidth * FILL_RATIO);

    const fixedRendered: string = fixed
      .map((segment: SegmentSpec) => segment_render(segment.text, segment.color))
      .join('');
    const trailingRendered: string = trailing
      .map((segment: SegmentSpec) => segment_render(segment.text, segment.color))
      .join('');
    const fixedOverhead: number = ansi_visibleLength(fixedRendered) + fixed.length;
    const trailingOverhead: number = ansi_visibleLength(trailingRendered) + trailing.length;
    // dir: +2 padding, +1 sep before, +1 final sep (or sep to first trailing)
    const dirOverhead: number = 4;
    const pathBudget: number = limit - fixedOverhead - trailingOverhead - dirOverhead;
    const displayPath: string = homePath_abbreviate(ctx.cwd, ctx.user);
    const dirPath: string = path_truncate(displayPath, Math.max(pathBudget, 4));

    const defs: SegmentSpec[] = [
      ...fixed,
      { text: `📂 ${dirPath}`, color: PROMPT_PALETTE.DIR },
      ...trailing,
    ];

    let line1: string = '';
    for (let i: number = 0; i < defs.length; i++) {
      const def: SegmentSpec = defs[i];
      line1 += segment_render(def.text, def.color);
      if (i < defs.length - 1) {
        line1 += separator_render(def.color, defs[i + 1].color);
      } else {
        line1 += separator_final(def.color);
      }
    }

    const glyphColor: HexColor = statusColor_get(ctx.lastExitCode);
    const line2: string = chalk.hex(glyphColor)('❯') + ' ';
    return `${line1}\n${line2}`;
  }
}
