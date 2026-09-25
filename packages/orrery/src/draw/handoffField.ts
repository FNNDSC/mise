/**
 * @file The hand-off between stars and spheres.
 *
 * From afar a molecule is stars; as the camera closes on it — its nearest
 * sphere spanning more than a few pixels — it crossfades to lit spheres in
 * their tubes, its threads rising to edges; drawing back, it fades to stars
 * again and its spheres are let go. A gap between the two thresholds keeps
 * a molecule at the edge from flickering.
 *
 * @module
 */
import * as THREE from 'three';
import { HANDOFF_FADE_MS, HANDOFF_SOLID_PX, HANDOFF_STAR_PX } from './handoff.js';
import type { SphereField } from './sphereField.js';
import type { StarField } from './starField.js';
import type { StarEntry } from './stars.js';
import type { TubeField } from './tubeField.js';

/**
 * One molecule in the hand-off: its stars, where it stands, how far it is
 * between stars (0) and spheres (1), and the spheres and tubes that exist
 * only while it is solid.
 */
interface HandoffGroup {
  entries: StarEntry[];
  center: THREE.Vector3;
  maxRadius: number;
  mix: number;
  target: number;
  meshes: THREE.Mesh[];
  tubes: THREE.InstancedMesh | null;
  threadSegments: number[];
}

/** How a solid sphere is drawn for a node: where, how large, what hue. */
export interface HandoffLook {
  position: THREE.Vector3;
  radius: number;
  color: THREE.Color;
}

/** What the hand-off draws with. */
export interface HandoffHost {
  spheres: SphereField;
  stars: StarField;
  tubes: TubeField;
  /** How a node's sphere is drawn, when it turns solid. */
  look(id: string): HandoffLook | undefined;
}

/** Every molecule's place between stars and spheres. */
export class HandoffField {
  private readonly host: HandoffHost;
  private groups: Map<string, HandoffGroup> = new Map();
  private lastAt: number = 0;

  /**
   * @param host - What the hand-off draws with.
   */
  constructor(host: HandoffHost) {
    this.host = host;
  }

  /** How many molecules take part. */
  public size(): number {
    return this.groups.size;
  }

  /** How many are solid, or on their way. */
  public solidCount(): number {
    let count: number = 0;
    for (const group of this.groups.values()) if (group.mix > 0) count += 1;
    return count;
  }

  /**
   * Gathers drawn stars into molecules. A dimmed star is scenery and never
   * turns solid.
   *
   * @param starred - The stars as drawn.
   * @param keyOf - The molecule a node belongs to, or null for none.
   */
  public gather(starred: ReadonlyArray<StarEntry>, keyOf: (id: string) => string | null): void {
    for (const entry of starred) {
      if (entry.dim) continue;
      const key: string | null = keyOf(entry.id);
      if (key === null) continue;
      let group: HandoffGroup | undefined = this.groups.get(key);
      if (group === undefined) {
        group = { entries: [], center: new THREE.Vector3(), maxRadius: 0, mix: 0, target: 0, meshes: [], tubes: null, threadSegments: [] };
        this.groups.set(key, group);
      }
      group.entries.push(entry);
      group.maxRadius = Math.max(group.maxRadius, entry.radius);
    }
    for (const group of this.groups.values()) {
      for (const entry of group.entries) group.center.add(entry.position);
      group.center.divideScalar(Math.max(1, group.entries.length));
    }
  }

  /**
   * Notes that a thread belongs to a molecule, so it fades as the
   * molecule turns solid.
   *
   * @param key - The molecule.
   * @param segment - The thread's segment.
   */
  public thread_note(key: string, segment: number): void {
    this.groups.get(key)?.threadSegments.push(segment);
  }

  /**
   * Steps the hand-off once a frame.
   *
   * @param view - The camera's view of the field (camera inverse × the field's world).
   * @param perUnit - Pixels per unit of size at unit depth.
   * @param now - This frame's time.
   */
  public step(view: THREE.Matrix4, perUnit: number, now: number): void {
    if (this.groups.size === 0) return;
    const dt: number = this.lastAt === 0 ? 0 : Math.min(100, now - this.lastAt);
    this.lastAt = now;
    const v: number[] = view.elements;
    for (const group of this.groups.values()) {
      // Its nearest sphere decides: a sprawling molecule with one sphere at
      // the camera turns solid, rather than leaving that sphere a swelling star.
      let depth: number = Infinity;
      for (const entry of group.entries) {
        const p: THREE.Vector3 = entry.position;
        const d: number = -(v[2]! * p.x + v[6]! * p.y + v[10]! * p.z + v[14]!);
        if (d > 0 && d < depth) depth = d;
      }
      const px: number = depth === Infinity ? 0 : (2 * group.maxRadius * perUnit) / depth;
      if (group.target === 0 && px > HANDOFF_SOLID_PX) group.target = 1;
      else if (group.target === 1 && px < HANDOFF_STAR_PX) group.target = 0;
      if (group.mix === group.target) continue;
      const step: number = dt === 0 ? 1 : dt / HANDOFF_FADE_MS;
      group.mix = group.target > group.mix ? Math.min(1, group.mix + step) : Math.max(0, group.mix - step);
      if (group.mix > 0 && group.meshes.length === 0) this.solid_build(group);
      for (const mesh of group.meshes) {
        if (mesh.material instanceof THREE.MeshStandardMaterial) mesh.material.opacity = group.mix;
      }
      if (group.tubes !== null && group.tubes.material instanceof THREE.ShaderMaterial) {
        const opacity = group.tubes.material.uniforms['opacity'];
        if (opacity !== undefined) opacity.value = group.mix;
      }
      this.host.stars.stars_fade(group.entries, 1 - group.mix);
      this.host.stars.threads_fade(group.threadSegments, 1 - group.mix);
      if (group.mix === 0) this.solid_release(group);
    }
    this.host.stars.flush();
  }

  /** Forgets everything: the scene is being redrawn. */
  public clear(): void {
    this.groups = new Map();
  }

  /** Draws a molecule's spheres and tubes for its time as solid. */
  private solid_build(group: HandoffGroup): void {
    const members: Set<string> = new Set(group.entries.map((entry: StarEntry): string => entry.id));
    for (const entry of group.entries) {
      const look: HandoffLook | undefined = this.host.look(entry.id);
      if (look === undefined) continue;
      group.meshes.push(this.host.spheres.sphere_add(entry.id, look.position, look.radius, { color: look.color, fade: group.mix }));
    }
    this.host.tubes.build(group, group.entries.map((entry: StarEntry): string => entry.id), members);
  }

  /** Lets a molecule's spheres and tubes go once it is stars again. */
  private solid_release(group: HandoffGroup): void {
    for (const mesh of group.meshes) this.host.spheres.remove(mesh);
    if (group.tubes !== null) {
      this.host.tubes.release(group.tubes);
      group.tubes = null;
    }
    group.meshes = [];
  }
}
