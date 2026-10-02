/**
 * @file The hierarchy settle: a space whose host names its molecules
 * (a hand-off key) settles as a hierarchy — molecules alone, then molecules
 * as bodies — in a worker the surface provides, or on the page without one.
 *
 * Holds the worker and speaks its protocol; the scene hands in the graph
 * and the terms, and gets every node's place back once, or a reason why
 * not. A newer rebuild overtaking the settle ends it unheard.
 */
import * as THREE from 'three';
import {
  NODE_RADIUS,
  layoutEngine_get,
  layoutInput_build,
  type LayoutNode,
  type HierarchyPositions,
  type PhysicsTerms,
} from '../layout/index.js';
import type { Vec3 } from '../types/space.js';
import type { SpaceNode } from './node.js';
import { moleculeRadii_of, type PlacedNode } from './settle.js';

/** How far a hierarchy settle reports: a thousand steps, whatever its ticks. */
export const HIERARCHY_PROGRESS_TOTAL: number = 1000;

/** What one hierarchy settle takes. */
export interface HierarchyAsk<N extends SpaceNode> {
  /** The settle's generation; an answer from an older one is dropped. */
  generation: number;
  nodes: ReadonlyArray<N>;
  /** The feed a node belongs to, naming the molecules. */
  keyOf: (node: N) => string | null;
  /** Where nodes stood last. */
  seeds: ReadonlyMap<string, THREE.Vector3>;
  /** Nodes that stand where their seed put them. */
  frozen: ReadonlySet<string>;
  physics: PhysicsTerms;
  /** The engine's name. */
  arrangement: string;
  progress: (done: number, total: number, nodes: number) => void;
  /** Every node placed; called once, when the settle lands. */
  placed: (placed: PlacedNode[]) => void;
}

/** What the worker answers. */
interface WorkerAnswer {
  generation: number;
  type: 'progress' | 'done' | 'failed';
  fraction?: number;
  positions?: HierarchyPositions;
  reason?: string;
}

/** The scene's hierarchy settle. */
export class HierarchySettle<N extends SpaceNode> {
  /** The layout worker, made on the first big settle and kept. */
  private worker: Worker | null = null;
  private disposed: boolean = false;

  /**
   * @param workerOf - Makes the worker, when the surface provides one.
   * @param generation - The scene's current rebuild; an answer to an older one is dropped.
   */
  constructor(
    private readonly workerOf: (() => Worker) | undefined,
    private readonly generation: () => number,
  ) {}

  /** Ends the worker. */
  public dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
  }

  /**
   * Settles the graph as a hierarchy, reporting progress, and places the
   * answer if no newer settle has overtaken it.
   *
   * @param ask - The settle.
   */
  public run(ask: HierarchyAsk<N>): void {
    const radii: Map<string, number> = moleculeRadii_of(ask.nodes);
    // Built as a session builds it, so a place the session keeps is a place this settle would find.
    const seeds: Map<string, Vec3> = new Map([...ask.seeds].map(([id, at]): [string, Vec3] => [id, [at.x, at.y, at.z]]));
    const nodes: LayoutNode[] = layoutInput_build(ask.nodes, ask.keyOf, seeds, ask.frozen);
    const total: number = HIERARCHY_PROGRESS_TOTAL;
    const count: number = nodes.length;
    ask.progress(0, total, count);
    const placeAll = (positions: HierarchyPositions): void => {
      ask.placed(ask.nodes.map((node: N): PlacedNode => {
        const at: [number, number, number] = positions[node.id] ?? [0, 0, 0];
        return { node, position: new THREE.Vector3(at[0], at[1], at[2]), radius: radii.get(node.id) ?? NODE_RADIUS };
      }));
      ask.progress(total, total, count);
    };
    const stepped = (fraction: number): void => ask.progress(Math.min(total - 1, Math.floor(fraction * total)), total, count);
    if (this.worker === null) {
      if (this.workerOf === undefined) {
        // No worker from the surface: the engine settles on the page.
        const engine = layoutEngine_get(ask.arrangement);
        if (engine === undefined) {
          console.error(`layout: no engine named ${ask.arrangement}`);
          ask.progress(total, total, count);
          return;
        }
        placeAll(engine.run({ nodes, physics: ask.physics }, stepped).positions);
        return;
      }
      this.worker = this.workerOf();
    }
    const worker: Worker = this.worker;
    worker.onmessage = (event: MessageEvent<WorkerAnswer>): void => {
      const answer: WorkerAnswer = event.data;
      if (answer.generation !== this.generation() || this.disposed) return;
      if (answer.type === 'progress') {
        stepped(answer.fraction ?? 0);
        return;
      }
      if (answer.type === 'failed') {
        // An engine the host does not know: the space stays as it stood,
        // and the reason is said, never drawn as every node at the origin.
        console.error(`layout: ${answer.reason ?? 'the engine failed'}`);
        ask.progress(total, total, count);
        return;
      }
      placeAll(answer.positions ?? {});
    };
    worker.postMessage({ generation: ask.generation, nodes, physics: ask.physics, arrangement: ask.arrangement });
  }
}
