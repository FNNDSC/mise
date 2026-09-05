/**
 * @file Unit tests for the `setfacl` / `getfacl` grammar.
 */

import { describe, it, expect } from '@jest/globals';
import {
  aclEntry_parse, aclTarget_resolve, acl_render, setfaclArgs_parse,
} from '../src/builtins/fs/acl.args.js';

describe('access control entries', () => {
  it('reads the short and long user forms', () => {
    expect(aclEntry_parse('u:someone:r')).toEqual({ username: 'someone', perms: 'r' });
    expect(aclEntry_parse('user:someone:rw-')).toEqual({ username: 'someone', perms: 'rw-' });
  });

  it('refuses group and other entries rather than treating them as users', () => {
    // CUBE models a grant to an identity; silently reading `g:` as a user
    // would grant the wrong thing to the wrong party.
    expect(aclEntry_parse('g:team:r')).toBeNull();
    expect(aclEntry_parse('o::r')).toBeNull();
  });

  it('refuses a malformed entry', () => {
    expect(aclEntry_parse('someone')).toBeNull();
    expect(aclEntry_parse('u::r')).toBeNull();
    expect(aclEntry_parse('u:someone:zz')).toBeNull();
  });
});

describe('setfacl arguments', () => {
  it('reads a grant and its paths', () => {
    const parsed = setfaclArgs_parse(['-m', 'u:someone:r', '/home/me/feeds/feed_12']);
    expect(parsed.error).toBeNull();
    expect(parsed.modify).toEqual({ username: 'someone', perms: 'r' });
    expect(parsed.paths).toEqual(['/home/me/feeds/feed_12']);
  });

  it('accepts several paths, as the real thing does', () => {
    const parsed = setfaclArgs_parse(['-m', 'u:someone:r', 'feed_1', 'feed_2']);
    expect(parsed.paths).toEqual(['feed_1', 'feed_2']);
  });

  it('reads -x as a removal, however the identity is spelled', () => {
    expect(setfaclArgs_parse(['-x', 'u:someone', 'feed_1']).remove).toBe('someone');
    expect(setfaclArgs_parse(['-x', 'someone', 'feed_1']).remove).toBe('someone');
  });

  it('asks for an entry and a path rather than guessing', () => {
    expect(setfaclArgs_parse([]).error).toContain('usage');
    expect(setfaclArgs_parse(['-m', 'u:someone:r']).error).toContain('usage');
    expect(setfaclArgs_parse(['/home/me/feeds/feed_12']).error).toContain('usage');
  });

  it('names an option it does not support instead of ignoring it', () => {
    expect(setfaclArgs_parse(['-R', '-m', 'u:s:r', 'feed_1']).error).toContain("'-R'");
  });
});

describe('acl target', () => {
  it('accepts an id, the name a listing shows, and any path holding one', () => {
    expect(aclTarget_resolve('12')).toBe(12);
    expect(aclTarget_resolve('feed_12')).toBe(12);
    expect(aclTarget_resolve('/home/someone/feeds/feed_12/pl-dircopy_3/data')).toBe(12);
    expect(aclTarget_resolve('/SHARED/someone/feeds/feed_4299')).toBe(4299);
  });

  it('refuses what names no feed', () => {
    expect(aclTarget_resolve('/home/someone/uploads')).toBeNull();
    expect(aclTarget_resolve('0')).toBeNull();
  });
});

describe('getfacl rendering', () => {
  it('wears the shape getfacl wears', () => {
    expect(acl_render('/home/me/feeds/feed_12', 'me', ['ann'])).toBe(
      ['# file: home/me/feeds/feed_12', '# owner: me', 'user::rw-', 'user:ann:r--'].join('\n'),
    );
  });

  it('says the owner line only when the owner is known', () => {
    expect(acl_render('feed_12', null, [])).toBe(['# file: feed_12', 'user::rw-'].join('\n'));
  });
});
