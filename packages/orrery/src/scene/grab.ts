/**
 * @file A grab: one node pulled by the pointer, the molecule reacting (or,
 * under ranked, the node alone peeking out and easing home on release).
 *
 * Owns the drag, the reaction simulation while it is hot, and the eases
 * home; the scene asks it to step each frame and syncs positions when it
 * says they moved. Composed by the scene through small ports.
 */
import * as THREE from 'three';
import { NODE_RADIUS } from '../layout/index.js';
import { PullSimulation, type PullNode } from '../layout/pull.js';
import { DRAG_THRESHOLD_PX, type Picker } from '../controls/index.js';
import type { SpaceNode } from './node.js';
import { moleculeRadii_of } from './settle.js';

/** What a grab reads of the scene. */
export interface GrabPorts {
  picker: Picker;
  camera: THREE.Camera;
  /** The group every mesh stands in; the drag works in its own space. */
  group: THREE.Object3D;
  /** Every drawn sphere and halo, by node id. */
  meshes: () => ReadonlyMap<string, THREE.Mesh>;
  nodes: () => ReadonlyArray<SpaceNode>;
  /** Ranked is deterministic truth: a pull peeks at ONE node and the release returns it home. */
  solo: () => boolean;
  dimensions: () => 2 | 3;
  /** The idle spin pauses while a node is pulled. */
  spin_pause: () => void;
  /** The wall clock (a test hands in its own). */
  now?: () => number;
}

/** The grab in progress: which node, its drag plane, and travel so far. */
interface Drag {
  nodeId: string;
  plane: THREE.Plane;
  startX: number;
  startY: number;
  moved: boolean;
  solo: boolean;
  home: THREE.Vector3;
}

/** A node easing home after a ranked peek: mesh, from, to, start time. */
interface Returning {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  startedAt: number;
}

/** The scene's grab. */
export class GrabSession {
  private drag: Drag | null = null;
  /** The live reaction simulation while (and shortly after) a grab. */
  private pull: PullSimulation | null = null;
  private returns: Returning[] = [];

  /**
   * @param ports - What the grab reads of the scene.
   */
  constructor(private readonly ports: GrabPorts) {}

  /** @returns Whether a node is held. */
  public dragging(): boolean {
    return this.drag !== null;
  }

  /** Forgets the grab and the simulation (a redraw replaces every mesh). */
  public clear(): void {
    this.drag = null;
    this.pull = null;
  }

  /** @returns Where the simulation has every node, when one runs. */
  public positions(): ReadonlyArray<{ id: string; position: [number, number, number] }> {
    return this.pull?.positions() ?? [];
  }

  /**
   * Takes hold of the node under the pointer, if any.
   *
   * @param event - The press.
   * @returns Whether a node was taken.
   */
  public begin(event: PointerEvent): boolean {
    const hit: THREE.Mesh | null = this.ports.picker.mesh_under(event);
    const nodeId: unknown = hit?.userData['nodeId'];
    if (hit === null || typeof nodeId !== 'string') return false;
    // Drag in the plane through the node, facing the camera: intuitive
    // pull, no depth surprises.
    const normal: THREE.Vector3 = this.ports.camera.getWorldDirection(new THREE.Vector3()).negate();
    // The plane runs through the node where it stands in the WORLD: the ray
    // it is cut with is in world space, and the group may be moved and
    // turned (the universe turns about its focus).
    this.ports.group.updateMatrixWorld(true);
    const plane: THREE.Plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.getWorldPosition(new THREE.Vector3()));
    this.drag = {
      nodeId, plane, startX: event.clientX, startY: event.clientY, moved: false,
      solo: this.ports.solo(),
      home: hit.position.clone(),
    };
    return true;
  }

  /**
   * Follows the pointer during a pull: the grabbed node tracks the drag plane.
   *
   * @param event - The move.
   * @returns Whether a mesh moved and positions need syncing.
   */
  public move(event: PointerEvent): boolean {
    if (this.drag === null) return false;
    this.ports.spin_pause();
    if (
      !this.drag.moved &&
      Math.abs(event.clientX - this.drag.startX) + Math.abs(event.clientY - this.drag.startY) >
        DRAG_THRESHOLD_PX
    ) {
      this.drag.moved = true;
      if (!this.drag.solo) this.simulation_begin(this.drag.nodeId);
    }
    if (!this.drag.moved) return false;
    const point: THREE.Vector3 = new THREE.Vector3();
    if (this.ports.picker.ray_aim(event).ray.intersectPlane(this.drag.plane, point) === null) return false;
    // Back into the group's own space, where the node and the simulation
    // live: pinned to a world point, the node leapt away and dragged its
    // whole molecule after it.
    this.ports.group.worldToLocal(point);
    if (this.drag.solo) {
      const mesh: THREE.Mesh | undefined = this.ports.meshes().get(this.drag.nodeId);
      if (mesh === undefined) return false;
      mesh.position.copy(point);
      return true;
    }
    this.pull?.pin([point.x, point.y, point.z]);
    return false;
  }

  /**
   * Releases a pull: the grip opens and the simulation cools to rest.
   *
   * @returns Whether the pull had moved, so its click is swallowed.
   */
  public end(): boolean {
    if (this.drag === null) return false;
    const moved: boolean = this.drag.moved;
    if (this.drag.solo && this.drag.moved) {
      const mesh: THREE.Mesh | undefined = this.ports.meshes().get(this.drag.nodeId);
      if (mesh !== undefined) {
        this.returns.push({ mesh, from: mesh.position.clone(), to: this.drag.home.clone(), startedAt: this.now() });
      }
    }
    this.pull?.release();
    this.drag = null;
    return moved;
  }

  /**
   * One frame: the reaction simulation runs while hot (during a grab, and
   * cooling after release until it settles), and peeked nodes ease home.
   *
   * @returns Whether positions moved and need syncing.
   */
  public step(): boolean {
    const now: number = this.now();
    let moved: boolean = false;
    if (this.pull !== null) {
      if (this.pull.step(this.drag !== null)) moved = true;
      else this.pull = null;
    }
    if (this.returns.length > 0) {
      this.returns = this.returns.filter((entry: Returning): boolean => {
        const t: number = Math.min(1, (now - entry.startedAt) / 300);
        const eased: number = t * t * (3 - 2 * t);
        entry.mesh.position.lerpVectors(entry.from, entry.to, eased);
        return t < 1;
      });
      moved = true;
    }
    return moved;
  }

  /** @returns The wall clock. */
  private now(): number {
    return (this.ports.now ?? Date.now)();
  }

  /**
   * Builds the reaction simulation, from the meshes' current positions with
   * the grabbed node fixed. Deferred to the first real pointer movement: a
   * heated simulation on a mere press would shift nodes out from under the
   * click and dblclick raycasts. Links and charge only — no centering
   * force, or the pull would fight a recentering spring.
   */
  private simulation_begin(nodeId: string): void {
    const nodes: ReadonlyArray<SpaceNode> = this.ports.nodes();
    const radii: Map<string, number> = moleculeRadii_of(nodes);
    const bodies: PullNode[] = [...this.ports.meshes()].map(([id, mesh]: [string, THREE.Mesh]): PullNode => ({
      id,
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      radius: radii.get(id) ?? NODE_RADIUS,
      dim: mesh.userData['dim'] === true,
      halo: mesh.userData['halo'] === true,
    }));
    const edges: Array<{ from: string; to: string }> = [];
    for (const node of nodes) {
      for (const parentId of [...node.parentIds, ...node.joinParentIds]) edges.push({ from: parentId, to: node.id });
    }
    this.pull = new PullSimulation({ grabbed: nodeId, nodes: bodies, edges, dimensions: this.ports.dimensions(), baseRadius: NODE_RADIUS });
  }
}
