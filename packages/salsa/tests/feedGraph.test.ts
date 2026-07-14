/**
 * Unit tests for the FeedGraph projection + topology signature. Pure over a seeded
 * ProcCache — no network, no mocks beyond the real cache.
 */
import { procCache_get, ProcCache, ProcFeed, ProcInstance } from '@fnndsc/cumin';
import { feedGraph_build, signature_compute, FeedGraph } from '../src/dag/feedGraph';

const cache: ProcCache = procCache_get();

function feed(id: number, over: Partial<ProcFeed> = {}): ProcFeed {
  return {
    id, title: `feed ${id}`, creationDate: '', finishedJobs: 0, erroredJobs: 0,
    startedJobs: 0, scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0, ...over,
  };
}

function add(
  id: number, feedID: number, parentID: number | null, pluginName: string,
  status: string | null = 'finishedSuccessfully',
): void {
  const inst: ProcInstance = { id, feedID, parentID, pluginName, params: null, status };
  cache.instance_add(inst);
}

beforeEach(() => cache.cache_clear());

describe('signature_compute', () => {
  it('gives isomorphic sibling subtrees equal signatures', () => {
    cache.feed_add(feed(1));
    add(10, 1, null, 'pl-root');
    // Two identical branches: dcm2niix -> pl-x
    add(11, 1, 10, 'pl-dcm2niix'); add(13, 1, 11, 'pl-x');
    add(12, 1, 10, 'pl-dcm2niix'); add(14, 1, 12, 'pl-x');
    // A third, differently-shaped branch: dcm2niix with no child
    add(15, 1, 10, 'pl-dcm2niix');

    const memo = new Map<number, string>();
    expect(signature_compute(cache, 11, memo)).toBe(signature_compute(cache, 12, memo));
    expect(signature_compute(cache, 15, memo)).not.toBe(signature_compute(cache, 11, memo));
  });

  it('excludes status — same topology, different run state, same signature', () => {
    cache.feed_add(feed(1));
    add(10, 1, null, 'pl-root');
    add(11, 1, 10, 'pl-a', 'finishedSuccessfully');
    add(12, 1, 10, 'pl-a', 'finishedWithError');

    const memo = new Map<number, string>();
    expect(signature_compute(cache, 11, memo)).toBe(signature_compute(cache, 12, memo));
  });

  it('is order-independent — children hashed as a multiset', () => {
    cache.feed_add(feed(1));
    // P: children added a-then-b; Q: children added b-then-a
    add(20, 1, null, 'pl-p'); add(21, 1, 20, 'pl-a'); add(22, 1, 20, 'pl-b');
    add(23, 1, null, 'pl-p'); add(24, 1, 23, 'pl-b'); add(25, 1, 23, 'pl-a');

    const memo = new Map<number, string>();
    expect(signature_compute(cache, 20, memo)).toBe(signature_compute(cache, 23, memo));
  });

  it('distinguishes different plugin names at the same shape', () => {
    cache.feed_add(feed(1));
    add(10, 1, null, 'pl-a');
    add(11, 1, null, 'pl-b');
    const memo = new Map<number, string>();
    expect(signature_compute(cache, 10, memo)).not.toBe(signature_compute(cache, 11, memo));
  });
});

describe('feedGraph_build', () => {
  it('returns null for an unknown feed', () => {
    expect(feedGraph_build(999)).toBeNull();
  });

  it('projects a flat graph with parents, status snapshot, roots and counts', () => {
    cache.feed_add(feed(5, { title: 'brain', finishedJobs: 2 }));
    add(10, 5, null, 'pl-dircopy', 'finishedSuccessfully');
    add(11, 5, 10, 'pl-dcm2niix', 'started');

    const g: FeedGraph | null = feedGraph_build(5);
    expect(g).not.toBeNull();
    const graph = g as FeedGraph;
    expect(graph.title).toBe('brain');
    expect(graph.feedStatus).toBe('finishedSuccessfully');
    expect(graph.total).toBe(2);
    expect(graph.shown).toBe(2);
    expect(graph.truncated).toBe(false);
    expect(graph.rootIDs).toEqual([10]);

    const root = graph.nodes.find((n) => n.id === 10)!;
    const child = graph.nodes.find((n) => n.id === 11)!;
    expect(root.parentID).toBeNull();
    expect(child.parentID).toBe(10);
    expect(child.status).toBe('started');
    expect(root.signature).toEqual(expect.any(String));
  });

  it('carries resolved join parents onto the node', () => {
    cache.feed_add(feed(5));
    add(10, 5, null, 'pl-root');
    add(11, 5, 10, 'pl-a');
    add(12, 5, 10, 'pl-topologicalcopy');
    cache.joinParents_update(12, [10, 11]);

    const graph = feedGraph_build(5) as FeedGraph;
    const join = graph.nodes.find((n) => n.id === 12)!;
    const plain = graph.nodes.find((n) => n.id === 11)!;
    expect(join.joinParentIDs).toEqual([10, 11]);
    expect(plain.joinParentIDs).toEqual([]);
  });
});
