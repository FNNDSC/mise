/**
 * @file Names in paths: duplicates wear a suffix, the plain name refuses.
 */
import { describe, it, expect } from '@jest/globals';
import { segments_assign, segment_resolve, idSuffix_of, ambiguity_words } from '../src/names.js';

const items = [
  { name: 'node', id: 'ocid1.instance.oc1..aaa111' },
  { name: 'node', id: 'ocid1.instance.oc1..bbb222' },
  { name: 'api', id: 'ocid1.instance.oc1..ccc333' },
];

describe('segments_assign', () => {
  it('gives a unique name plainly and a shared one with the last six of its id', () => {
    expect(idSuffix_of('ocid1.instance.oc1..aaa111')).toBe('aaa111');
    expect(segments_assign(items).map((entry) => entry.segment)).toEqual(['node~aaa111', 'node~bbb222', 'api']);
  });
});

describe('segment_resolve', () => {
  it('finds a plain unique name, a suffixed duplicate, and refuses the plain duplicate naming both', () => {
    expect(segment_resolve(items, 'api')).toEqual({ kind: 'one', item: items[2] });
    expect(segment_resolve(items, 'node~bbb222')).toEqual({ kind: 'one', item: items[1] });
    expect(segment_resolve(items, 'node')).toEqual({ kind: 'ambiguous', segments: ['node~aaa111', 'node~bbb222'] });
    expect(segment_resolve(items, 'nothing')).toEqual({ kind: 'none' });
    expect(ambiguity_words('node', ['node~aaa111', 'node~bbb222'])).toBe('node: ambiguous: node~aaa111, node~bbb222');
  });
});
