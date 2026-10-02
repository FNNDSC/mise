/**
 * @file The pulse wave: nodes flare in dependency order, a join waiting for
 * its last parent. History-honest — only nodes that actually executed
 * (terminal success or error, or an authored template node) fire, so on a
 * running feed the wave halts at the execution frontier.
 *
 * Composed by the scene; it reads the scene through small ports and paints
 * the spheres (or the census cloud) itself, frame by frame.
 */
import * as THREE from 'three';
import { WAVE_STEP_MS, type CensusField } from '../draw/index.js';
import type { SpaceNode } from './node.js';

/** How long one node's wave flare lasts (rise and fall). */
export const WAVE_FLARE_MS: number = 700;
/** Rest between wave loops in the ambient miniature. */
export const WAVE_LOOP_GAP_MS: number = 2_500;

/** What the wave reads of the scene. */
export interface WavePorts<N extends SpaceNode> {
  /** The graph's nodes. */
  nodes: () => ReadonlyArray<N>;
  /** A node's sphere, when it is drawn solid. */
  mesh: (id: string) => THREE.Mesh | undefined;
  /** The census cloud, when the scene draws one. */
  census: () => CensusField | null;
  /** The selected node, whose sphere keeps its ring between flares. */
  selected: () => string | null;
  /** Whether the wave renews on its own (the ambient miniature loops). */
  ambient: boolean;
  /** The wall clock (a test hands in its own). */
  now?: () => number;
}

/**
 * The schedule: node id to flare time, ms into the wave. Relaxation to a
 * fixpoint — cheap at feed scale, and immune to input order.
 *
 * @param nodes - The graph's nodes.
 * @returns When each fired node flares; a node that never executed is absent.
 */
export function waveSchedule_compute(nodes: ReadonlyArray<SpaceNode>): Map<string, number> {
  const times: Map<string, number> = new Map();
  const present: Set<string> = new Set(nodes.map((n: SpaceNode) => n.id));
  const fired = (node: SpaceNode): boolean => node.look.waved;
  let settled: boolean = false;
  while (!settled) {
    settled = true;
    for (const node of nodes) {
      if (times.has(node.id) || !fired(node)) continue;
      const parents: string[] = [...node.parentIds, ...node.joinParentIds].filter(
        (id: string) => present.has(id),
      );
      if (!parents.every((id: string) => times.has(id))) continue;
      const latest: number = parents.reduce(
        (max: number, id: string) => Math.max(max, times.get(id) ?? 0), -WAVE_STEP_MS,
      );
      times.set(node.id, latest + WAVE_STEP_MS);
      settled = false;
    }
  }
  return times;
}

/** The wave the scene runs. */
export class PulseWave<N extends SpaceNode> {
  /** The flare color, re-read from the palette on every rebuild. */
  public color: THREE.Color = new THREE.Color('#48d8f0');
  private times: Map<string, number> = new Map();
  /** Wall-clock start of the running wave, or null when no wave runs. */
  private startAt: number | null = null;
  private looping: boolean = false;

  /**
   * @param ports - What the wave reads of the scene.
   */
  constructor(private readonly ports: WavePorts<N>) {}

  /** Starts the wave from the current graph. */
  public start(): void {
    this.times = waveSchedule_compute(this.ports.nodes());
    this.startAt = this.times.size > 0 ? this.now() : null;
  }

  /**
   * Loops the wave, or lets the current one finish and not renew.
   *
   * @param on - Whether to loop.
   */
  public loop_set(on: boolean): void {
    this.looping = on;
    if (on) this.start();
  }

  /** @returns Whether the wave is looping. */
  public loop_get(): boolean {
    return this.looping;
  }

  /** Applies the wave's flares for this frame; loops in ambient mode. */
  public animate(): void {
    if (this.startAt === null) return;
    const elapsed: number = this.now() - this.startAt;
    let peak: number = 0;
    const census: CensusField | null = this.ports.census();
    if (census !== null) {
      // The wave rides the cloud: every job flares with its stage's fire time.
      peak = census.flare((id: string): number | undefined => this.times.get(id), elapsed, this.color, WAVE_FLARE_MS);
      if (elapsed > peak + WAVE_FLARE_MS) this.startAt = this.renewal();
      return;
    }
    const selected: string | null = this.ports.selected();
    for (const [id, fireAt] of this.times) {
      peak = Math.max(peak, fireAt);
      const mesh: THREE.Mesh | undefined = this.ports.mesh(id);
      if (mesh === undefined || !(mesh.material instanceof THREE.MeshStandardMaterial)) continue;
      const dt: number = elapsed - fireAt;
      const flare: number =
        dt >= 0 && dt <= WAVE_FLARE_MS ? Math.sin((dt / WAVE_FLARE_MS) * Math.PI) : 0;
      // The flare pops in two channels at once: a cool color (white died on
      // the butter of finished nodes) and a size swell.
      mesh.scale.setScalar(1 + flare * 0.45);
      if (flare > 0) {
        mesh.material.emissive.copy(this.color);
        mesh.material.emissiveIntensity = flare * 1.2;
      } else {
        mesh.material.emissive.setScalar(id === selected ? 1 : 0);
        mesh.material.emissiveIntensity = id === selected ? 0.35 : 0;
      }
    }
    // A future start leaves the graph quiet through the gap, then loops.
    if (elapsed > peak + WAVE_FLARE_MS) this.startAt = this.renewal();
  }

  /** @returns The wall clock. */
  private now(): number {
    return (this.ports.now ?? Date.now)();
  }

  /** When the next wave starts after this one: through the gap when looping, never otherwise. */
  private renewal(): number | null {
    return this.ports.ambient || this.looping ? this.now() + WAVE_LOOP_GAP_MS : null;
  }
}
