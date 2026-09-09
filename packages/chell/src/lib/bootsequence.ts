/**
 * @file Boot-sequence logging and intro-panel rendering for chell startup.
 *
 * @module
 */

import chalk from 'chalk';
import { streamRows_track, stdoutRows_ensure, stdoutRows_current, type RowStream, type StreamRows } from './terminalRows.js';

/**
 * A single labeled boot-info line.
 */
export interface BootInfoItem {
  label: string;
  value: string;
}

/**
 * A three-column boot-info line.
 */
export interface BootInfoItem3 {
  app: string;
  name: string;
  version: string;
}

function text_visibleLength(text: string): number {
  // Strip all ANSI escape sequences robustly to calculate correct visible width
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').length;
}

/**
 * Grouped boot-info panels (header, local, chris).
 */
export interface BootPanels {
  header: BootInfoItem3[];
  local: BootInfoItem[];
  chris: BootInfoItem[];
}

/**
 * Status of a boot step: ok, retry, skip, fail, or pending.
 *
 * `pending` is a step that has started and not finished — warming behind
 * the prompt rather than in front of it.
 */
export type BootStatus = 'ok' | 'retry' | 'skip' | 'fail' | 'pending';

/** One status tag: its bare text and the colour it renders in. */
interface BootStatusTag {
  text: string;
  paint: (value: string) => string;
}

/**
 * The tag rendered in front of every boot row.
 *
 * Kept as a table rather than a switch so the column width below is
 * derived from the tags themselves. A longer status added here widens
 * every row together instead of shunting one label out of line.
 */
const BOOT_STATUS_TAGS: Record<BootStatus, BootStatusTag> = {
  ok: { text: '[ OK ]', paint: chalk.green },
  retry: { text: '[RETRY]', paint: chalk.yellow },
  skip: { text: '[SKIP]', paint: chalk.yellow },
  fail: { text: '[FAIL]', paint: chalk.red },
  pending: { text: '[PENDING]', paint: chalk.cyan },
};

/**
 * Width of the tag column, taken from the widest tag.
 *
 * Without this the label column moved with the status: `[RETRY]` is a
 * character wider than `[ OK ]`, so a retry row's label sat one column
 * right of every other row's.
 */
export const BOOT_TAG_WIDTH: number = Math.max(
  ...Object.values(BOOT_STATUS_TAGS).map((tag: BootStatusTag): number => tag.text.length),
);

/** What the boot readout needs of its terminal. */
export interface BootTerminal extends RowStream {
  isTTY?: boolean;
  rows?: number;
}

/** Where the readout draws, and which other streams scroll the same screen. */
export interface BootLoggerOptions {
  /** The readout's own stream; `process.stdout` by default. */
  terminal?: BootTerminal;
  /**
   * Streams that share the terminal's screen without being the readout's
   * own — `process.stderr` by default — so what they scroll is counted too.
   */
  shared?: RowStream[];
}

/** A row still open on the readout: pending or retrying, awaiting its outcome. */
interface OpenRow {
  /** The rows scrolled before this row was printed. */
  at: number;
  /** The screen rows the row occupied. */
  rows: number;
}

/**
 * Creates a boot logger that renders a titled status box.
 *
 * On a terminal, a step that starts as `[PENDING]` (or falls to `[RETRY]`)
 * is rewritten in place when its outcome lands, the way a boot screen
 * settles a row rather than repeating it beneath. Every write to the screen
 * is counted between the two moments, so the rewrite reaches the right row
 * however much scrolled meanwhile — and gives up, appending instead, when
 * the row has left the screen or the outcome needs more rows than it had.
 * Off a terminal rows only append.
 *
 * @param title - Box title.
 * @param useAscii - Use ASCII (vs unicode) box characters.
 * @param options - The terminal to draw on; the process's own by default.
 * @returns A boot logger exposing status-logging helpers.
 */
export function bootLogger_create(title: string, useAscii: boolean, options: BootLoggerOptions = {}) {
  const terminal: BootTerminal = options.terminal ?? process.stdout;
  const ownsStdout: boolean = terminal === process.stdout;
  // On the real terminal the boot readout shares one row tracker with the
  // brain animation, so neither hooks stdout's write twice nor miscounts the
  // other's scrolling. An injected test terminal gets its own local tracker.
  const localTracked: StreamRows | null =
    terminal.isTTY === true && !ownsStdout ? streamRows_track(terminal) : null;
  if (localTracked !== null) {
    for (const stream of options.shared ?? []) streamRows_track(stream, localTracked.counter);
  }
  const rows_tracked = (): StreamRows | null => {
    if (terminal.isTTY !== true) return null;
    if (!ownsStdout) return localTracked;
    // Whatever the animation installed; failing that, install it here.
    return stdoutRows_current() ?? stdoutRows_ensure();
  };
  const open: Map<string, OpenRow> = new Map();
  const horiz: string = useAscii ? '-' : '─';
  const cornerTL: string = useAscii ? '+' : '┌';
  const cornerTR: string = useAscii ? '+' : '┐';
  const cornerBL: string = useAscii ? '+' : '└';
  const cornerBR: string = useAscii ? '+' : '┘';
  const bar: string = horiz.repeat(Math.max(title.length + 8, 30));

  const lineTop: string = `${cornerTL}${bar}${cornerTR}`;
  const lineBot: string = `${cornerBL}${bar}${cornerBR}`;
  const statusPad = (label: string): string => label.padEnd(12);

  const statusTag = (status: BootStatus): string => {
    const { text, paint }: BootStatusTag = BOOT_STATUS_TAGS[status];
    // Pad the bare text, then colour it: padding a chalk-wrapped string
    // counts the escape sequences and the column drifts by however many
    // bytes the colour cost.
    return paint(text.padEnd(BOOT_TAG_WIDTH));
  };

  /**
   * Rewrites an open row where it stands.
   *
   * @param row - The settled row, painted.
   * @param target - Where the open row was printed and how many rows it took.
   * @returns False when the row cannot be reached or the outcome does not fit.
   */
  const row_rewrite = (row: string, target: OpenRow, tracked: StreamRows): boolean => {
    const up: number = tracked.counter.rows_get() - target.at;
    // A terminal that reports no height (a pty that never sent its size)
    // reads as zero, not absent, so default on any non-positive height —
    // never `?? 24`, which a real zero slips straight through.
    const screenRows: number = terminal.rows && terminal.rows > 0 ? terminal.rows : 24;
    if (up <= 0 || up >= screenRows) return false;
    const needed: number = Math.max(1, Math.ceil(text_visibleLength(row) / (terminal.columns || 80)));
    if (needed > target.rows) return false;
    // One write: save the cursor, climb to the row, clear every row it took,
    // paint the outcome from its first row, and return — so a spinner
    // mid-row below is left exactly where it was.
    let text: string = `\x1b[s\x1b[${up}A`;
    for (let index: number = 0; index < target.rows; index++) {
      text += `\r\x1b[2K${index < target.rows - 1 ? '\x1b[1B' : ''}`;
    }
    if (target.rows > 1) text += `\x1b[${target.rows - 1}A`;
    text += `\r${row}\x1b[u`;
    tracked.write_raw(text);
    return true;
  };

  return {
    header_print(): void { terminal.write(`${lineTop}\n`); },
    footer_print(): void { terminal.write(`${lineBot}\n`); },
    log(status: BootStatus, label: string, message: string): void {
      const row: string = `${statusTag(status)} ${statusPad(label)} ${message}`;
      const stillOpen: boolean = status === 'pending' || status === 'retry';
      const tracked: StreamRows | null = rows_tracked();
      const target: OpenRow | undefined = open.get(label);
      if (target !== undefined && tracked !== null && row_rewrite(row, target, tracked)) {
        if (!stillOpen) open.delete(label);
        return;
      }
      // A row lands on a row of its own. A spinner mid-row is cleared first
      // and redraws itself beneath on its next tick.
      if (tracked !== null && tracked.counter.column_get() > 0) terminal.write('\r\x1b[2K');
      const at: number = tracked?.counter.rows_get() ?? 0;
      terminal.write(`${row}\n`);
      const rows: number = tracked === null ? 1 : tracked.counter.rows_get() - at;
      if (stillOpen) open.set(label, { at, rows });
      else open.delete(label);
    },
  };
}

function box_render(title: string, rows: BootInfoItem[], useColor: boolean, useAscii: boolean): string[] {
  if (rows.length === 0) return [];
  const horiz: string = useAscii ? '-' : '─';
  const vert: string = useAscii ? '|' : '│';
  const cornerTL: string = useAscii ? '+' : '┌';
  const cornerTR: string = useAscii ? '+' : '┐';
  const cornerBL: string = useAscii ? '+' : '└';
  const cornerBR: string = useAscii ? '+' : '┘';

  const maxLabel: number = rows.reduce((max: number, item: BootInfoItem) => Math.max(max, item.label.length), title.length);
  const maxValue: number = rows.reduce((max: number, item: BootInfoItem) => Math.max(max, text_visibleLength(item.value)), 0);
  const innerWidth: number = Math.max(maxLabel + maxValue + 3, title.length + 2);
  const line: string = horiz.repeat(innerWidth);

  const titlePadded: string = title.padEnd(innerWidth);
  const lines: string[] = [];
  lines.push(`${cornerTL}${line}${cornerTR}`);
  lines.push(`${vert}${useColor ? chalk.cyan(titlePadded) : titlePadded}${vert}`);
  rows.forEach((item: BootInfoItem) => {
    const rawContent: string = `${item.label.padEnd(maxLabel)} ${item.value}`;
    const visLen: number = text_visibleLength(rawContent);
    const padCount: number = Math.max(0, innerWidth - visLen);
    
    const label: string = useColor ? chalk.yellow(item.label.padEnd(maxLabel)) : item.label.padEnd(maxLabel);
    const value: string = useColor ? chalk.white(item.value) : item.value;
    const paddedLine: string = `${label} ${value}${' '.repeat(padCount)}`;
    lines.push(`${vert}${paddedLine}${vert}`);
  });
  lines.push(`${cornerBL}${line}${cornerBR}`);
  return lines;
}

function box_minWidth(title: string, rows: BootInfoItem[]): number {
  const maxLabel: number = rows.reduce((max: number, item: BootInfoItem) => Math.max(max, item.label.length), title.length);
  const maxValue: number = rows.reduce((max: number, item: BootInfoItem) => Math.max(max, text_visibleLength(item.value)), 0);
  return Math.max(maxLabel + maxValue + 3, title.length + 2);
}

function box_minWidth3Col(title: string, rows: BootInfoItem3[]): number {
  const c1: number = rows.reduce((max: number, r: BootInfoItem3) => Math.max(max, r.app.length), 0);
  const c2: number = rows.reduce((max: number, r: BootInfoItem3) => Math.max(max, r.name.length), 0);
  const c3: number = rows.reduce((max: number, r: BootInfoItem3) => Math.max(max, r.version.length), 0);
  return Math.max(c1 + 2 + c2 + 2 + c3, title.length + 2);
}

function box_render3Col_withMin(
  title: string,
  rows: BootInfoItem3[],
  useColor: boolean,
  useAscii: boolean,
  minInner: number
): string[] {
  if (rows.length === 0) return [];
  const horiz: string = useAscii ? '-' : '─';
  const vert: string = useAscii ? '|' : '│';
  const cornerTL: string = useAscii ? '+' : '┌';
  const cornerTR: string = useAscii ? '+' : '┐';
  const cornerBL: string = useAscii ? '+' : '└';
  const cornerBR: string = useAscii ? '+' : '┘';

  const c1Width: number = rows.reduce((max: number, r: BootInfoItem3) => Math.max(max, r.app.length), 0);
  const c2NatWidth: number = rows.reduce((max: number, r: BootInfoItem3) => Math.max(max, r.name.length), 0);
  const c3Width: number = rows.reduce((max: number, r: BootInfoItem3) => Math.max(max, r.version.length), 0);
  const naturalInner: number = c1Width + 2 + c2NatWidth + 2 + c3Width;
  const innerWidth: number = Math.max(naturalInner, title.length + 2, minInner);
  // Stretch col2 to absorb any extra width
  const c2Width: number = c2NatWidth + (innerWidth - naturalInner);

  const line: string = horiz.repeat(innerWidth);
  const titlePadded: string = title.padEnd(innerWidth);
  const lines: string[] = [];
  lines.push(`${cornerTL}${line}${cornerTR}`);
  lines.push(`${vert}${useColor ? chalk.cyan(titlePadded) : titlePadded}${vert}`);

  rows.forEach((item: BootInfoItem3) => {
    const c1: string = useColor ? chalk.yellow(item.app.padEnd(c1Width)) : item.app.padEnd(c1Width);
    const c2: string = useColor ? chalk.white(item.name.padEnd(c2Width)) : item.name.padEnd(c2Width);
    const c3: string = useColor ? chalk.gray(item.version.padStart(c3Width)) : item.version.padStart(c3Width);
    lines.push(`${vert}${c1}  ${c2}  ${c3}${vert}`);
  });

  lines.push(`${cornerBL}${line}${cornerBR}`);
  return lines;
}

function box_render_withMin(title: string, rows: BootInfoItem[], useColor: boolean, useAscii: boolean, minInner: number): string[] {
  if (rows.length === 0) return [];
  const horiz: string = useAscii ? '-' : '─';
  const vert: string = useAscii ? '|' : '│';
  const cornerTL: string = useAscii ? '+' : '┌';
  const cornerTR: string = useAscii ? '+' : '┐';
  const cornerBL: string = useAscii ? '+' : '└';
  const cornerBR: string = useAscii ? '+' : '┘';

  const maxLabel: number = rows.reduce((max: number, item: BootInfoItem) => Math.max(max, item.label.length), title.length);
  const maxValue: number = rows.reduce((max: number, item: BootInfoItem) => Math.max(max, text_visibleLength(item.value)), 0);
  const innerWidth: number = Math.max(maxLabel + maxValue + 3, title.length + 2, minInner);
  const line: string = horiz.repeat(innerWidth);

  const titlePadded: string = title.padEnd(innerWidth);
  const lines: string[] = [];
  lines.push(`${cornerTL}${line}${cornerTR}`);
  lines.push(`${vert}${useColor ? chalk.cyan(titlePadded) : titlePadded}${vert}`);
  rows.forEach((item: BootInfoItem) => {
    const rawContent: string = `${item.label.padEnd(maxLabel)} ${item.value}`;
    const visLen: number = text_visibleLength(rawContent);
    const padCount: number = Math.max(0, innerWidth - visLen);
    
    const label: string = useColor ? chalk.yellow(item.label.padEnd(maxLabel)) : item.label.padEnd(maxLabel);
    const value: string = useColor ? chalk.white(item.value) : item.value;
    const paddedLine: string = `${label} ${value}${' '.repeat(padCount)}`;
    lines.push(`${vert}${paddedLine}${vert}`);
  });
  lines.push(`${cornerBL}${line}${cornerBR}`);
  return lines;
}

/**
 * Prints the intro panels side-by-side with the logo.
 *
 * @param logoLines - Rendered logo lines.
 * @param panels - Boot-info panels.
 * @param useColor - Whether to colorize output.
 * @param useAscii - Use ASCII box characters.
 */
export function bootsequence_printIntroPanels(
  logoLines: string[],
  panels: BootPanels,
  useColor: boolean,
  useAscii: boolean
): void {
  const leftPad: string = '  ';
  const minInner: number = Math.max(
    box_minWidth3Col('ChELL', panels.header),
    box_minWidth('Local', panels.local),
    box_minWidth('ChRIS', panels.chris)
  );

  const headerBox: string[] = box_render3Col_withMin('ChELL', panels.header, useColor, useAscii, minInner);
  const localBox: string[] = box_render_withMin('Local', panels.local, useColor, useAscii, minInner);
  const chrisBox: string[] = box_render_withMin('ChRIS', panels.chris, useColor, useAscii, minInner);

  const rightLinesRaw: string[] = [...headerBox, '', ...localBox, '', ...chrisBox];
  const rightWidth: number = rightLinesRaw.reduce((max: number, line: string) => Math.max(max, text_visibleLength(line)), 0);
  const rightLines: string[] = rightLinesRaw.map((line: string) => {
    const currentLen: number = text_visibleLength(line);
    if (currentLen >= rightWidth) return line;
    if (line.startsWith('┌') || line.startsWith('└') || line.startsWith('+') || line.startsWith('│') || line.startsWith('|')) {
      const padCount: number = rightWidth - currentLen;
      const lastChar: string = line.slice(-1);
      const body: string = line.slice(0, -1);
      return `${body}${' '.repeat(padCount)}${lastChar}`;
    }
    return line.padEnd(line.length + (rightWidth - currentLen), ' ');
  });

  const logoWidth: number = logoLines.reduce((max: number, line: string) => Math.max(max, text_visibleLength(line)), 0);
  const paddingBetween: number = 3;
  const logoBlock: string[] = ['', ...logoLines, ''].map((l: string) => l.padEnd(logoWidth, ' '));
  const totalWidth: number = logoWidth + paddingBetween + rightWidth;
  const lineChar: string = useAscii ? '-' : '─';
  const titleText: string = useColor ? chalk.bold.cyan('ChELL neofetch') : 'ChELL neofetch';
  const titleLine: string = `${leftPad}${titleText} ${lineChar.repeat(Math.max(0, totalWidth - text_visibleLength(titleText) - 1))}`;
  const rows: number = Math.max(logoBlock.length, rightLines.length);

  console.log(titleLine);
  for (let i = 0; i < rows; i++) {
    const logoSegment: string = logoBlock[i] ?? ''.padEnd(logoWidth, ' ');
    const rightSegment: string = rightLines[i] ?? '';
    const line: string = `${logoSegment}${' '.repeat(paddingBetween)}${rightSegment}`.trimEnd();
    console.log(`${leftPad}${line}`);
  }
}

/**
 * Prints the intro panels stacked vertically with the logo.
 *
 * @param logoLines - Rendered logo lines.
 * @param panels - Boot-info panels.
 * @param useColor - Whether to colorize output.
 * @param useAscii - Use ASCII box characters.
 */
export function bootsequence_printIntroPanelsStacked(
  logoLines: string[],
  panels: BootPanels,
  useColor: boolean,
  useAscii: boolean
): void {
  const leftPad: string = '  ';
  const minInner: number = Math.max(
    box_minWidth3Col('ChELL', panels.header),
    box_minWidth('Local', panels.local),
    box_minWidth('ChRIS', panels.chris)
  );

  const headerBox: string[] = box_render3Col_withMin('ChELL', panels.header, useColor, useAscii, minInner);
  const localBox: string[] = box_render_withMin('Local', panels.local, useColor, useAscii, minInner);
  const chrisBox: string[] = box_render_withMin('ChRIS', panels.chris, useColor, useAscii, minInner);

  const stackLines: string[] = [...headerBox, '', ...localBox, '', ...chrisBox];
  const boxesWidth: number = stackLines.reduce((max: number, line: string) => Math.max(max, text_visibleLength(line)), 0);
  const logoWidth: number = logoLines.reduce((max: number, line: string) => Math.max(max, text_visibleLength(line)), 0);
  const contentWidth: number = Math.max(boxesWidth, logoWidth);

  const lineChar: string = useAscii ? '-' : '─';
  const titleText: string = useColor ? chalk.bold.cyan('ChELL neofetch') : 'ChELL neofetch';
  const titleLine: string = `${leftPad}${titleText} ${lineChar.repeat(Math.max(0, contentWidth - text_visibleLength(titleText) - 1))}`;

  const padVisible = (line: string): string => {
    const diff: number = contentWidth - text_visibleLength(line);
    return diff > 0 ? `${line}${' '.repeat(diff)}` : line;
  };

  console.log(titleLine);
  stackLines.forEach((line: string) => {
    console.log(line === '' ? '' : `${leftPad}${padVisible(line)}`);
  });
  if (logoLines.length > 0) {
    console.log('');
    logoLines.forEach((line: string) => {
      console.log(`${leftPad}${padVisible(line)}`);
    });
  }
}
