/**
 * @file The live-work count clears when a pull ends.
 *
 * The defect this covers: "1 RUNNING" in the status bar stuck forever after
 * a series was pulled. A pull reports each series under `pull:<uid>` and
 * closes the whole operation under `pull:` with no item id, so the closing
 * message never matched the keys it was meant to clear — and a per-series
 * retrieve carries its ending in `status`, not in `phase`, so watching the
 * phase alone never saw a series finish either.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { running_reconcile } from '../../src/app/status.js';

/** Folds a sequence of messages into a fresh set and returns its size. */
function after(messages: Array<{ operation: string; itemId?: string; phase?: string; status?: string }>): number {
  const running = new Set<string>();
  for (const message of messages) running_reconcile(running, message);
  return running.size;
}

describe('running_reconcile', () => {
  it('counts one operation reporting many items once per item', () => {
    expect(after([
      { operation: 'pull', itemId: 'a', phase: 'watching', status: 'running' },
      { operation: 'pull', itemId: 'b', phase: 'watching', status: 'running' },
    ])).toBe(2);
  });

  it('clears a series when its status turns terminal, though the phase never changes', () => {
    expect(after([
      { operation: 'pull', itemId: 'a', phase: 'watching', status: 'running' },
      { operation: 'pull', itemId: 'a', phase: 'watching', status: 'done' },
    ])).toBe(0);
  });

  it('clears every item of an operation when the operation closes without an item id', () => {
    // The pull that stuck: two series open under pull:<uid>, the close
    // carries no id and unit 'series'.
    expect(after([
      { operation: 'pull', itemId: 'a', phase: 'watching', status: 'running' },
      { operation: 'pull', itemId: 'b', phase: 'watching', status: 'running' },
      { operation: 'pull', phase: 'complete', status: 'done' },
    ])).toBe(0);
  });

  it('a folder-announce done after the count leaves nothing running', () => {
    expect(after([
      { operation: 'pull', itemId: 'a', phase: 'watching', status: 'running' },
      { operation: 'pull', itemId: 'a', phase: 'watching', status: 'done' },
      { operation: 'pull', itemId: 'a', phase: 'watching', status: 'done', },
      { operation: 'pull', phase: 'complete', status: 'done' },
    ])).toBe(0);
  });

  it('a failed operation clears its items too', () => {
    expect(after([
      { operation: 'pull', itemId: 'a', phase: 'watching', status: 'running' },
      { operation: 'pull', phase: 'failed', status: 'error' },
    ])).toBe(0);
  });

  it('keeps other operations while one closes', () => {
    expect(after([
      { operation: 'pull', itemId: 'a', phase: 'watching', status: 'running' },
      { operation: 'upload', itemId: 'x', phase: 'transferring', status: 'running' },
      { operation: 'pull', phase: 'complete', status: 'done' },
    ])).toBe(1);
  });
});
