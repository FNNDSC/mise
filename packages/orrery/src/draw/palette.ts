/**
 * @file The colours a drawer is handed. orrery never reads a stylesheet:
 * a surface reads its theme and passes the colours in.
 *
 * @module
 */
import type * as THREE from 'three';

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
