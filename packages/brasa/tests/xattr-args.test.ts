/**
 * @file Unit tests for the `setfattr` / `getfattr` grammar.
 */
import { describe, it, expect } from '@jest/globals';
import { getfattrArgs_parse, setfattrArgs_parse, xattrTarget_resolve, xattr_render } from '../src/builtins/fs/xattr.args.js';

describe('setfattr', () => {
  it('sets a tag with -n tag -v value, on one or many feeds', () => {
    expect(setfattrArgs_parse(['-n', 'tag', '-v', 'urgent', 'feed_12'])).toEqual({ mode: 'set', value: 'urgent', paths: ['feed_12'], error: null });
    expect(setfattrArgs_parse(['-n', 'user.tag', '-v', ' review ', 'feed_12', 'feed_13']).paths).toEqual(['feed_12', 'feed_13']);
    expect(setfattrArgs_parse(['-n', 'user.tag', '-v', ' review ', 'feed_12']).value).toBe('review');
  });

  it('removes one tag with -x tag -v value, every tag with -x tag alone', () => {
    expect(setfattrArgs_parse(['-x', 'tag', '-v', 'urgent', 'feed_12'])).toEqual({ mode: 'remove', value: 'urgent', paths: ['feed_12'], error: null });
    expect(setfattrArgs_parse(['-x', 'tag', 'feed_12'])).toEqual({ mode: 'remove', value: null, paths: ['feed_12'], error: null });
  });

  it('refuses another attribute, an unknown flag, a missing value or path, by name', () => {
    expect(setfattrArgs_parse(['-n', 'color', '-v', 'red', 'feed_12']).error).toMatch(/color: Operation not supported/);
    expect(setfattrArgs_parse(['-n', 'tag', '-v', 'x', '-q', 'feed_12']).error).toMatch(/invalid option -- 'q'/);
    expect(setfattrArgs_parse(['-n', 'tag', 'feed_12']).error).toMatch(/needs -v/);
    expect(setfattrArgs_parse(['-n', 'tag', '-v', 'x']).error).toMatch(/usage/);
    expect(setfattrArgs_parse(['-n']).error).toMatch(/requires an argument/);
    expect(setfattrArgs_parse([]).error).toMatch(/usage/);
  });
});

describe('getfattr', () => {
  it('reads paths, accepts -n tag and -d, refuses others by name', () => {
    expect(getfattrArgs_parse(['feed_12', '/proc/jobs/feed_13'])).toEqual({ paths: ['feed_12', '/proc/jobs/feed_13'], error: null });
    expect(getfattrArgs_parse(['-n', 'tag', '-d', 'feed_12']).paths).toEqual(['feed_12']);
    expect(getfattrArgs_parse(['-n', 'owner', 'feed_12']).error).toMatch(/owner: No such attribute/);
    expect(getfattrArgs_parse(['-z', 'feed_12']).error).toMatch(/invalid option -- 'z'/);
    expect(getfattrArgs_parse([]).error).toMatch(/usage/);
  });
});

describe('targets and rendering', () => {
  it('resolves a feed by id, feed_N, a /feeds/ path, or its /proc projection', () => {
    expect(xattrTarget_resolve('12')).toBe(12);
    expect(xattrTarget_resolve('feed_12')).toBe(12);
    expect(xattrTarget_resolve('/home/me/feeds/feed_12/pl-dircopy_3')).toBe(12);
    expect(xattrTarget_resolve('/proc/jobs/feed_12')).toBe(12);
    expect(xattrTarget_resolve('/home/me/uploads')).toBeNull();
  });

  it("renders getfattr's dump shape, quoting a value's quotes", () => {
    expect(xattr_render('feed_12', ['urgent', 'say "hi"'])).toBe('# file: feed_12\ntag="urgent"\ntag="say \\"hi\\""');
    expect(xattr_render('feed_12', [])).toBe('# file: feed_12');
  });
});
