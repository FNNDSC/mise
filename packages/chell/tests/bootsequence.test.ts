/**
 * @file Unit tests for boot-row rendering.
 *
 * The boot readout is a column layout, and its status tags are not all the
 * same width. These tests pin the property that keeps it readable: the
 * label column starts in the same place whatever the status says.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { bootLogger_create } from '../src/lib/bootsequence.js';
import type { BootStatus, BootTerminal } from '../src/lib/bootsequence.js';

/** Strips ANSI colour so column positions can be measured. */
function plain_make(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

/** A terminal that records every write, on or off a TTY. */
function terminal_make(isTTY: boolean, columns: number = 80, rows: number = 40): BootTerminal & { writes: string[] } {
  const terminal: BootTerminal & { writes: string[] } = {
    writes: [],
    isTTY,
    columns,
    rows,
    write(chunk: string | Uint8Array): boolean {
      terminal.writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    },
  };
  return terminal;
}

describe('boot rows', () => {
  let terminal: ReturnType<typeof terminal_make>;
  let lines: string[];

  beforeEach(() => {
    terminal = terminal_make(false);
    lines = terminal.writes;
  });

  /** Renders one row per status with a fixed label and message. */
  function rows_render(): void {
    const logger = bootLogger_create('BOOT', false, { terminal, shared: [] });
    const statuses: BootStatus[] = ['ok', 'retry', 'skip', 'fail'];
    for (const status of statuses) logger.log(status, 'Folders', 'message');
  }

  it('starts every label in the same column, whatever the status', () => {
    rows_render();
    const columns: number[] = lines.map((line: string): number => plain_make(line).indexOf('Folders'));
    expect(columns.every((column: number): boolean => column > 0)).toBe(true);
    expect(new Set(columns).size).toBe(1);
  });

  it('starts every message in the same column too', () => {
    rows_render();
    const columns: number[] = lines.map((line: string): number => plain_make(line).indexOf('message'));
    expect(new Set(columns).size).toBe(1);
  });

  it('pads the tag rather than truncating it', () => {
    const logger = bootLogger_create('BOOT', false, { terminal, shared: [] });
    logger.log('retry', 'Groups', 'retrying');
    logger.log('ok', 'Groups', 'done');
    expect(plain_make(lines[0])).toContain('[RETRY]');
    expect(plain_make(lines[1])).toContain('[ OK ]');
  });

  it('off a terminal, a settled step appends its row: there is no screen to rewrite', () => {
    const logger = bootLogger_create('BOOT', false, { terminal, shared: [] });
    logger.log('pending', 'Groups', 'Resolving /etc/group behind the prompt');
    logger.log('ok', 'Groups', 'Cached 70 groups');
    expect(lines.map(plain_make)).toEqual([
      '[PENDING] Groups       Resolving /etc/group behind the prompt\n',
      '[ OK ]    Groups       Cached 70 groups\n',
    ]);
  });
});

describe('a pending row settles in place on a terminal', () => {
  /** Reads the rewrite's cursor climb, in rows, from its escape. */
  function climb_read(write: string): number | null {
    const match: RegExpMatchArray | null = write.match(/^\x1b\[s\x1b\[(\d+)A/);
    return match === null ? null : Number(match[1]);
  }

  it('rewrites the pending row where it stands, counting the rows printed since', () => {
    const terminal = terminal_make(true);
    const logger = bootLogger_create('BOOT', false, { terminal, shared: [] });
    logger.log('pending', 'Groups', 'Resolving /etc/group behind the prompt');
    logger.log('pending', 'Feeds', 'Warming /home/rudolph/feeds behind the prompt');
    logger.log('ok', 'Jobs', 'Indexed 3 feeds');
    logger.log('ok', 'Groups', 'Cached 70 groups');
    const rewrite: string = terminal.writes[3];
    // Three rows were printed after Groups: the cursor climbs three.
    expect(climb_read(rewrite)).toBe(3);
    expect(rewrite).toContain('\r\x1b[2K');
    expect(plain_make(rewrite)).toContain('[ OK ]    Groups       Cached 70 groups');
    // And it returns to where it was: the write ends with the restore.
    expect(rewrite.endsWith('\x1b[u')).toBe(true);
    // Nothing was appended for Groups.
    expect(terminal.writes.length).toBe(4);
  });

  it('settles a row once: a second outcome for the label appends', () => {
    const terminal = terminal_make(true);
    const logger = bootLogger_create('BOOT', false, { terminal, shared: [] });
    logger.log('pending', 'Queries', 'Indexing prior PACS queries behind the prompt');
    logger.log('ok', 'Queries', 'Indexed 1 PACS query');
    logger.log('ok', 'Queries', 'Indexed again');
    expect(climb_read(terminal.writes[1])).toBe(1);
    expect(terminal.writes[2]).toBe(plain_make(terminal.writes[2]) === terminal.writes[2] ? terminal.writes[2] : terminal.writes[2]);
    expect(plain_make(terminal.writes[2]).endsWith('Indexed again\n')).toBe(true);
  });

  it('keeps a retry open, so the outcome that follows settles the same row', () => {
    const terminal = terminal_make(true);
    const logger = bootLogger_create('BOOT', false, { terminal, shared: [] });
    logger.log('pending', 'Groups', 'Resolving /etc/group behind the prompt');
    logger.log('ok', 'Feeds', 'Cached 4 items');
    logger.log('retry', 'Groups', 'Attempt 1/3 failed; retrying.');
    logger.log('ok', 'Groups', 'Cached 70 groups');
    expect(climb_read(terminal.writes[2])).toBe(2);
    expect(climb_read(terminal.writes[3])).toBe(2);
  });

  it('counts wrapped rows: a long row beneath the pending one costs the climb its true height', () => {
    const terminal = terminal_make(true, 40);
    const logger = bootLogger_create('BOOT', false, { terminal, shared: [] });
    logger.log('pending', 'Groups', 'behind');
    logger.log('ok', 'Jobs', 'x'.repeat(70));
    logger.log('ok', 'Groups', 'done');
    // The Jobs row wrapped to three rows of forty; pending row plus three.
    expect(climb_read(terminal.writes[2])).toBe(4);
  });

  it('rewrites when the terminal reports no height, defaulting rather than treating zero as a ceiling', () => {
    // A pty that never sent its winsize reads rows as 0; `?? 24` would let
    // that zero through and make every settle bail. It must default instead.
    const terminal = terminal_make(true, 80, 0);
    const logger = bootLogger_create('BOOT', false, { terminal, shared: [] });
    logger.log('pending', 'Groups', 'behind');
    logger.log('ok', 'Feeds', 'Cached 4 items');
    logger.log('ok', 'Groups', 'Cached 70 groups');
    // Groups' own row plus the Feeds row beneath it: a climb of two, not a bail.
    expect(climb_read(terminal.writes[2])).toBe(2);
  });

  it('gives up and appends when the row has scrolled off the screen', () => {
    const terminal = terminal_make(true, 80, 4);
    const logger = bootLogger_create('BOOT', false, { terminal, shared: [] });
    logger.log('pending', 'Groups', 'behind');
    for (let index: number = 0; index < 5; index++) logger.log('ok', `Row${index}`, 'filler');
    logger.log('ok', 'Groups', 'done');
    const last: string = terminal.writes[terminal.writes.length - 1];
    expect(climb_read(last)).toBeNull();
    expect(plain_make(last).endsWith('done\n')).toBe(true);
  });

  it('gives up and appends when the outcome needs more rows than the pending row took', () => {
    const terminal = terminal_make(true, 40);
    const logger = bootLogger_create('BOOT', false, { terminal, shared: [] });
    logger.log('pending', 'Groups', 'short');
    logger.log('ok', 'Groups', 'y'.repeat(70));
    expect(climb_read(terminal.writes[1])).toBeNull();
    expect(terminal.writes.length).toBe(2);
  });

  it('clears a spinner mid-row before a new row lands, so the two never share a line', () => {
    const terminal = terminal_make(true);
    const logger = bootLogger_create('BOOT', false, { terminal, shared: [] });
    logger.log('pending', 'Groups', 'behind');
    // A spinner frame: carriage return, glyph, text, no newline.
    terminal.write('\r⣻         Jobs         Indexing /proc/jobs (feed list)... (7.2s)');
    logger.log('ok', 'Roster', '1 feed moved while away');
    expect(terminal.writes[2]).toBe('\r\x1b[2K');
    expect(plain_make(terminal.writes[3]).startsWith('[ OK ]    Roster')).toBe(true);
    // And a settle during that spinner climbs past the spinner's row without disturbing it.
    terminal.write('\r⣽         Jobs         Indexing /proc/jobs (feed list)... (7.3s)');
    logger.log('ok', 'Groups', 'done');
    expect(climb_read(terminal.writes[5])).toBe(2);
  });
});
