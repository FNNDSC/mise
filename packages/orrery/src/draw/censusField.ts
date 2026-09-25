/**
 * @file The census: every job of every stage.
 *
 * A stage that stands for many jobs is drawn as a shell of them around its
 * place, each job its own sphere (or, under stars, its own point of light);
 * each job is joined to a job of its parent stage — by tubes that carry
 * the feed's pulses while there are few enough of them, by lines past that.
 * A wave down the graph flares every job of a stage together.
 *
 * @module
 */
import * as THREE from 'three';
import type { NodeState } from '../types/encoding.js';
import { THREAD_OPACITY } from './constants.js';
import { fibonacciPoint_make } from './geometry.js';
import type { Palette } from './palette.js';
import type { StarField } from './starField.js';
import type { StarEntry } from './stars.js';
import { WAVE_STEP_MS } from './timing.js';
import { tubeMode_of, type TubeField } from './tubeField.js';
import { CENSUS_TUBE_CAP, type TubeSpec } from './tubes.js';

/**
 * One stage as the census draws it.
 *
 * @property id - The stage.
 * @property position - Where it stands.
 * @property radius - Its sphere's radius as a single node.
 * @property count - How many jobs it stands for.
 * @property color - Its hue.
 * @property dim - Faint scenery.
 * @property ember - Some of its jobs failed: under stars, drawn solid over the glow.
 * @property state - What it is doing.
 * @property parents - The stages it hangs from.
 * @property ghost - An anchor, not a stage: it counts in the cloud's centre
 *   and in how deep a stage lies, and draws no jobs.
 */
export interface CensusNode {
  id: string;
  position: THREE.Vector3;
  radius: number;
  count: number;
  color: THREE.Color;
  dim: boolean;
  ember: boolean;
  state: NodeState;
  parents: ReadonlyArray<string>;
  ghost?: boolean;
}

/** Where a census cloud stands and how far it reaches, for framing it. */
export interface CensusCloud {
  center: THREE.Vector3;
  radius: number;
}

/** What a census draws with. */
export interface CensusHost {
  parent: THREE.Object3D;
  stars: StarField;
  tubes: TubeField;
  /** The display's pixel ratio, the canvas height in device pixels, the camera's field of view. */
  starsView(): { pixelRatio: number; heightPx: number; fovDeg: number };
}

/** Every job of every stage, drawn. */
export class CensusField {
  private readonly host: CensusHost;
  private mesh: THREE.InstancedMesh | null = null;
  private base: Float32Array | null = null;
  private memberIds: string[] = [];
  private memberPositions: THREE.Vector3[] = [];

  /**
   * @param host - What the census draws with.
   */
  constructor(host: CensusHost) {
    this.host = host;
  }

  /** Whether the census is drawn as instanced spheres (not stars). */
  public drawn(): boolean {
    return this.mesh !== null;
  }

  /** The stage behind each job, in draw order. */
  public ids(): ReadonlyArray<string> {
    return this.memberIds;
  }

  /** Where each job stands, in draw order. */
  public positions(): ReadonlyArray<THREE.Vector3> {
    return this.memberPositions;
  }

  /**
   * Draws the census.
   *
   * @param nodes - The stages.
   * @param starring - Draw jobs as points of light, not spheres.
   * @param palette - The colours.
   * @returns Where the cloud stands and how far it reaches.
   */
  public build(nodes: ReadonlyArray<CensusNode>, starring: boolean, palette: Palette): CensusCloud {
    let total: number = 0;
    for (const node of nodes) if (node.ghost !== true) total += Math.max(1, node.count);
    const geometry: THREE.IcosahedronGeometry = new THREE.IcosahedronGeometry(1, 1);
    const material: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.1 });
    const starred: StarEntry[] = [];
    const instanced: THREE.InstancedMesh = new THREE.InstancedMesh(geometry, material, starring ? 1 : total);
    const color: THREE.Color = new THREE.Color();
    const carrier: THREE.Object3D = new THREE.Object3D();
    const shells: Map<string, THREE.Vector3[]> = new Map();
    const shellRadii: Map<string, number> = new Map();
    let index: number = 0;
    let cloudRadius: number = 1;
    const center: THREE.Vector3 = new THREE.Vector3();
    for (const node of nodes) center.add(node.position);
    center.divideScalar(Math.max(1, nodes.length));

    for (const node of nodes) {
      // An anchor is nobody's job: a census of it would draw a shell of nothing.
      if (node.ghost === true) continue;
      const n: number = Math.max(1, node.count);
      const shellRadius: number = n === 1 ? 0 : node.radius * (1.6 + 0.55 * Math.cbrt(n));
      const memberRadius: number = n === 1 ? node.radius : Math.max(0.06, Math.min(node.radius * 0.5, (2.2 * shellRadius) / Math.sqrt(n)));
      const points: THREE.Vector3[] = [];
      for (let k = 0; k < n; k++) {
        const point: THREE.Vector3 = n === 1 ? node.position.clone() : fibonacciPoint_make(k, n, shellRadius).add(node.position);
        points.push(point);
        color.set(node.color);
        if (starring) {
          starred.push({ id: node.id, position: point, radius: memberRadius, color: color.clone(), dim: node.dim, ember: node.ember });
        } else {
          carrier.position.copy(point);
          carrier.scale.setScalar(memberRadius);
          carrier.updateMatrix();
          instanced.setMatrixAt(index, carrier.matrix);
          instanced.setColorAt(index, color);
        }
        this.memberIds.push(node.id);
        this.memberPositions.push(point);
        index += 1;
        cloudRadius = Math.max(cloudRadius, center.distanceTo(point) + memberRadius);
      }
      shells.set(node.id, points);
      shellRadii.set(node.id, memberRadius);
    }
    if (starring) {
      const view = this.host.starsView();
      this.host.stars.draw(starred, view.pixelRatio, view.heightPx, view.fovDeg);
    } else {
      if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
      this.host.parent.add(instanced);
      this.mesh = instanced;
      this.base = instanced.instanceColor ? Float32Array.from(instanced.instanceColor.array) : null;
    }

    const segments: number[] = [];
    for (const node of nodes) {
      const mine: THREE.Vector3[] = shells.get(node.id) ?? [];
      for (const parentId of node.parents) {
        const theirs: THREE.Vector3[] | undefined = shells.get(parentId);
        if (!theirs || theirs.length === 0) continue;
        for (let k = 0; k < mine.length; k++) {
          const a: THREE.Vector3 | undefined = mine[k];
          const b: THREE.Vector3 | undefined = theirs.length === mine.length ? theirs[k] : theirs[k % theirs.length];
          if (a === undefined || b === undefined) continue;
          segments.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    // Drawn as spheres, a census joins its jobs with the tubes a feed wears,
    // pulses and all — while there are few enough of them to draw.
    const tubeCount: number = segments.length / 6;
    if (!starring && tubeCount > 0 && tubeCount <= CENSUS_TUBE_CAP) {
      this.tubes_build(nodes, shells, shellRadii, palette);
    } else if (segments.length > 0) {
      const edgeGeometry: THREE.BufferGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
      this.host.parent.add(new THREE.LineSegments(
        edgeGeometry,
        starring
          ? new THREE.LineBasicMaterial({ color: palette.edge, transparent: true, opacity: THREAD_OPACITY, blending: THREE.AdditiveBlending, depthWrite: false })
          : new THREE.LineBasicMaterial({ color: palette.edge, transparent: true, opacity: 0.35 }),
      ));
    }
    return { center, radius: cloudRadius };
  }

  /**
   * Flares every job of a stage with the wave, written straight into the
   * instance colours.
   *
   * @param fireAt - When a stage fires, by id; undefined when it does not.
   * @param elapsed - Time since the wave set off.
   * @param pulse - The flare's hue.
   * @param flareMs - How long a flare lasts.
   * @returns The latest a stage fires, so the caller knows when the wave is done.
   */
  public flare(fireAt: (id: string) => number | undefined, elapsed: number, pulse: THREE.Color, flareMs: number): number {
    let peak: number = 0;
    if (this.mesh === null || this.base === null || !this.mesh.instanceColor) return peak;
    const colors: Float32Array = this.mesh.instanceColor.array as Float32Array;
    const base: Float32Array = this.base;
    for (let i = 0; i < this.memberIds.length; i++) {
      const at: number | undefined = fireAt(this.memberIds[i] ?? '');
      if (at === undefined) continue;
      peak = Math.max(peak, at);
      const dt: number = elapsed - at;
      const flare: number = dt >= 0 && dt <= flareMs ? Math.sin((dt / flareMs) * Math.PI) : 0;
      const o: number = i * 3;
      colors[o] = base[o]! + (pulse.r - base[o]!) * flare;
      colors[o + 1] = base[o + 1]! + (pulse.g - base[o + 1]!) * flare;
      colors[o + 2] = base[o + 2]! + (pulse.b - base[o + 2]!) * flare;
    }
    this.mesh.instanceColor.needsUpdate = true;
    return peak;
  }

  /**
   * The stage behind the job a ray meets first; the touched job lights up.
   *
   * @param raycaster - The ray, aimed by the caller.
   * @returns The stage, or null.
   */
  public pick(raycaster: THREE.Raycaster): string | null {
    if (this.mesh === null) return null;
    const hit: THREE.Intersection | undefined = raycaster.intersectObject(this.mesh)[0];
    if (hit === undefined || hit.instanceId === undefined) return null;
    this.mesh.setColorAt(hit.instanceId, new THREE.Color('#ffffff'));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return this.memberIds[hit.instanceId] ?? null;
  }

  /** Forgets everything: the scene is being redrawn. */
  public clear(): void {
    this.mesh = null;
    this.base = null;
    this.memberIds = [];
    this.memberPositions = [];
  }

  /**
   * Joins the jobs with tubes: each to the job of its parent stage it stands
   * against, in the stage's hue (red into a failed one); a live stage
   * streams, a finished run replays with every job of a stage together.
   */
  private tubes_build(
    nodes: ReadonlyArray<CensusNode>,
    shells: ReadonlyMap<string, THREE.Vector3[]>,
    shellRadii: ReadonlyMap<string, number>,
    palette: Palette,
  ): void {
    const byId: Map<string, CensusNode> = new Map(nodes.map((node: CensusNode): [string, CensusNode] => [node.id, node]));
    const depth: Map<string, number> = new Map();
    const depth_of = (id: string, seen: Set<string> = new Set()): number => {
      const known: number | undefined = depth.get(id);
      if (known !== undefined) return known;
      if (seen.has(id)) return 0;
      seen.add(id);
      const parents: string[] = (byId.get(id)?.parents ?? []).filter((p: string): boolean => byId.has(p));
      const d: number = parents.length === 0 ? 0 : 1 + Math.max(...parents.map((p: string): number => depth_of(p, seen)));
      depth.set(id, d);
      return d;
    };
    const bright: THREE.Color = palette.edge.clone().lerp(new THREE.Color('#ffffff'), 0.45);
    const specs: TubeSpec[] = [];
    let deepest: number = 0;
    for (const node of nodes) {
      const mine: THREE.Vector3[] = shells.get(node.id) ?? [];
      for (const parentId of node.parents) {
        const theirs: THREE.Vector3[] | undefined = shells.get(parentId);
        if (!theirs || theirs.length === 0) continue;
        const width: number = Math.max(0.02, Math.min(shellRadii.get(node.id) ?? 0.1, shellRadii.get(parentId) ?? 0.1) * 0.34);
        const start: number = depth_of(parentId) * WAVE_STEP_MS;
        deepest = Math.max(deepest, depth_of(parentId));
        for (let k = 0; k < mine.length; k++) {
          const to: THREE.Vector3 | undefined = mine[k];
          const from: THREE.Vector3 | undefined = theirs.length === mine.length ? theirs[k] : theirs[k % theirs.length];
          if (from === undefined || to === undefined) continue;
          specs.push({ from, to, width, color: node.state === 'failed' ? palette.error : bright, mode: tubeMode_of(node.state), start });
        }
      }
    }
    this.host.tubes.census_build(specs, deepest);
  }
}
