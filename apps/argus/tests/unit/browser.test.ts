/**
 * @file The browser's pure readings: what a path names (imagery, a node's
 * own data, a feed, a projection), a stripped rendering, and an access
 * list read out of a silent getfacl.
 */
import { describe, it, expect } from '@jest/globals';
import type { ExecuteOutcome } from '../../src/calypso/client.js';
import { ansi_strip, feedOf_path, imagery_is, nodeOf_path, path_isProjection, shares_read, TABLE_FILE_PATTERN } from '../../src/app/browser.js';

describe('path readings', () => {
  it('names imagery by a volume or a DICOM slice', () => {
    expect(imagery_is('/home/u/x.nii.gz')).toBe(true);
    expect(imagery_is('/home/u/slice.dcm')).toBe(true);
    expect(imagery_is('/home/u/notes.txt')).toBe(false);
  });

  it("names a node's own data, a feed, and a projection", () => {
    expect(nodeOf_path('/home/u/feeds/feed_12/pl-dircopy_34/data')).toBe(34);
    expect(nodeOf_path('/home/u/feeds/feed_12/pl-dircopy_34/data/')).toBe(34);
    expect(nodeOf_path('/home/u/feeds/feed_12/pl-dircopy_34')).toBeNull();
    expect(feedOf_path('/home/u/feeds/feed_12/pl-dircopy_34/data')).toBe(12);
    expect(feedOf_path('/proc/jobs/feed_7')).toBe(7);
    expect(feedOf_path('/home/u/uploads')).toBeNull();
    expect(path_isProjection('/proc/jobs')).toBe(true);
    expect(path_isProjection('/usr/share')).toBe(true);
    expect(path_isProjection('/home/u/procs')).toBe(false);
    expect(TABLE_FILE_PATTERN.test('a.CSV')).toBe(true);
    expect(TABLE_FILE_PATTERN.test('a.csv.gz')).toBe(false);
  });
});

describe('ansi_strip', () => {
  it('drops escape sequences and keeps the words', () => {
    expect(ansi_strip('\x1b[31mred\x1b[0m plain')).toBe('red plain');
  });
});

describe('shares_read', () => {
  const outcome_make = (envelopes: unknown[]): ExecuteOutcome => ({ envelopes } as unknown as ExecuteOutcome);

  it('reads the identities out of the acl model, says nobody, or that it could not read', () => {
    expect(shares_read(outcome_make([{ model: { kind: 'fs.acl', data: [{ usernames: ['ann', 'bo'] }, { usernames: ['cy'] }] } }]))).toBe('SHARED WITH ann, bo, cy');
    expect(shares_read(outcome_make([{ model: { kind: 'fs.acl', data: [] } }]))).toBe('SHARED WITH NOBODY');
    expect(shares_read(outcome_make([{ model: { kind: 'fs.listing', data: [] } }, { rendered: 'x' }]))).toBe('ACCESS UNREAD');
  });
});
