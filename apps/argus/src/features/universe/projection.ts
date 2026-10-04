/**
 * @file The UNIVERSE's 3D / 2D block: it acts on what is in view.
 *
 * Inside a feed the scene still holds the whole space, the feed swapped for
 * its graph and the rest dimmed. Flattening all of it flattened the galaxy
 * behind the one molecule the operator was reading. Inside a feed, that feed
 * alone lies flat on the plane facing the eye, the camera framing it again,
 * while the space behind keeps its depth; each feed is entered in 3D (a new
 * graph ends the flat reading). Outside, the whole space flattens.
 *
 * @module
 */

/** How long the camera takes to frame a feed laid flat or stood back up. */
const FLAT_FRAME_MS: number = 600;

/** What the block needs of the scene. */
export interface ProjectionScene {
  projection_get: () => '3d' | '2d';
  projection_set: (projection: '3d' | '2d') => void;
  flat_get: () => boolean;
  flat_set: (ids: ReadonlyArray<string> | null) => void;
  camera_flyToFit: (ids: ReadonlyArray<string>, durationMs: number, onDone: () => void, bulk?: number, margin?: number) => void;
}

/**
 * Flips the projection of what is in view.
 *
 * @param scene - The scene.
 * @param inside - The entered feed's nodes, or null outside a feed.
 * @returns A line for the bar when the flip could not act, else null.
 */
export function projection_flip(scene: ProjectionScene, inside: ReadonlySet<string> | null): string | null {
  if (inside === null) {
    scene.projection_set(scene.projection_get() === '3d' ? '2d' : '3d');
    return null;
  }
  if (scene.projection_get() === '2d') return 'universe: the whole space is 2D; BACK and press 2D to stand it up';
  const ids: string[] = [...inside];
  scene.flat_set(scene.flat_get() ? null : ids);
  // Laid flat or stood up, the feed takes a new extent: frame it again, as the descent did.
  scene.camera_flyToFit(ids, FLAT_FRAME_MS, (): void => undefined, 1, 0.95);
  return null;
}

/**
 * The word the block wears: the projection of what is in view.
 *
 * @param scene - The scene.
 * @param inside - Whether a feed is entered.
 * @returns `2D` or `3D`.
 */
export function projectionWord_of(scene: ProjectionScene, inside: boolean): '2D' | '3D' {
  return scene.projection_get() === '2d' || (inside && scene.flat_get()) ? '2D' : '3D';
}

/**
 * Names on a pane's 3D / 2D block the projection of what is in view.
 *
 * @param pane - The universe pane.
 * @param scene - The scene.
 * @param inside - Whether a feed is entered.
 */
export function projection_paint(pane: HTMLElement | null, scene: ProjectionScene, inside: boolean): void {
  const pill: HTMLElement | null | undefined = pane?.querySelector<HTMLElement>('.universe-projection');
  if (pill !== null && pill !== undefined) pill.textContent = projectionWord_of(scene, inside);
}

/**
 * A press on the block: flips what is in view, says why when it cannot, and
 * names the result on the block.
 *
 * @param pane - The universe pane.
 * @param scene - The scene.
 * @param inside - The entered feed's nodes, or null outside a feed.
 * @param note - Puts a line on the pane's bar.
 */
export function projection_press(pane: HTMLElement | null, scene: ProjectionScene, inside: ReadonlySet<string> | null, note: (line: string) => void): void {
  const refused: string | null = projection_flip(scene, inside);
  if (refused !== null) note(refused);
  projection_paint(pane, scene, inside !== null);
}
