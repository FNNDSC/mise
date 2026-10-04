import { describe, expect, it } from '@jest/globals';
import { projection_flip, projectionWord_of, type ProjectionScene } from '../../src/features/universe/projection.js';

function scene_make(projection: '3d' | '2d' = '3d'): ProjectionScene & { flat: ReadonlyArray<string> | null; framed: number } {
  const scene = {
    projection,
    flat: null as ReadonlyArray<string> | null,
    framed: 0,
    projection_get: (): '3d' | '2d' => scene.projection,
    projection_set: (next: '3d' | '2d'): void => { scene.projection = next; },
    flat_get: (): boolean => scene.flat !== null,
    flat_set: (ids: ReadonlyArray<string> | null): void => { scene.flat = ids; },
    camera_flyToFit: (): void => { scene.framed += 1; },
  };
  return scene;
}

describe('the UNIVERSE 3D / 2D block', () => {
  it('outside a feed flattens the whole space', () => {
    const scene = scene_make();
    expect(projection_flip(scene, null)).toBeNull();
    expect(scene.projection_get()).toBe('2d');
    expect(scene.flat).toBeNull();
    expect(projectionWord_of(scene, false)).toBe('2D');
  });

  it('inside a feed lays only that feed flat, frames it, and stands it back up', () => {
    const scene = scene_make();
    projection_flip(scene, new Set(['feed:1:a', 'feed:1:b']));
    expect(scene.projection_get()).toBe('3d');
    expect(scene.flat).toEqual(['feed:1:a', 'feed:1:b']);
    expect(scene.framed).toBe(1);
    expect(projectionWord_of(scene, true)).toBe('2D');
    projection_flip(scene, new Set(['feed:1:a', 'feed:1:b']));
    expect(scene.flat).toBeNull();
    expect(projectionWord_of(scene, true)).toBe('3D');
  });

  it('inside a feed of a flat space says how to stand it up', () => {
    const scene = scene_make('2d');
    expect(projection_flip(scene, new Set(['feed:1:a']))).toMatch(/BACK/);
    expect(scene.flat).toBeNull();
  });
});
