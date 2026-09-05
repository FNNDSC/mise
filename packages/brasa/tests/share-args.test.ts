/**
 * @file Unit tests for the `share` builtin's argument reading.
 *
 * Kept to the pure parts: the engine graph cannot be loaded under jest.
 */

import { describe, it, expect } from '@jest/globals';
import { shareArgs_parse, shareTarget_resolve } from '../src/builtins/fs/share.args.js';

describe('share arguments', () => {
  it('reads a feed and an identity', () => {
    expect(shareArgs_parse(['feed_12', 'someone'])).toEqual({ target: 'feed_12', username: 'someone' });
  });

  it('lets the operator say "with", because that is how it reads aloud', () => {
    expect(shareArgs_parse(['feed_12', 'with', 'someone'])).toEqual({ target: 'feed_12', username: 'someone' });
  });

  it('treats a lone feed as a question, not a grant', () => {
    expect(shareArgs_parse(['feed_12']).username).toBeNull();
  });

  it('reports nothing to act on when nothing was given', () => {
    expect(shareArgs_parse([]).target).toBeNull();
  });
});

describe('share target', () => {
  it('accepts a bare id', () => {
    expect(shareTarget_resolve('12')).toBe(12);
  });

  it('accepts the name a listing shows', () => {
    expect(shareTarget_resolve('feed_12')).toBe(12);
  });

  it('accepts any path that names a feed, including a shared one', () => {
    expect(shareTarget_resolve('/home/someone/feeds/feed_12/pl-dircopy_3/data')).toBe(12);
    expect(shareTarget_resolve('/SHARED/someone/feeds/feed_4299')).toBe(4299);
  });

  it('refuses what names no feed', () => {
    expect(shareTarget_resolve('/home/someone/uploads')).toBeNull();
    expect(shareTarget_resolve('0')).toBeNull();
    expect(shareTarget_resolve('feed_')).toBeNull();
  });
});
