/**
 * @file The feed view's modes, the device's memory of them, and the words its pills read.
 */
import { describe, it, expect } from '@jest/globals';
import { FEED_MODES_DEFAULT, feedModes_read, feedModes_write, feedModes_press, feedPill_words, feedShape_same, feedStatuses_patch, type FeedModeStore, type FeedModes, type FeedVerb } from '../../src/features/feed/view.js';
import type { FeedDagModel } from '@fnndsc/menu';

function store_fake(seed: Record<string, string> = {}): FeedModeStore & { map: Map<string, string> } {
  const map: Map<string, string> = new Map(Object.entries(seed));
  return { map, getItem: (key: string): string | null => map.get(key) ?? null, setItem: (key: string, value: string): void => { map.set(key, value); } };
}

describe('the feed view\'s modes', () => {
  it('open as the tree, root on top, lit as spheres, sized by time, coloured by status, quiet', () => {
    expect(FEED_MODES_DEFAULT).toEqual({ strategy: 'ranked', projection: '3d', pulse: false, metric: 'time', hue: 'status', census: false, gravity: false, draw: 'spheres' });
    expect(feedModes_read(null)).toEqual(FEED_MODES_DEFAULT);
  });

  it('are remembered per device and come back, a word that is not a mode\'s falling back to its default', () => {
    const store = store_fake();
    const chosen: FeedModes = { ...FEED_MODES_DEFAULT, strategy: 'molecule', draw: 'stars', pulse: true, hue: 'compute' };
    feedModes_write(store, chosen);
    expect(feedModes_read(store)).toEqual(chosen);
    const odd = store_fake({ 'argus.feedview': JSON.stringify({ strategy: 'spiral', draw: 'stars', pulse: 'yes', metric: 'size' }) });
    expect(feedModes_read(odd)).toEqual({ ...FEED_MODES_DEFAULT, draw: 'stars', metric: 'size' });
    expect(feedModes_read(store_fake({ 'argus.feedview': '{not json' }))).toEqual(FEED_MODES_DEFAULT);
  });

  it('a store that refuses forgets without breaking the press', () => {
    const refusing: FeedModeStore = { getItem: (): string | null => null, setItem: (): void => { throw new Error('quota'); } };
    expect(() => feedModes_write(refusing, FEED_MODES_DEFAULT)).not.toThrow();
  });

  it('each press turns one mode and back, and the pill reads the state, as the RUNS pane always said it', () => {
    const verbs: FeedVerb[] = ['strategy', 'projection', 'pulse', 'metric', 'hue', 'census', 'gravity', 'draw'];
    const words: Record<FeedVerb, [string, string]> = {
      strategy: ['RANKED', 'MOLECULE'], projection: ['3D', '2D'], pulse: ['PULSE OFF', 'PULSE ON'], metric: ['TIME', 'SIZE'],
      hue: ['STATUS', 'COMPUTE'], census: ['SHAPE', 'CENSUS'], gravity: ['GRAVITY OFF', 'GRAVITY ON'], draw: ['SPHERES', 'STARS'],
    };
    for (const verb of verbs) {
      const once: FeedModes = feedModes_press(verb, FEED_MODES_DEFAULT);
      expect(feedPill_words(verb, FEED_MODES_DEFAULT)).toBe(words[verb][0]);
      expect(feedPill_words(verb, once)).toBe(words[verb][1]);
      expect(feedModes_press(verb, once)).toEqual(FEED_MODES_DEFAULT);
    }
  });
});

describe('live in both doors', () => {
  const node = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, label: id, parentIds: [], joinParentIds: [], instanceId: 1, pluginName: id, status, vfsPath: `/f/${id}`, ...extra });
  const before = { feedId: 7, feedName: 'f', nodes: [node('a', 'started'), node('b', 'started', { parentIds: ['a'], tally: { count: 4, done: 1, error: 0, running: 3, other: 0 } })] } as unknown as FeedDagModel;

  it('a fresh model that only moved statuses is the same shape; a new node or count is not', () => {
    const moved = { ...before, nodes: [node('a', 'finishedSuccessfully'), node('b', 'started', { parentIds: ['a'], tally: { count: 4, done: 3, error: 0, running: 1, other: 0 } })] } as unknown as FeedDagModel;
    expect(feedShape_same(before, moved)).toBe(true);
    const grown = { ...before, nodes: [...before.nodes, node('c', 'scheduled', { parentIds: ['b'] })] } as unknown as FeedDagModel;
    expect(feedShape_same(before, grown)).toBe(false);
    const recount = { ...before, nodes: [node('a', 'started'), node('b', 'started', { parentIds: ['a'], tally: { count: 5, done: 1, error: 0, running: 4, other: 0 } })] } as unknown as FeedDagModel;
    expect(feedShape_same(before, recount)).toBe(false);
  });

  it('patches each node\'s status under the door\'s ids: the kernel\'s for RUNS, scoped for the universe', () => {
    const seen: string[] = [];
    const scene = { status_update: (id: string, status: string): void => { seen.push(`${id}=${status}`); } };
    feedStatuses_patch(scene, before);
    feedStatuses_patch(scene, before, (id: string): string => `inst:7:${id}`);
    expect(seen).toEqual(['a=started', 'b=started', 'inst:7:a=started', 'inst:7:b=started']);
  });
});
