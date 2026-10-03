/**
 * @file Unit tests for the `setfacl` / `getfacl` / `chmod` grammar: user,
 * group and other entries; `-x` for a user or a group; `chmod o±r`; the
 * targets a feed is named by; getfacl's block.
 */

import { describe, it, expect } from '@jest/globals';
import {
  aclEntry_parse, aclRemoval_parse, aclTarget_resolve, acl_render, chmodArgs_parse, setfaclArgs_parse,
} from '../src/builtins/fs/acl.args.js';

describe('access control entries', () => {
  it('reads user, group and other entries, short and long', () => {
    expect(aclEntry_parse('u:someone:r')).toEqual({ kind: 'user', name: 'someone', perms: 'r' });
    expect(aclEntry_parse('user:someone:rw-')).toEqual({ kind: 'user', name: 'someone', perms: 'rw-' });
    expect(aclEntry_parse('g:grantlab:r')).toEqual({ kind: 'group', name: 'grantlab', perms: 'r' });
    expect(aclEntry_parse('o::r')).toEqual({ kind: 'other', name: '', perms: 'r' });
    expect(aclEntry_parse('other::-')).toEqual({ kind: 'other', name: '', perms: '-' });
    expect(aclEntry_parse('o:r')).toEqual({ kind: 'other', name: '', perms: 'r' });
  });

  it('refuses a malformed entry', () => {
    expect(aclEntry_parse('someone')).toBeNull();
    expect(aclEntry_parse('u::r')).toBeNull();
    expect(aclEntry_parse('u:someone:zz')).toBeNull();
    expect(aclEntry_parse('o:x:r')).toBeNull();
    expect(aclEntry_parse('m::r')).toBeNull();
  });

  it('reads a removal for a user (bare or u:) or a group, and refuses the other entry by name', () => {
    expect(aclRemoval_parse('u:ann')).toEqual({ kind: 'user', name: 'ann' });
    expect(aclRemoval_parse('ann')).toEqual({ kind: 'user', name: 'ann' });
    expect(aclRemoval_parse('g:grantlab')).toEqual({ kind: 'group', name: 'grantlab' });
    expect(aclRemoval_parse('o')).toContain('setfacl -m o::-');
    expect(aclRemoval_parse('o::')).toContain('cannot be removed');
  });
});

describe('setfacl arguments', () => {
  it('reads a grant and its paths', () => {
    const parsed = setfaclArgs_parse(['-m', 'g:grantlab:r', '/home/me/feeds/feed_12', 'feed_13']);
    expect(parsed.error).toBeNull();
    expect(parsed.modify).toEqual({ kind: 'group', name: 'grantlab', perms: 'r' });
    expect(parsed.paths).toEqual(['/home/me/feeds/feed_12', 'feed_13']);
  });

  it('reads -x as a removal', () => {
    expect(setfaclArgs_parse(['-x', 'u:someone', 'feed_1']).remove).toEqual({ kind: 'user', name: 'someone' });
    expect(setfaclArgs_parse(['-x', 'g:lab', 'feed_1']).remove).toEqual({ kind: 'group', name: 'lab' });
    expect(setfaclArgs_parse(['-x', 'o', 'feed_1']).error).toContain('o::-');
  });

  it('asks for an entry and a path rather than guessing, and names an option it lacks', () => {
    expect(setfaclArgs_parse([]).error).toContain('usage');
    expect(setfaclArgs_parse(['-m', 'u:someone:r']).error).toContain('usage');
    expect(setfaclArgs_parse(['/home/me/feeds/feed_12']).error).toContain('usage');
    expect(setfaclArgs_parse(['-R', '-m', 'u:s:r', 'feed_1']).error).toContain("'-R'");
    expect(setfaclArgs_parse(['-m', 'nonsense', 'feed_1']).error).toContain('is not an entry');
  });
});

describe('chmod arguments', () => {
  it('reads o+r and o-r as the other entry, and refuses any other mode by name', () => {
    expect(chmodArgs_parse(['o+r', 'feed_1'])).toEqual({ entry: { kind: 'other', name: '', perms: 'r' }, paths: ['feed_1'] });
    expect(chmodArgs_parse(['o-r', 'feed_1', 'feed_2'])).toEqual({ entry: { kind: 'other', name: '', perms: '-' }, paths: ['feed_1', 'feed_2'] });
    expect(chmodArgs_parse(['u+x', 'feed_1'])).toContain("mode 'u+x' is not one a feed has");
    expect(chmodArgs_parse(['o+r'])).toContain('usage');
  });
});

describe('acl target', () => {
  it('accepts an id, the name a listing shows, any path through /feeds/, and /proc/jobs/feed_N', () => {
    expect(aclTarget_resolve('12')).toBe(12);
    expect(aclTarget_resolve('feed_12')).toBe(12);
    expect(aclTarget_resolve('/home/someone/feeds/feed_12/pl-dircopy_3/data')).toBe(12);
    expect(aclTarget_resolve('/SHARED/someone/feeds/feed_4299')).toBe(4299);
    expect(aclTarget_resolve('/proc/jobs/feed_880')).toBe(880);
  });

  it('refuses what names no feed', () => {
    expect(aclTarget_resolve('/home/someone/uploads')).toBeNull();
    expect(aclTarget_resolve('0')).toBeNull();
  });
});

describe('getfacl rendering', () => {
  it('wears the shape getfacl wears: owner entry, users, groups, then other', () => {
    expect(acl_render('/home/me/feeds/feed_12', 'me', { users: ['ann'], groups: ['lab'], public: true })).toBe(
      ['# file: home/me/feeds/feed_12', '# owner: me', 'user::rw-', 'user:ann:r--', 'group:lab:r--', 'other::r--'].join('\n'),
    );
    expect(acl_render('feed_12', null, { users: [], groups: [], public: false })).toBe(['# file: feed_12', 'user::rw-', 'other::---'].join('\n'));
  });
});
