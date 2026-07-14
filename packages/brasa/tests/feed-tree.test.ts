import { describe, it, expect } from '@jest/globals';
import { feedTree_render } from '../src/builtins/res/feed.tree.render.js';
import type { FeedGraph } from '@fnndsc/salsa';

// eslint-disable-next-line no-control-regex
const strip = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

function graph_fixture(): FeedGraph {
  return {
    feedID: 5, title: 'brain', feedStatus: 'finishedSuccessfully',
    total: 4, shown: 4, truncated: false, rootIDs: [10],
    nodes: [
      { id: 10, pluginName: 'pl-root', parentID: null, signature: 'a', joinParentIDs: [], status: 'finishedSuccessfully' },
      { id: 11, pluginName: 'pl-a', parentID: 10, signature: 'b', joinParentIDs: [], status: 'started' },
      { id: 12, pluginName: 'pl-b', parentID: 10, signature: 'c', joinParentIDs: [], status: 'finishedWithError' },
      { id: 13, pluginName: 'pl-ts', parentID: 12, signature: 'd', joinParentIDs: [11], status: 'finishedSuccessfully' },
    ],
  };
}

describe('feedTree_render', () => {
  it('renders the annotated anchor tree with a join overlay', () => {
    const out = strip(feedTree_render(graph_fixture(), undefined, 0).rendered);
    expect(out).toContain('feed 5');
    expect(out).toContain('"brain"');
    expect(out).toContain('pl-root_10');
    expect(out).toContain('├─ pl-a_11');
    expect(out).toContain('└─ pl-b_12');
    expect(out).toContain('⋈ joins 11'); // ts node's extra parent, annotated
  });

  it('scopes to a subtree with focus', () => {
    const out = strip(feedTree_render(graph_fixture(), 12, 0).rendered);
    expect(out).toContain('pl-b_12');
    expect(out).toContain('pl-ts_13');
    expect(out).not.toContain('pl-root_10');
  });

  it('truncates at maxNodes and notes it', () => {
    const r = feedTree_render(graph_fixture(), undefined, 2);
    expect(r.shown).toBe(2);
    expect(r.truncated).toBe(true);
    expect(strip(r.rendered)).toContain('showing 2');
  });

  it('does not truncate when maxNodes is 0 (unlimited)', () => {
    const r = feedTree_render(graph_fixture(), undefined, 0);
    expect(r.shown).toBe(4);
    expect(r.truncated).toBe(false);
  });

  it('returns an error when the focus node is absent', () => {
    const r = feedTree_render(graph_fixture(), 4242, 0);
    expect(r.error).toContain('not in feed');
    expect(r.rendered).toBe('');
  });
});
