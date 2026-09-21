/**
 * @file A refused roster keeps its words and leaves the number to the live figure.
 */
import { describe, it, expect } from '@jest/globals';
import { refusalReason_strip } from '../../src/features/dag/refusal.js';

const ESC: string = String.fromCharCode(27);

describe('refusalReason_strip', () => {
  it('drops the count the daemon froze into its reason', () => {
    expect(refusalReason_strip(`${ESC}[33mproc: the visible-job index is still warming (300/210012, 0%).${ESC}[39m\nThis query could return incomplete results.`))
      .toBe('proc: the visible-job index is still warming.');
    expect(refusalReason_strip('proc: the visible-job index is still warming (initializing).')).toBe('proc: the visible-job index is still warming.');
  });

  it('leaves a reason with no count alone', () => {
    expect(refusalReason_strip(`${ESC}[31mproc warm-up failed: the topology sweep did not complete${ESC}[39m`)).toBe('proc warm-up failed: the topology sweep did not complete');
    expect(refusalReason_strip('')).toBe('');
  });
});
