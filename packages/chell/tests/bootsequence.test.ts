/**
 * @file Unit tests for boot-row rendering.
 *
 * The boot readout is a column layout, and its status tags are not all the
 * same width. These tests pin the property that keeps it readable: the
 * label column starts in the same place whatever the status says.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { bootLogger_create } from '../src/lib/bootsequence.js';
import type { BootStatus } from '../src/lib/bootsequence.js';

/** Strips ANSI colour so column positions can be measured. */
function plain_make(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('boot rows', () => {
  let lines: string[];
  let spy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    lines = [];
    spy = jest.spyOn(console, 'log').mockImplementation((value?: unknown): void => {
      lines.push(plain_make(String(value ?? '')));
    });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  /** Renders one row per status with a fixed label and message. */
  function rows_render(): void {
    const logger = bootLogger_create('BOOT', false);
    const statuses: BootStatus[] = ['ok', 'retry', 'skip', 'fail'];
    for (const status of statuses) logger.log(status, 'Folders', 'message');
  }

  it('starts every label in the same column, whatever the status', () => {
    rows_render();
    const columns: number[] = lines.map((line: string): number => line.indexOf('Folders'));
    expect(columns.every((column: number): boolean => column > 0)).toBe(true);
    expect(new Set(columns).size).toBe(1);
  });

  it('starts every message in the same column too', () => {
    rows_render();
    const columns: number[] = lines.map((line: string): number => line.indexOf('message'));
    expect(new Set(columns).size).toBe(1);
  });

  it('pads the tag rather than truncating it', () => {
    const logger = bootLogger_create('BOOT', false);
    logger.log('retry', 'Groups', 'retrying');
    logger.log('ok', 'Groups', 'done');
    expect(lines[0]).toContain('[RETRY]');
    expect(lines[1]).toContain('[ OK ]');
  });
});
