/**
 * @file The flights: a frame moves until the camera arrives; a relight
 * holds every node and frames; an unfold seeds the unfolding nodes about
 * the first tier that has a place and freezes the rest; a descent
 * approaches, asks, and either unfolds or stands down when refused.
 */
import { describe, it, expect } from '@jest/globals';
import { Flights, UNFOLD_SCATTER, centre_of, type FlightPorts, type Places } from '../src/scene/flights.js';
import type { SpaceNode } from '../src/scene/node.js';

function node_make(id: string, ghost: boolean = false): SpaceNode {
  return { id, label: id, parentIds: [], joinParentIds: [], look: { state: 'done', paint: { token: 'done' }, ember: false, waved: false }, ...(ghost ? { ghost: true } : {}) };
}

/** A scene that records what the flights asked of it and lands flights on demand. */
function scene_make(places: Places, alive: boolean = true) {
  const log: string[] = [];
  let seeded: Places | null = null;
  let graph: { nodes: SpaceNode[]; frozen: ReadonlyArray<string>; physics: unknown } | null = null;
  const landings: Array<() => void> = [];
  const ports: FlightPorts<SpaceNode> = {
    positions_get: (): Places => ({ ...places }),
    positions_seed: (p: Places): void => { seeded = p; },
    graph_set: (g, options): void => { graph = { nodes: g.nodes, frozen: options.frozen, physics: options.physics }; log.push('graph'); },
    flyToFit: (ids, durationMs, onDone, bulk, margin): void => { log.push(`fit ${[...ids].join(',')} ${durationMs} ${bulk ?? '-'} ${margin ?? '-'}`); landings.push(onDone); },
    flyToward: (id, distance, durationMs, onDone): void => { log.push(`toward ${id} ${distance} ${durationMs}`); landings.push(onDone); },
    alive: () => alive,
    random: () => 0.5,
  };
  return { flights: new Flights<SpaceNode>(ports), log, seeded: () => seeded, graph: () => graph, land: (): void => { landings.shift()?.(); } };
}

describe('centre_of', () => {
  it('takes the first tier with a place, and the origin when none has one', () => {
    const places: Places = { a: [2, 0, 0], b: [4, 0, 0], f: [10, 10, 10] };
    expect(centre_of(places, [['a', 'b'], ['f']])).toEqual([3, 0, 0]);
    expect(centre_of(places, [['x', 'y'], ['f']])).toEqual([10, 10, 10]);
    expect(centre_of(places, [['x'], ['y']])).toEqual([0, 0, 0]);
  });
});

describe('Flights', () => {
  it('moves through a frame and stands still after', () => {
    const { flights, log, land } = scene_make({});
    let done: number = 0;
    expect(flights.moving()).toBe(false);
    flights.frame(['a'], 650, (): void => { done += 1; }, 0.9);
    expect(flights.moving()).toBe(true);
    expect(log).toEqual(['fit a 650 0.9 -']);
    land();
    expect(flights.moving()).toBe(false);
    expect(done).toBe(1);
  });

  it('relights: every node held, drawn before the flight, then framed', () => {
    const { flights, log, graph, land } = scene_make({});
    const order: string[] = [];
    flights.relight({ nodes: [node_make('a'), node_make('b')] }, ['a'], 650, (): void => { order.push('done'); }, (): void => { order.push('drawn'); });
    expect(graph()?.frozen).toEqual(['a', 'b']);
    expect(log).toEqual(['graph', 'fit a 650 - -']);
    expect(order).toEqual(['drawn']);
    land();
    expect(order).toEqual(['drawn', 'done']);
    expect(flights.moving()).toBe(false);
  });

  it('unfolds: the unfolding nodes start about the centre, the rest are frozen, the physics pass', () => {
    const { flights, seeded, graph, log, land } = scene_make({ s1: [2, 2, 2], s2: [4, 4, 4] });
    const order: string[] = [];
    flights.unfold({
      graph: { nodes: [node_make('s1'), node_make('n1'), node_make('n2'), node_make('g', true)] },
      unfolding: ['n1', 'n2'],
      from: [['s1', 's2'], ['fold']],
      physics: { gravity: false },
      frame: ['n1', 'n2'],
      durationMs: 650,
      bulk: 1,
      margin: 0.95,
      drawn: (): void => { order.push('drawn'); },
    }, (): void => { order.push('done'); });
    const half: number = UNFOLD_SCATTER / 2;
    expect(seeded()?.['n1']).toEqual([3 + half, 3 + half, 3 + half]);
    expect(seeded()?.['s1']).toEqual([2, 2, 2]);
    expect(graph()?.frozen).toEqual(['s1', 'g']);
    expect(graph()?.physics).toEqual({ gravity: false });
    expect(log).toEqual(['graph', 'fit n1,n2 650 1 0.95']);
    expect(flights.moving()).toBe(true);
    land();
    expect(order).toEqual(['drawn', 'done']);
    expect(flights.moving()).toBe(false);
  });

  it('descends toward a node, asks, and unfolds the answer', async () => {
    const { flights, log, land } = scene_make({ s1: [1, 0, 0] });
    let done: number = 0;
    flights.descent({ toward: 's1', distance: 14, durationMs: 650 }, async () => ({
      graph: { nodes: [node_make('n1')] }, unfolding: ['n1'], from: [['s1']], frame: ['n1'], durationMs: 650,
    }), (): void => { done += 1; }, (): void => { throw new Error('refused'); });
    expect(log).toEqual(['toward s1 14 650']);
    expect(flights.moving()).toBe(true);
    land();
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(['toward s1 14 650', 'graph', 'fit n1 650 - -']);
    expect(flights.moving()).toBe(true);
    land();
    expect(done).toBe(1);
    expect(flights.moving()).toBe(false);
  });

  it('descends by fitting, and stands down when the ask answers nothing', async () => {
    const { flights, log, land } = scene_make({});
    let refused: number = 0;
    flights.descent({ fit: ['s1', 's2'], durationMs: 650 }, async () => null, (): void => { throw new Error('done'); }, (): void => { refused += 1; });
    expect(log).toEqual(['fit s1,s2 650 - -']);
    land();
    await Promise.resolve();
    await Promise.resolve();
    expect(refused).toBe(1);
    expect(flights.moving()).toBe(false);
  });

  it('a descent whose scene is gone does nothing with the answer', async () => {
    const { flights, log, land } = scene_make({}, false);
    flights.descent({ fit: [], durationMs: 1 }, async () => ({ graph: { nodes: [] }, unfolding: [], from: [], frame: [], durationMs: 1 }), (): void => { throw new Error('done'); }, (): void => { throw new Error('refused'); });
    land();
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(['fit  1 - -']);
  });
});
