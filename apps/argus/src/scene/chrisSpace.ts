/**
 * @file ChRIS in the orrery: the one place a compute graph's domain meets
 * the drawing.
 *
 * A pane builds `SceneNode`s — a node's identity and edges, and what ChRIS
 * says of it: its status, the share of a group's jobs that failed, a hue
 * the pane assigns. The orrery knows none of that; it draws a node by its
 * LOOK. `ChrisSpace` is the orrery with that reading done on the way in —
 * every node's look from `chrisLook.ts`, again whenever a status moves on
 * the progress channel — and with the page's own two gifts: the live LCARS
 * palette (so the THEME pill repaints the space) and the layout worker the
 * page's bundle builds.
 *
 * @module
 */
import * as THREE from 'three';
import {
  Orrery,
  PHYSICS_DEFAULT,
  type DrawMode,
  type LayoutStrategy,
  type NodeLook,
  type OrreryHandlers,
  type OrreryOptions,
  type Palette,
  type PhysicsTerms,
  type SettleMode,
  type SpaceNode,
} from '@fnndsc/orrery';
import { chrisLook_of } from './chrisLook.js';

export { PHYSICS_DEFAULT };
export type { DrawMode, LayoutStrategy, PhysicsTerms, SettleMode };

/** One node of a compute graph, as a pane builds it. */
export interface SceneNode extends Omit<SpaceNode, 'look'> {
  /** Execution status; undefined for template (authored) nodes. */
  status?: string;
  /** A hue the pane assigns (a mode's colour, e.g. by compute); errors still win. */
  hue?: string;
  /**
   * The share of a collapsed group that ended in error, 0..1. Hues the
   * sphere between done and error by that share rather than painting a
   * group of eighty thousand red for one failure; absent for a clean group.
   */
  share?: number;
}

/** A node once it has been read: the pane's node, with its look. */
type LookedNode = SceneNode & { look: NodeLook };

/** The graph a pane hands in. */
export interface SceneGraph {
  nodes: SceneNode[];
}

/** What a pane hears back: its own nodes. */
export type SceneHandlers = OrreryHandlers<LookedNode>;

/** Rendering options that differ between the pane and the header miniature. */
export interface SceneOptions {
  /** Ambient mode: slower spin, no picking, no selection ring. */
  ambient?: boolean;
}

/**
 * Reads the live LCARS palette from the document's computed style.
 *
 * @returns The scene's colours, tracking the active theme.
 */
function palette_read(): Palette {
  const style: CSSStyleDeclaration = getComputedStyle(document.documentElement);
  const varColor = (name: string, fallback: string): THREE.Color =>
    new THREE.Color(style.getPropertyValue(name).trim() || fallback);
  return {
    running: varColor('--orange', '#f70'),
    done: varColor('--butter', '#fec'),
    error: new THREE.Color('#f22'),
    template: varColor('--harvestgold', '#fa4'),
    unknown: new THREE.Color('#555'),
    edge: varColor('--pumpkin-pie', '#c50'),
    join: varColor('--honey', '#fc9'),
    // The root wears a cool colour against the warm status palette, so the
    // graph's origin reads at a glance in either layout. Themeable via
    // `--dag-root`; the fallback is the harbor seaglass.
    root: varColor('--dag-root', '#6fbfae'),
    // The wave flares COOL against the warm status palette: a white flare
    // vanished on butter (finished) nodes. Themeable via `--dag-pulse`.
    pulse: varColor('--dag-pulse', '#48d8f0'),
  };
}

/**
 * The orrery, reading ChRIS.
 */
export class ChrisSpace extends Orrery<LookedNode> {
  /** The graph last handed in, by id, for a status that moves. */
  private byId: Map<string, LookedNode> = new Map();

  /**
   * @param container - The element the canvas fills.
   * @param handlers - Picking callbacks (ignored in ambient mode).
   * @param options - Pane vs miniature behaviour.
   */
  constructor(container: HTMLElement, handlers: SceneHandlers = {}, options: SceneOptions = {}) {
    const orrery: OrreryOptions = {
      palette: palette_read,
      // The page's bundle builds the worker; the orrery only speaks to it.
      layoutWorker: (): Worker => new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' }),
    };
    if (options.ambient !== undefined) orrery.ambient = options.ambient;
    super(container, handlers, orrery);
  }

  /**
   * Replaces the rendered graph, every node read for its look first.
   *
   * @param graph - The pane's graph.
   * @param options - How it settles; see {@link Orrery.graph_set}.
   */
  public override graph_set(graph: SceneGraph, options: Parameters<Orrery<LookedNode>['graph_set']>[1] = {}): void {
    const nodes: LookedNode[] = graph.nodes.map((node: SceneNode): LookedNode => Object.assign(node, { look: chrisLook_of(node) }));
    this.byId = new Map(nodes.map((node: LookedNode): [string, LookedNode] => [node.id, node]));
    super.graph_set({ nodes }, options);
  }

  /**
   * One node's status moved (the progress channel): its look is read
   * again, and the space repaints it without re-laying the graph.
   *
   * @param nodeId - The node whose status changed.
   * @param status - The new status.
   */
  public status_update(nodeId: string, status: string): void {
    const node: LookedNode | undefined = this.byId.get(nodeId);
    if (node === undefined || node.status === status) return;
    node.status = status;
    this.look_update(nodeId, chrisLook_of(node));
  }
}
