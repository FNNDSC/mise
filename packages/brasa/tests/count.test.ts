/**
 * @file A count and its noun agree in number.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { count_noun } from '../src/lib/count.js';

describe('count_noun', () => {
  it('takes the singular for exactly one and the plural otherwise', () => {
    expect(count_noun(1, 'feed')).toBe('1 feed');
    expect(count_noun(3, 'feed')).toBe('3 feeds');
    expect(count_noun(0, 'feed')).toBe('0 feeds');
  });

  it('takes an irregular plural when given one', () => {
    expect(count_noun(1, 'query', 'queries')).toBe('1 query');
    expect(count_noun(2, 'query', 'queries')).toBe('2 queries');
  });
});
