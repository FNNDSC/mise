import {
  procCache_get,
  ProcCache,
  ProcFeed,
  ProcInstance,
  status_isTerminal,
  PROC_ARRIVAL_TTL_MS,
} from '../src/cache/procCache';
import { listCache_get } from '../src/cache/listCache';
import { listingInvalidation_flush, listingInvalidation_reset } from '../src/cache/listingInvalidation';

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

    it('annunciates one feed load at a time, earliest first, until cleared', () => {
      expect(cache.feedLoad_get()).toBeNull();
      cache.feedLoad_progress(7, 100, 0);
      cache.feedLoad_progress(9, 5, 50);
      cache.feedLoad_progress(7, 300, 20000);
      expect(cache.feedLoad_get()).toEqual({ feedID: 7, loaded: 300, total: 20000 });
      cache.feedLoad_clear(7);
      expect(cache.feedLoad_get()).toEqual({ feedID: 9, loaded: 5, total: 50 });
      cache.feedLoad_clear(9);
      expect(cache.feedLoad_get()).toBeNull();
    });

    it('keeps roster arrivals for their window and forgets them after', () => {
      cache.arrivals_note([21, 22], 1000);
      expect(cache.arrivals_recent(1000 + PROC_ARRIVAL_TTL_MS)).toEqual([21, 22]);
      cache.arrivals_note([23], 5000);
      expect(cache.arrivals_recent(1000 + PROC_ARRIVAL_TTL_MS + 1)).toEqual([23]);
      expect(cache.arrivals_recent(5000 + PROC_ARRIVAL_TTL_MS + 1)).toEqual([]);
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

  describe('outputPath_match', () => {
    it('returns the closest output directory that contains the CFS path', () => {
      cache.instance_add({ ...inst(1, 7, null, 'pl-root'), outputPath: '/home/alice/outputs' });
      cache.instance_add({ ...inst(2, 7, 1, 'pl-child'), outputPath: '/home/alice/outputs/result-set' });

      expect(cache.outputPath_match('/home/alice/outputs/result-set/metrics/report.json')?.id).toBe(2);
    });

    it('does not match a merely similar output-path prefix', () => {
      cache.instance_add({ ...inst(1, 7, null, 'pl-root'), outputPath: '/home/alice/outputs/run' });

      expect(cache.outputPath_match('/home/alice/outputs/run-old/result.txt')).toBeUndefined();
    });

    it('normalizes a trailing slash on the current CFS path', () => {
      cache.instance_add({ ...inst(1, 7, null, 'pl-root'), outputPath: '/home/alice/outputs/run' });

      expect(cache.outputPath_match('/home/alice/outputs/run/')?.id).toBe(1);
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

describe('proc movement reaches the folder listings', () => {
  beforeEach(() => {
    listCache_get().cache_invalidate();
    listingInvalidation_reset();
    procCache_get().cache_clear();
  });

  it('dirties a feed\'s listings when a job crosses into a terminal state', () => {
    const cache = procCache_get();
    listCache_get().cache_set('/home/someone/feeds/feed_7/pl-a_1/data', ['out']);
    cache.instance_add({
      id: 1, feedID: 7, parentID: null, pluginName: 'pl-a', status: 'started',
      params: null, joinParentIDs: [],
    } as unknown as ProcInstance);

    cache.status_update(1, 'finishedSuccessfully');
    expect(listingInvalidation_flush()).toEqual(['/home/someone/feeds/feed_7/pl-a_1/data']);
  });

  it('says nothing while a job is merely running, because it has produced nothing to list', () => {
    const cache = procCache_get();
    listCache_get().cache_set('/home/someone/feeds/feed_7/pl-a_1/data', ['out']);
    cache.instance_add({
      id: 1, feedID: 7, parentID: null, pluginName: 'pl-a', status: 'scheduled',
      params: null, joinParentIDs: [],
    } as unknown as ProcInstance);

    cache.status_update(1, 'started');
    expect(listingInvalidation_flush()).toEqual([]);
  });

  /** Declares the three folders for an identity called `someone`. */
  function folders_declare(): void {
    procCache_get().rosterFolders_set({
      owner: 'someone',
      own: '/home/someone/feeds',
      shared: '/SHARED',
      public: '/PUBLIC',
    });
  }

  /** A feed row with an explicit owner and visibility. */
  function feedOwned(id: number, ownerUsername: string, isPublic: boolean = false): ProcFeed {
    return { ...feed(id), ownerUsername, public: isPublic };
  }

  it('dirties only the folder an arriving feed actually appears in', () => {
    const cache = procCache_get();
    folders_declare();
    for (const path of ['/home/someone/feeds', '/SHARED', '/PUBLIC']) {
      listCache_get().cache_set(path, ['before']);
    }

    // A public feed landing on a busy CUBE changes /PUBLIC and nothing else.
    cache.feed_add(feedOwned(4299, 'someone-else', true));
    cache.arrivals_note([4299]);

    const marked: string[] = listingInvalidation_flush();
    expect(marked).toEqual(['/PUBLIC']);
  });

  it('places an owned feed in the identity\'s own folder and a shared one in /SHARED', () => {
    const cache = procCache_get();
    folders_declare();
    for (const path of ['/home/someone/feeds', '/SHARED', '/PUBLIC']) {
      listCache_get().cache_set(path, ['before']);
    }

    cache.feed_add(feedOwned(10, 'someone'));
    cache.feed_add(feedOwned(11, 'someone-else'));
    cache.arrivals_note([10, 11]);

    const marked: string[] = listingInvalidation_flush();
    expect(marked).toContain('/home/someone/feeds');
    expect(marked).toContain('/SHARED');
    expect(marked).not.toContain('/PUBLIC');
  });

  it('marks nothing for a folder a host never declared', () => {
    const cache = procCache_get();
    cache.rosterFolders_set({ owner: 'someone', own: '/home/someone/feeds' });
    listCache_get().cache_set('/home/someone/feeds', ['before']);

    cache.feed_add(feedOwned(12, 'someone-else', true));
    cache.arrivals_note([12]);
    expect(listingInvalidation_flush()).toEqual([]);
  });

  it('dirties the parent folder when a feed vanishes from the roster', () => {
    const cache = procCache_get();
    folders_declare();
    cache.feed_add(feedOwned(5, 'someone'));
    cache.feed_add(feedOwned(6, 'someone'));
    listCache_get().cache_set('/home/someone/feeds', ['feed_5', 'feed_6']);

    // Feed 6 is no longer visible to this identity.
    cache.feeds_reconcile([feedOwned(5, 'someone')]);
    expect(listingInvalidation_flush()).toContain('/home/someone/feeds');
  });

  it('removes a departed feed\'s own listings rather than marking them stale', () => {
    const cache = procCache_get();
    folders_declare();
    cache.feed_add(feedOwned(5, 'someone'));
    cache.feed_add(feedOwned(6, 'someone'));
    listCache_get().cache_set('/home/someone/feeds/feed_6', ['a']);
    listCache_get().cache_set('/home/someone/feeds/feed_6/pl-a_1/data', ['b']);
    listCache_get().cache_set('/home/someone/feeds/feed_5', ['keep']);

    cache.feeds_reconcile([feedOwned(5, 'someone')]);

    // A dirty entry is still served while it refreshes, which would keep
    // showing a tree this identity can no longer reach. It has to go.
    expect(listCache_get().cache_get('/home/someone/feeds/feed_6')).toBeNull();
    expect(listCache_get().cache_get('/home/someone/feeds/feed_6/pl-a_1/data')).toBeNull();
    expect(listCache_get().cache_get('/home/someone/feeds/feed_5')).not.toBeNull();
  });
});
