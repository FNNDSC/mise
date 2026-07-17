import {
  procCache_get,
  ProcCache,
  ProcFeed,
  ProcInstance,
  status_isTerminal,
} from '../src/cache/procCache';

function feed(id: number, title = `feed ${id}`): ProcFeed {
  return {
    id,
    title,
    ownerUsername: '',
    public: false,
    creationDate: '2026-01-01T00:00:00Z',
    finishedJobs: 0,
    erroredJobs: 0,
    startedJobs: 0,
    scheduledJobs: 0,
    cancelledJobs: 0,
    createdJobs: 0,
  };
}

function inst(
  id: number,
  feedID: number,
  parentID: number | null,
  pluginName = `pl-${id}`,
  status: string | null = 'scheduled'
): ProcInstance {
  return { id, feedID, parentID, pluginName, params: null, status };
}

describe('ProcCache', () => {
  let cache: ProcCache;

  beforeEach(() => {
    cache = procCache_get();
    cache.cache_clear();
  });

  it('procCache_get returns the same singleton instance', () => {
    expect(procCache_get()).toBe(cache);
    expect(ProcCache.instance_get()).toBe(cache);
  });

  describe('feeds', () => {
    it('counts visible feeds in exclusive user, shared, and public scopes', () => {
      cache.feed_add({ ...feed(1), ownerUsername: 'me', public: false });
      cache.feed_add({ ...feed(2), ownerUsername: 'me', public: true });
      cache.feed_add({ ...feed(3), ownerUsername: 'other', public: false });
      cache.feed_add({ ...feed(4), ownerUsername: 'other', public: true });

      expect(cache.feedScopeCounts_get('me')).toEqual({
        user: 2,
        shared: 1,
        public: 1,
        total: 4,
      });
    });

    it('adds, gets, and lists feeds', () => {
      cache.feed_add(feed(1));
      cache.feed_add(feed(2));
      expect(cache.feed_get(1)?.title).toBe('feed 1');
      expect(cache.feedIDs_get().sort()).toEqual([1, 2]);
    });

    it('initialises an empty roots list on add', () => {
      cache.feed_add(feed(1));
      expect(cache.feedRoots_get(1)).toEqual([]);
    });

    it('does not clobber existing roots when a feed is re-added', () => {
      cache.feed_add(feed(1));
      cache.instance_add(inst(10, 1, null));
      cache.feed_add(feed(1)); // re-add
      expect(cache.feedRoots_get(1)).toEqual([10]);
    });

    it('feed_get returns undefined for an unknown feed', () => {
      expect(cache.feed_get(999)).toBeUndefined();
    });

    it('feedRoots_get returns [] for an unknown feed', () => {
      expect(cache.feedRoots_get(999)).toEqual([]);
    });

    it('feed_remove drops the feed and all its instances', () => {
      cache.feed_add(feed(1));
      cache.instance_add(inst(10, 1, null));
      cache.instance_add(inst(11, 1, 10));
      cache.topologyLoaded_mark(1);

      cache.feed_remove(1);

      expect(cache.feed_get(1)).toBeUndefined();
      expect(cache.instance_get(10)).toBeUndefined();
      expect(cache.instance_get(11)).toBeUndefined();
      expect(cache.topologyLoaded_has(1)).toBe(false);
      expect(cache.feedRoots_get(1)).toEqual([]);
    });
  });

  describe('instances', () => {
    it('adds a root instance to feedRoots', () => {
      cache.feed_add(feed(1));
      cache.instance_add(inst(10, 1, null));
      expect(cache.feedRoots_get(1)).toEqual([10]);
      expect(cache.children_get(10)).toEqual([]);
    });

    it('adds a child instance under its parent', () => {
      cache.instance_add(inst(10, 1, null));
      cache.instance_add(inst(11, 1, 10));
      expect(cache.children_get(10)).toEqual([11]);
    });

    it('does not duplicate roots or children on repeated add', () => {
      cache.instance_add(inst(10, 1, null));
      cache.instance_add(inst(10, 1, null));
      cache.instance_add(inst(11, 1, 10));
      cache.instance_add(inst(11, 1, 10));
      expect(cache.feedRoots_get(1)).toEqual([10]);
      expect(cache.children_get(10)).toEqual([11]);
    });

    it('counts instances globally and per feed', () => {
      cache.instance_add(inst(10, 1, null));
      cache.instance_add(inst(11, 1, 10));
      cache.instance_add(inst(20, 2, null));
      expect(cache.instances_count()).toBe(3);
      expect(cache.instancesForFeed_count(1)).toBe(2);
      expect(cache.instancesForFeed_count(2)).toBe(1);
      expect(cache.instancesForFeed_count(99)).toBe(0);
    });

    it('instance_get returns undefined for an unknown id', () => {
      expect(cache.instance_get(404)).toBeUndefined();
    });

    it('instance_remove unlinks a root', () => {
      cache.instance_add(inst(10, 1, null));
      cache.instance_add(inst(20, 1, null));
      cache.instance_remove(10);
      expect(cache.instance_get(10)).toBeUndefined();
      expect(cache.feedRoots_get(1)).toEqual([20]);
    });

    it('instance_remove unlinks a child', () => {
      cache.instance_add(inst(10, 1, null));
      cache.instance_add(inst(11, 1, 10));
      cache.instance_remove(11);
      expect(cache.children_get(10)).toEqual([]);
    });

    it('instance_remove is a no-op for an unknown id', () => {
      cache.instance_add(inst(10, 1, null));
      cache.instance_remove(999);
      expect(cache.instances_count()).toBe(1);
    });

    it('params_update sets params on an existing instance and ignores unknown', () => {
      cache.instance_add(inst(10, 1, null));
      cache.params_update(10, { foo: 'bar' });
      expect(cache.instance_get(10)?.params).toEqual({ foo: 'bar' });
      cache.params_update(999, { x: 1 }); // no throw, no effect
      expect(cache.instance_get(999)).toBeUndefined();
    });
  });

  describe('topology + loading + warmup state', () => {
    it('round-trips a persistent topology snapshot without params or active status', () => {
      cache.feed_add(feed(1));
      cache.instance_add({ ...inst(10, 1, null, 'pl-root', 'started'), params: { secret: 'omit' } });
      cache.instance_add({ ...inst(11, 1, 10, 'pl-child', 'finishedSuccessfully'), joinParentIDs: [7] });
      cache.topologyLoaded_mark(1);

      const snapshot = cache.snapshot_create();
      cache.cache_clear();
      cache.snapshot_restore(snapshot, '2026-07-16T12:00:00.000Z');

      expect(cache.instance_get(10)).toMatchObject({ status: null, params: null });
      expect(cache.instance_get(11)).toMatchObject({ status: 'finishedSuccessfully', joinParentIDs: [7] });
      expect(cache.topologyLoaded_has(1)).toBe(true);
      expect(cache.lifecycle_get()).toEqual({ state: 'restored', checkpointAt: '2026-07-16T12:00:00.000Z' });
    });

    it('reconciles restored visibility and topology against authoritative IDs', () => {
      cache.feed_add(feed(1));
      cache.feed_add(feed(2));
      cache.instance_add(inst(10, 1, null));
      cache.instance_add(inst(20, 2, null));

      cache.feeds_reconcile([feed(2), feed(3)]);
      cache.instance_add(inst(30, 3, null));
      cache.topology_reconcile(new Set([20, 30]));

      expect(cache.feedIDs_get().sort()).toEqual([2, 3]);
      expect(cache.instance_get(10)).toBeUndefined();
      expect(cache.instance_get(20)).toBeDefined();
      expect(cache.instance_get(30)).toBeDefined();
    });
    it('tracks topologyLoaded', () => {
      expect(cache.topologyLoaded_has(1)).toBe(false);
      cache.topologyLoaded_mark(1);
      expect(cache.topologyLoaded_has(1)).toBe(true);
    });

    it('tracks in-flight loading promises', async () => {
      const p = Promise.resolve();
      cache.loading_set(1, p);
      expect(cache.loading_get(1)).toBe(p);
      cache.loading_clear(1);
      expect(cache.loading_get(1)).toBeUndefined();
      await p;
    });

    it('reports warmup progress and completion', () => {
      expect(cache.warmupComplete).toBe(false);
      cache.warmup_progress(3, 10);
      expect(cache.warmupProgress_get()).toEqual({ loaded: 3, total: 10, active: true });

      cache.warmup_complete();
      expect(cache.warmupComplete).toBe(true);
      expect(cache.warmupProgress_get()).toEqual({ loaded: 3, total: 10, active: false });
    });

    it('warmupProgress_get returns a copy, not the internal object', () => {
      const a = cache.warmupProgress_get();
      a.loaded = 999;
      expect(cache.warmupProgress_get().loaded).toBe(0);
    });

    it('tracks the built flag', () => {
      expect(cache.built).toBe(false);
      cache.built_set();
      expect(cache.built).toBe(true);
    });
  });

  describe('path_build', () => {
    it('reconstructs a full path up the parent chain', () => {
      cache.instance_add(inst(1, 1107, null, 'pl-dircopy'));
      cache.instance_add(inst(2, 1107, 1, 'pl-mid'));
      cache.instance_add(inst(3, 1107, 2, 'pl-neurofiles-push'));
      expect(cache.path_build(3)).toBe(
        '/proc/jobs/feed_1107/pl-dircopy_1/pl-mid_2/pl-neurofiles-push_3'
      );
    });

    it('builds a single-segment path for a root instance', () => {
      cache.instance_add(inst(5, 42, null, 'pl-root'));
      expect(cache.path_build(5)).toBe('/proc/jobs/feed_42/pl-root_5');
    });

    it('returns null for an unknown instance', () => {
      expect(cache.path_build(404)).toBeNull();
    });

    it('stops cleanly when a parent link is dangling', () => {
      // parentID points at an instance that is not cached -> loop ends
      cache.instance_add(inst(9, 7, 999, 'pl-orphan'));
      expect(cache.path_build(9)).toBe('/proc/jobs/feed_7/pl-orphan_9');
    });
  });

  describe('search', () => {
    it('feeds_find matches title substrings case-insensitively', () => {
      cache.feed_add(feed(1, 'Brain MRI'));
      cache.feed_add(feed(2, 'spine study'));
      expect(cache.feeds_find('brain').map((f) => f.id)).toEqual([1]);
      expect(cache.feeds_find('STUDY').map((f) => f.id)).toEqual([2]);
      expect(cache.feeds_find('xyz')).toEqual([]);
    });

    it('instances_find resolves an exact numeric id', () => {
      cache.instance_add(inst(64306, 1, null, 'pl-dircopy'));
      expect(cache.instances_find('64306').map((i) => i.id)).toEqual([64306]);
      expect(cache.instances_find('70000')).toEqual([]);
    });

    it('instances_find matches plugin name substrings when not a pure id', () => {
      cache.instance_add(inst(1, 1, null, 'pl-dircopy'));
      cache.instance_add(inst(2, 1, null, 'pl-dcm2niix'));
      expect(cache.instances_find('dcm').map((i) => i.id)).toEqual([2]);
      // '12abc' is not a clean integer -> name search, no match
      expect(cache.instances_find('12abc')).toEqual([]);
    });
  });

  describe('status', () => {
    it('status_isTerminal recognizes settled states only', () => {
      expect(status_isTerminal('finishedSuccessfully')).toBe(true);
      expect(status_isTerminal('finishedWithError')).toBe(true);
      expect(status_isTerminal('cancelled')).toBe(true);
      expect(status_isTerminal('started')).toBe(false);
      expect(status_isTerminal('scheduled')).toBe(false);
      expect(status_isTerminal(null)).toBe(false);
      expect(status_isTerminal(undefined)).toBe(false);
    });

    it('status_update advances an active status', () => {
      cache.instance_add(inst(10, 1, null, 'pl-x', 'scheduled'));
      cache.status_update(10, 'started');
      expect(cache.instance_get(10)?.status).toBe('started');
    });

    it('status_update never overwrites a terminal status', () => {
      cache.instance_add(inst(10, 1, null, 'pl-x', 'finishedSuccessfully'));
      cache.status_update(10, 'started');
      expect(cache.instance_get(10)?.status).toBe('finishedSuccessfully');
    });

    it('status_update is a no-op for an unknown instance', () => {
      cache.status_update(999, 'started');
      expect(cache.instance_get(999)).toBeUndefined();
    });
  });

  describe('join parents', () => {
    it('joinParents_update records ids and joinParents_get reads them', () => {
      cache.instance_add(inst(10, 1, null, 'pl-ts'));
      cache.joinParents_update(10, [3, 7]);
      expect(cache.joinParents_get(10)).toEqual([3, 7]);
    });

    it('joinParents_get defaults to [] when unresolved', () => {
      cache.instance_add(inst(10, 1, null));
      expect(cache.joinParents_get(10)).toEqual([]);
      expect(cache.joinParents_get(999)).toEqual([]);
    });

    it('joinParents_update is a no-op for an unknown instance', () => {
      cache.joinParents_update(999, [1]);
      expect(cache.joinParents_get(999)).toEqual([]);
    });
  });

  describe('feedInstanceIDs_get', () => {
    it('walks the anchor tree breadth-first from roots', () => {
      cache.feed_add(feed(1));
      cache.instance_add(inst(10, 1, null));
      cache.instance_add(inst(11, 1, 10));
      cache.instance_add(inst(12, 1, 10));
      cache.instance_add(inst(13, 1, 11));
      expect(cache.feedInstanceIDs_get(1).sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
    });

    it('returns [] for a feed with no roots', () => {
      expect(cache.feedInstanceIDs_get(42)).toEqual([]);
    });
  });

  it('cache_clear resets everything', () => {
    cache.feed_add(feed(1));
    cache.instance_add(inst(10, 1, null));
    cache.topologyLoaded_mark(1);
    cache.warmup_progress(1, 2);
    cache.built_set();

    cache.cache_clear();

    expect(cache.feedIDs_get()).toEqual([]);
    expect(cache.instances_count()).toBe(0);
    expect(cache.topologyLoaded_has(1)).toBe(false);
    expect(cache.warmupComplete).toBe(false);
    expect(cache.warmupProgress_get()).toEqual({ loaded: 0, total: 0, active: false });
    expect(cache.built).toBe(false);
  });
});
