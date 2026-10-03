/**
 * @jest-environment jsdom
 *
 * @file A feed's access in ARGUS: holders read from getfacl's model, the
 * groups a user belongs to from /etc/group, the entry an answer to SHARE
 * names, the line each holder's × runs, and the marks themselves.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { access_wire, groupsOf_user, holderLine_of, holders_of, shareEntry_of } from '../../src/app/access.js';
import type { ExecuteOutcome } from '../../src/calypso/client.js';

const outcome = (model: unknown): ExecuteOutcome => ({ envelopes: [{ status: 'ok', rendered: '', model } as never], liveChannels: new Set() });

describe('reading access', () => {
  it('reads users, groups and the public flag from getfacl, and nothing from another model', () => {
    expect(holders_of(outcome({ kind: 'fs.acl', data: [{ path: 'feed_12', usernames: ['ann'], groups: ['lab'], public: true }] }))).toEqual({ users: ['ann'], groups: ['lab'], public: true });
    expect(holders_of(outcome({ kind: 'fs.cwd', data: {} }))).toBeNull();
  });

  it('reads the groups a user belongs to from /etc/group', () => {
    const text = 'sysadmin:x:62:ann,me,bob\nlab:x:3:me\nother:x:9:bob\nbroken line\n';
    expect(groupsOf_user(text, 'me')).toEqual(['sysadmin', 'lab']);
    expect(groupsOf_user(text, 'nobody')).toEqual([]);
  });
});

describe('the lines access changes run', () => {
  it('takes a pill entry as it is and a typed name as a user', () => {
    expect(shareEntry_of('g:lab:r')).toBe('g:lab:r');
    expect(shareEntry_of('o::r')).toBe('o::r');
    expect(shareEntry_of('ann')).toBe('u:ann:r');
  });

  it('withdraws a user or a group by setfacl -x, and PUBLIC by making the feed private', () => {
    expect(holderLine_of(12, { kind: 'user', name: 'ann' })).toBe("setfacl -x u:'ann' feed_12");
    expect(holderLine_of(12, { kind: 'group', name: 'lab' })).toBe("setfacl -x g:'lab' feed_12");
    expect(holderLine_of(12, { kind: 'public' })).toBe('setfacl -m o::- feed_12');
  });
});

describe('the holder marks', () => {
  const verbs = access_wire({ terminal: {} as never, client: {} as never }, { ask_onPane: jest.fn(async () => null), promptUser: () => 'me', changed: jest.fn() });

  it('says nobody when nobody holds it', () => {
    expect(verbs.holders_build('dag', 12, { users: [], groups: [], public: false }).textContent).toBe('SHARED WITH NOBODY');
  });

  it('marks each user, each group and PUBLIC, each with its ×', () => {
    const marks = verbs.holders_build('dag', 12, { users: ['ann'], groups: ['lab'], public: true });
    expect([...marks.querySelectorAll('.holder-mark')].map((m) => m.className)).toEqual(['holder-mark holder-user', 'holder-mark holder-group', 'holder-mark holder-public']);
    expect(marks.querySelectorAll('.holder-mark-x').length).toBe(3);
    expect(marks.textContent).toBe('SHARED WITH ann×group lab×PUBLIC×');
  });
});
