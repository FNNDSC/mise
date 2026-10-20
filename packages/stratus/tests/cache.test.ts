/**
 * @file Answers are kept for a short life, under an injected clock.
 */
import { describe, it, expect } from '@jest/globals';
import { AnswerCache } from '../src/cache.js';

describe('AnswerCache', () => {
  it('asks once within the life, again after it, and forgets by key or prefix', async () => {
    let now = 1000;
    const cache = new AnswerCache(100, () => now);
    let asked = 0;
    const ask = async (): Promise<number> => ++asked;
    expect(await cache.answer_get('a/b', ask)).toBe(1);
    expect(await cache.answer_get('a/b', ask)).toBe(1);
    now = 1099;
    expect(await cache.answer_get('a/b', ask)).toBe(1);
    now = 1100;
    expect(await cache.answer_get('a/b', ask)).toBe(2);
    expect(await cache.answer_get('a/c', ask)).toBe(3);
    cache.forget('a/b');
    expect(await cache.answer_get('a/b', ask)).toBe(4);
    expect(await cache.answer_get('a/c', ask)).toBe(3);
    cache.forget('a');
    expect(await cache.answer_get('a/c', ask)).toBe(5);
    cache.clear();
    expect(await cache.answer_get('a/c', ask)).toBe(6);
  });

  it('keeps a minute by default', async () => {
    const cache = new AnswerCache();
    let asked = 0;
    expect(await cache.answer_get('k', async () => ++asked)).toBe(1);
    expect(await cache.answer_get('k', async () => ++asked)).toBe(1);
  });
});
