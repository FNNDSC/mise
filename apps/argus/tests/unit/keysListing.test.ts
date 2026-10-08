/**
 * @file The row cursor the keys move over a listing (a-frame-is-reachable-by-keys).
 */
import { describe, it, expect } from '@jest/globals';
import { rowCursor_next } from '../../src/app/keys.js';

describe('the row cursor', () => {
  it('steps down and up a row, stopping at the ends', () => {
    expect(rowCursor_next(0, 5, 'ArrowDown')).toBe(1);
    expect(rowCursor_next(4, 5, 'ArrowDown')).toBe(4);
    expect(rowCursor_next(3, 5, 'ArrowUp')).toBe(2);
    expect(rowCursor_next(0, 5, 'ArrowUp')).toBe(0);
  });

  it('starts at the top going down and at the bottom going up; Home and End go to the ends', () => {
    expect(rowCursor_next(-1, 5, 'ArrowDown')).toBe(0);
    expect(rowCursor_next(-1, 5, 'ArrowUp')).toBe(4);
    expect(rowCursor_next(2, 5, 'Home')).toBe(0);
    expect(rowCursor_next(2, 5, 'End')).toBe(4);
  });

  it('does not move for other keys, or over no rows', () => {
    expect(rowCursor_next(1, 5, 'Enter')).toBeNull();
    expect(rowCursor_next(-1, 0, 'ArrowDown')).toBeNull();
  });
});
