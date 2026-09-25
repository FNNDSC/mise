/**
 * @file The colours a drawer is handed. orrery never reads a stylesheet:
 * a surface reads its theme and passes the colours in.
 *
 * @module
 */
import * as THREE from 'three';
import type { Paint } from '../types/encoding.js';

/**
 * The colours of a drawing.
 *
 * @property running - A stage at work.
 * @property done - A stage finished well.
 * @property error - A stage that failed; always visible.
 * @property template - A stage not yet run.
 * @property unknown - A state no other colour names.
 * @property edge - An edge between stages.
 * @property join - An edge that joins two branches.
 * @property root - A graph's origin.
 * @property pulse - The wave's flare.
 */
export interface Palette {
  running: THREE.Color;
  done: THREE.Color;
  error: THREE.Color;
  template: THREE.Color;
  unknown: THREE.Color;
  edge: THREE.Color;
  join: THREE.Color;
  root: THREE.Color;
  pulse: THREE.Color;
}

/** Hues parsed once per distinct value: a space of thousands shares a few. */
const hueCache: Map<string, THREE.Color> = new Map();

/**
 * The colour a paint names, in a palette.
 *
 * @param paint - The paint.
 * @param palette - The colours of the drawing.
 * @returns The colour — shared for a token or a hue, fresh for a blend;
 *   never mutate it.
 */
export function paint_resolve(paint: Paint, palette: Palette): THREE.Color {
  if ('token' in paint) return palette[paint.token];
  if ('hue' in paint) {
    let color: THREE.Color | undefined = hueCache.get(paint.hue);
    if (color === undefined) {
      color = new THREE.Color(paint.hue);
      hueCache.set(paint.hue, color);
    }
    return color;
  }
  const [from, to] = paint.blend;
  return palette[from].clone().lerp(palette[to], Math.max(0, Math.min(1, paint.share)));
}
