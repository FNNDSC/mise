/**
 * @file The pulse wave: a schedule in dependency order over the nodes that
 * fired, a flare that swells and colours a sphere, a loop through the gap
 * when asked, silence otherwise.
 */
import { describe, it, expect } from '@jest/globals';
import * as THREE from 'three';
import { WAVE_STEP_MS } from '../src/draw/index.js';
import { PulseWave, WAVE_FLARE_MS, WAVE_LOOP_GAP_MS, waveSchedule_compute } from '../src/scene/wave.js';
import type { SpaceNode } from '../src/scene/node.js';

function node_make(id: string, parentIds: string[], waved: boolean = true, joinParentIds: string[] = []): SpaceNode {
  return { id, label: id, parentIds, joinParentIds, look: { state: 'done', paint: { token: 'done' }, ember: false, waved } };
}

function mesh_make(): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial());
}

describe('waveSchedule_compute', () => {
  it('fires in dependency order, a join waiting for its last parent', () => {
    const nodes: SpaceNode[] = [
      node_make('c', ['a'], true, ['b']),
      node_make('b', []),
      node_make('a', []),
    ];
    const times: Map<string, number> = waveSchedule_compute(nodes);
    expect(times.get('a')).toBe(0);
    expect(times.get('b')).toBe(0);
    expect(times.get('c')).toBe(WAVE_STEP_MS);
  });

  it('halts at the execution frontier: a node that never ran is absent, and so are its children', () => {
    const nodes: SpaceNode[] = [node_make('a', []), node_make('b', ['a'], false), node_make('c', ['b'])];
    const times: Map<string, number> = waveSchedule_compute(nodes);
    expect([...times.keys()]).toEqual(['a']);
  });

  it('ignores parents outside the graph', () => {
    const times: Map<string, number> = waveSchedule_compute([node_make('a', ['ghost'])]);
    expect(times.get('a')).toBe(0);
  });
});

describe('PulseWave', () => {
  function wave_make(nodes: SpaceNode[], meshes: Map<string, THREE.Mesh>, ambient: boolean = false): { wave: PulseWave<SpaceNode>; tick: (ms: number) => void } {
    let now: number = 10_000;
    const wave: PulseWave<SpaceNode> = new PulseWave<SpaceNode>({
      nodes: () => nodes,
      mesh: (id: string) => meshes.get(id),
      census: () => null,
      selected: () => null,
      ambient,
      now: () => now,
    });
    return { wave, tick: (ms: number): void => { now += ms; } };
  }

  it('swells and colours a sphere at its fire time, and rests it after', () => {
    const nodes: SpaceNode[] = [node_make('a', []), node_make('b', ['a'])];
    const meshes: Map<string, THREE.Mesh> = new Map([['a', mesh_make()], ['b', mesh_make()]]);
    const { wave, tick } = wave_make(nodes, meshes);
    wave.color = new THREE.Color('#ff0000');
    wave.start();
    tick(WAVE_FLARE_MS / 2);
    wave.animate();
    const a: THREE.Mesh = meshes.get('a') as THREE.Mesh;
    const b: THREE.Mesh = meshes.get('b') as THREE.Mesh;
    expect(a.scale.x).toBeCloseTo(1.45, 2);
    expect((a.material as THREE.MeshStandardMaterial).emissive.r).toBe(1);
    // b fires one step later: still at rest.
    expect(b.scale.x).toBe(1);
    tick(WAVE_FLARE_MS);
    wave.animate();
    expect(a.scale.x).toBe(1);
    expect((a.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0);
  });

  it('does not renew when the wave is over and nothing loops', () => {
    const nodes: SpaceNode[] = [node_make('a', [])];
    const meshes: Map<string, THREE.Mesh> = new Map([['a', mesh_make()]]);
    const { wave, tick } = wave_make(nodes, meshes);
    wave.start();
    tick(WAVE_FLARE_MS * 3);
    wave.animate();
    tick(WAVE_LOOP_GAP_MS + WAVE_FLARE_MS / 2);
    wave.animate();
    expect((meshes.get('a') as THREE.Mesh).scale.x).toBe(1);
  });

  it('loops through the gap when looping, and in the ambient miniature', () => {
    for (const [ambient, looping] of [[true, false], [false, true]] as Array<[boolean, boolean]>) {
      const nodes: SpaceNode[] = [node_make('a', [])];
      const meshes: Map<string, THREE.Mesh> = new Map([['a', mesh_make()]]);
      const { wave, tick } = wave_make(nodes, meshes, ambient);
      if (looping) wave.loop_set(true); else wave.start();
      expect(wave.loop_get()).toBe(looping);
      tick(WAVE_FLARE_MS * 2);
      // Over: the next wave is set for after the gap.
      wave.animate();
      tick(WAVE_LOOP_GAP_MS + WAVE_FLARE_MS / 2);
      wave.animate();
      expect((meshes.get('a') as THREE.Mesh).scale.x).toBeGreaterThan(1.4);
    }
  });

  it('starts no wave when no node fired', () => {
    const nodes: SpaceNode[] = [node_make('a', [], false)];
    const meshes: Map<string, THREE.Mesh> = new Map([['a', mesh_make()]]);
    const { wave, tick } = wave_make(nodes, meshes);
    wave.start();
    tick(1);
    wave.animate();
    expect((meshes.get('a') as THREE.Mesh).scale.x).toBe(1);
  });
});
