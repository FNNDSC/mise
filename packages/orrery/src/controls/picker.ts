/**
 * @file Picking: what lies under a pointer, however it is drawn.
 *
 * The drawers keep what they draw; the picker asks the scene for it as
 * plain sources — meshes, stars and nebulae as points with a reach, a
 * census that picks by ray — and answers with an id. In order: a solid
 * sphere wins (an entered feed stands as spheres among stars), then a
 * census member, then the nearest star within its drawn size, then a
 * nebula the pointer is inside. A dimmed thing is scenery and takes no
 * pointer; a halo wrapping a cluster is taken only when nothing solid lies
 * along the ray.
 *
 * @module
 */
import * as THREE from 'three';

/** A fingertip is wider than a cursor: the least a star reaches for one. */
export const TOUCH_REACH_PX: number = 14;
/** The least a star reaches for a cursor. */
export const CURSOR_REACH_PX: number = 4;

/** A star as picking needs it: in the world group's own space. */
export interface PickStar {
  id: string;
  position: THREE.Vector3;
  radius: number;
  dim: boolean;
}

/** A nebula as picking needs it: in the world group's own space. */
export interface PickNebula {
  id: string;
  position: THREE.Vector3;
  radius: number;
}

/**
 * What can be picked, asked for at the moment of the pick.
 *
 * @property meshes - Solid spheres; each names its node in `userData.nodeId`
 *   and may be marked `dim` or `halo`.
 * @property stars - Points of light.
 * @property nebulae - Glows a pointer can be inside.
 * @property census - A census that picks by ray, or null when none stands.
 */
export interface PickSources {
  meshes(): Iterable<THREE.Object3D>;
  stars(): Iterable<PickStar>;
  nebulae(): Iterable<PickNebula>;
  census(): { pick(raycaster: THREE.Raycaster): string | null } | null;
}

/** A pointer's place on the page. */
export interface PointerAt {
  clientX: number;
  clientY: number;
}

/**
 * Finds what lies under a pointer.
 */
export class Picker {
  private readonly raycaster: THREE.Raycaster = new THREE.Raycaster();

  /**
   * @param camera - The eye.
   * @param world - The group every drawer hangs from.
   * @param element - The canvas, for where a pointer falls on it.
   * @param sources - What can be picked.
   * @param starGlow - How far a star's glow reaches, in radii: its drawn size.
   */
  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly world: THREE.Object3D,
    private readonly element: { getBoundingClientRect(): DOMRect },
    private readonly sources: PickSources,
    private readonly starGlow: number,
  ) {}

  /**
   * Aims the ray from the eye through the pointer, the world current.
   *
   * @param at - The pointer.
   * @returns The aimed raycaster (shared: read it before the next aim).
   */
  public ray_aim(at: PointerAt): THREE.Raycaster {
    const bounds: DOMRect = this.element.getBoundingClientRect();
    const pointer: THREE.Vector2 = new THREE.Vector2(
      ((at.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((at.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    // A pick can land between a rebuild and its first render, when fresh
    // meshes still carry identity matrices: bring them current.
    this.world.updateMatrixWorld(true);
    this.raycaster.setFromCamera(pointer, this.camera);
    return this.raycaster;
  }

  /**
   * The solid sphere under the pointer. A halo wraps its cluster, so its
   * surface is hit before the spheres inside it: a solid hit anywhere along
   * the ray wins, the halo only when nothing solid is.
   *
   * @param at - The pointer.
   * @returns The mesh, or null.
   */
  public mesh_under(at: PointerAt): THREE.Mesh | null {
    const hits: THREE.Intersection[] = this.ray_aim(at)
      .intersectObjects([...this.sources.meshes()])
      .filter((hit: THREE.Intersection): boolean => hit.object.userData['dim'] !== true);
    const solid: THREE.Intersection | undefined = hits.find((hit: THREE.Intersection): boolean => hit.object.userData['halo'] !== true);
    const object: THREE.Object3D | undefined = (solid ?? hits[0])?.object;
    return object instanceof THREE.Mesh ? object : null;
  }

  /**
   * The node behind the solid sphere under the pointer.
   *
   * @param at - The pointer.
   * @returns Its id, or null.
   */
  public meshNode_under(at: PointerAt): string | null {
    const nodeId: unknown = this.mesh_under(at)?.userData['nodeId'];
    return typeof nodeId === 'string' ? nodeId : null;
  }

  /**
   * The node under the pointer, however it is drawn: a solid sphere, a
   * census member, or a star (or nebula) when nothing solid is.
   *
   * @param at - The pointer.
   * @param touch - Whether a finger is asking: a star reaches farther for one.
   * @returns Its id, or null.
   */
  public node_under(at: PointerAt, touch: boolean): string | null {
    const solid: string | null = this.meshNode_under(at);
    if (solid !== null) return solid;
    const census = this.sources.census();
    if (census !== null) return census.pick(this.ray_aim(at));
    return this.star_under(at, touch);
  }

  /**
   * The star — or, over no star, the nebula — under the pointer, picked in
   * screen space: a star is hit within its drawn size (never less than a
   * few pixels, more for a finger), the nearest centre for its size wins.
   *
   * @param at - The pointer.
   * @param touch - Whether a finger is asking.
   * @returns Its id, or null.
   */
  public star_under(at: PointerAt, touch: boolean): string | null {
    const stars: Iterable<PickStar> = this.sources.stars();
    const nebulae: Iterable<PickNebula> = this.sources.nebulae();
    const bounds: DOMRect = this.element.getBoundingClientRect();
    const px: number = at.clientX - bounds.left;
    const py: number = at.clientY - bounds.top;
    this.world.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    const perUnit: number = bounds.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    // One matrix from the group's space to the screen's, one scratch
    // reading: a census can hold tens of thousands of stars, and this runs
    // on every pointer move.
    const view: THREE.Matrix4 = new THREE.Matrix4().multiplyMatrices(this.camera.matrixWorldInverse, this.world.matrixWorld);
    const clip: THREE.Matrix4 = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, view);
    const e: number[] = clip.elements;
    const v: number[] = view.elements;
    const screen = (p: THREE.Vector3): { x: number; y: number; depth: number } | null => {
      const depth: number = -(v[2]! * p.x + v[6]! * p.y + v[10]! * p.z + v[14]!);
      if (depth <= 0) return null;
      const w: number = e[3]! * p.x + e[7]! * p.y + e[11]! * p.z + e[15]!;
      const x: number = (e[0]! * p.x + e[4]! * p.y + e[8]! * p.z + e[12]!) / w;
      const y: number = (e[1]! * p.x + e[5]! * p.y + e[9]! * p.z + e[13]!) / w;
      return { x: (x + 1) / 2 * bounds.width, y: (1 - y) / 2 * bounds.height, depth };
    };
    const floor: number = touch ? TOUCH_REACH_PX : CURSOR_REACH_PX;
    let best: string | null = null;
    let bestScore: number = Infinity;
    for (const star of stars) {
      if (star.dim) continue;
      const hit = screen(star.position);
      if (hit === null) continue;
      const reach: number = Math.max(floor, (this.starGlow * star.radius * perUnit) / hit.depth);
      const distance: number = Math.hypot(hit.x - px, hit.y - py);
      if (distance > reach) continue;
      const score: number = distance / reach;
      if (score < bestScore) {
        bestScore = score;
        best = star.id;
      }
    }
    if (best !== null) return best;
    for (const nebula of nebulae) {
      const hit = screen(nebula.position);
      if (hit === null) continue;
      if (Math.hypot(hit.x - px, hit.y - py) <= (nebula.radius * perUnit) / hit.depth) return nebula.id;
    }
    return null;
  }
}
