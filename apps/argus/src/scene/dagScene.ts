/**
 * @file The DAG scene: one three.js rendering of a compute graph.
 *
 * The scene eats a normalized graph — nodes with identity, edges, status,
 * and an optional scalar metric — and knows nothing of feeds, pipelines, or
 * the wire. Both envelope models normalize into it, so one traversal, one
 * picking path, and one palette serve the pane and the header miniature.
 *
 * Layout is a strategy seam:
 * - `ranked` (default): deterministic tiers by graph depth. The same graph
 *   always draws the same picture; the third dimension is presentation.
 * - `molecule`: a d3-force-3d settling, node radii scaled by the metric —
 *   the compute-molecule reading of a pipeline's shape.
 *
 * Colors are read from the live LCARS palette (CSS custom properties), so
 * the THEME pill recolors the scene like everything else.
 *
 * @module
 */
import * as THREE from 'three';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
} from 'd3-force-3d';

/** One node as the scene understands it. */
export interface SceneNode {
  id: string;
  label: string;
  parentIds: string[];
  joinParentIds: string[];
  /** Execution status; undefined for template (authored) nodes. */
  status?: string;
  /** Scalar for molecule radius scaling; undefined = degree fallback. */
  metric?: number;
}

/** The normalized graph the scene renders. */
export interface SceneGraph {
  nodes: SceneNode[];
}

/** The two ways a graph takes shape. */
export type LayoutStrategy = 'ranked' | 'molecule';

/** Callbacks the host wires into picking. */
export interface SceneHandlers {
  select?: (node: SceneNode) => void;
  activate?: (node: SceneNode) => void;
}

/** Rendering options that differ between the pane and the header miniature. */
export interface SceneOptions {
  /** Ambient mode: slower spin, no picking, no selection ring. */
  ambient?: boolean;
}

/** A positioned node during layout. */
interface PlacedNode {
  node: SceneNode;
  position: THREE.Vector3;
  radius: number;
}

/** Base node radius in scene units. */
const NODE_RADIUS: number = 0.55;

/** Vertical distance between ranked tiers. */
const TIER_SPACING: number = 2.6;

/** Horizontal spread between siblings in a tier. */
const SIBLING_SPACING: number = 2.0;

/** Idle rotation speed, radians per frame. */
const SPIN_INTERACTIVE: number = 0.0022;
const SPIN_AMBIENT: number = 0.006;

/**
 * How fast the ambient tumble axis wanders, radians of phase per frame.
 * Well below the spin rate, so the motion reads as one continuous freeform
 * tumble rather than a wobble.
 */
const TUMBLE_DRIFT: number = 0.0035;

/** Statuses grouped for coloring. */
const RUNNING_STATUSES: ReadonlySet<string> = new Set([
  'created', 'waiting', 'scheduled', 'started', 'registeringFiles',
]);

/**
 * Reads the live LCARS palette from the document's computed style.
 *
 * @returns The scene's colors, tracking the active theme.
 */
function palette_read(): {
  running: THREE.Color; done: THREE.Color; error: THREE.Color;
  template: THREE.Color; unknown: THREE.Color; edge: THREE.Color; join: THREE.Color;
} {
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
  };
}

/**
 * Colors one node by its state: errors are always visible, activity is the
 * theme's accent, settled work is quiet, templates wear the gold.
 */
function nodeColor_pick(node: SceneNode, palette: ReturnType<typeof palette_read>): THREE.Color {
  if (node.status === undefined) return palette.template;
  if (node.status === 'finishedWithError' || node.status === 'cancelled') return palette.error;
  if (node.status === 'finishedSuccessfully') return palette.done;
  if (RUNNING_STATUSES.has(node.status)) return palette.running;
  return palette.unknown;
}

/**
 * Deterministic ranked layout: tiers by depth from the roots, siblings
 * spread within a tier, a small depth-hashed z offset for parallax. The
 * same graph always lands the same way.
 */
function layout_ranked(nodes: SceneNode[]): PlacedNode[] {
  const depths: Map<string, number> = new Map();
  const byId: Map<string, SceneNode> = new Map(nodes.map((n: SceneNode) => [n.id, n]));
  const depth_find = (node: SceneNode, trail: Set<string>): number => {
    const known: number | undefined = depths.get(node.id);
    if (known !== undefined) return known;
    if (trail.has(node.id) || node.parentIds.length === 0) {
      depths.set(node.id, 0);
      return 0;
    }
    trail.add(node.id);
    let deepest: number = 0;
    for (const parentId of node.parentIds) {
      const parent: SceneNode | undefined = byId.get(parentId);
      if (parent) deepest = Math.max(deepest, depth_find(parent, trail) + 1);
    }
    depths.set(node.id, deepest);
    return deepest;
  };
  for (const node of nodes) depth_find(node, new Set());

  const tiers: Map<number, SceneNode[]> = new Map();
  for (const node of nodes) {
    const tier: number = depths.get(node.id) ?? 0;
    const members: SceneNode[] = tiers.get(tier) ?? [];
    members.push(node);
    tiers.set(tier, members);
  }

  const placed: PlacedNode[] = [];
  const tierCount: number = tiers.size;
  for (const [tier, members] of tiers) {
    members.sort((a: SceneNode, b: SceneNode) => a.id.localeCompare(b.id));
    members.forEach((node: SceneNode, index: number) => {
      const x: number = (index - (members.length - 1) / 2) * SIBLING_SPACING;
      const y: number = ((tierCount - 1) / 2 - tier) * TIER_SPACING;
      // A stable per-node z from its id keeps depth parallax deterministic.
      let hash: number = 0;
      for (const ch of node.id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
      const z: number = ((hash % 100) / 100 - 0.5) * 1.2;
      placed.push({ node, position: new THREE.Vector3(x, y, z), radius: NODE_RADIUS });
    });
  }
  return placed;
}

/**
 * The compute molecule: a d3-force-3d settling with node radii scaled by
 * the metric (degree when no metric arrived). The graph finds its own
 * shape; scale carries meaning.
 */
function layout_molecule(nodes: SceneNode[]): PlacedNode[] {
  const degree: Map<string, number> = new Map();
  const links: Array<{ source: string; target: string }> = [];
  for (const node of nodes) {
    for (const parentId of [...node.parentIds, ...node.joinParentIds]) {
      links.push({ source: parentId, target: node.id });
      degree.set(parentId, (degree.get(parentId) ?? 0) + 1);
      degree.set(node.id, (degree.get(node.id) ?? 0) + 1);
    }
  }
  const metrics: number[] = nodes.map(
    (n: SceneNode): number => n.metric ?? degree.get(n.id) ?? 1,
  );
  const metricPeak: number = Math.max(...metrics, 1);

  const simNodes: Array<{ id: string; x?: number; y?: number; z?: number }> =
    nodes.map((n: SceneNode) => ({ id: n.id }));
  const simulation = forceSimulation(simNodes, 3)
    .force('link', forceLink(links).id((d: { id: string }) => d.id).distance(2.2))
    .force('charge', forceManyBody().strength(-6))
    .force('center', forceCenter(0, 0, 0))
    .stop();
  for (let tick: number = 0; tick < 150; tick++) simulation.tick();

  return nodes.map((node: SceneNode, index: number): PlacedNode => {
    const sim = simNodes[index];
    const scale: number = 0.5 + ((metrics[index] ?? 1) / metricPeak) * 1.2;
    return {
      node,
      position: new THREE.Vector3(sim?.x ?? 0, sim?.y ?? 0, sim?.z ?? 0),
      radius: NODE_RADIUS * scale,
    };
  });
}

/**
 * One live DAG rendering bound to a container element.
 */
export class DagScene {
  private readonly container: HTMLElement;
  private readonly handlers: SceneHandlers;
  private readonly ambient: boolean;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly group: THREE.Group = new THREE.Group();
  private readonly raycaster: THREE.Raycaster = new THREE.Raycaster();
  private meshes: Map<string, THREE.Mesh> = new Map();
  private graph: SceneGraph = { nodes: [] };
  private strategy: LayoutStrategy = 'ranked';
  private selectedId: string | null = null;
  private frameHandle: number | null = null;
  private disposed: boolean = false;
  /** The ambient tumble's wandering rotation axis, reused across frames. */
  private readonly tumbleAxis: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  /** Phase driving the axis wander; seeded randomly so miniatures desync. */
  private tumblePhase: number = Math.random() * Math.PI * 2;

  /**
   * @param container - The element the canvas fills.
   * @param handlers - Picking callbacks (ignored in ambient mode).
   * @param options - Pane vs miniature behavior.
   */
  constructor(container: HTMLElement, handlers: SceneHandlers = {}, options: SceneOptions = {}) {
    this.container = container;
    this.handlers = handlers;
    this.ambient = options.ambient === true;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.position.set(0, 0, 14);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key: THREE.DirectionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(4, 6, 8);
    this.scene.add(key);
    this.scene.add(this.group);
    container.appendChild(this.renderer.domElement);
    this.size_fit();
    if (!this.ambient) {
      this.renderer.domElement.addEventListener('click', (event: MouseEvent): void =>
        this.pick_handle(event, 'select'),
      );
      this.renderer.domElement.addEventListener('dblclick', (event: MouseEvent): void =>
        this.pick_handle(event, 'activate'),
      );
    }
    const animate = (): void => {
      if (this.disposed) return;
      if (this.ambient) {
        // Freeform tumble: constant angular speed around an axis that itself
        // drifts slowly, so the graph turns through every orientation instead
        // of orbiting one axis. Incommensurate frequencies keep the wander
        // from ever settling into a repeating figure.
        this.tumblePhase += TUMBLE_DRIFT;
        this.tumbleAxis
          .set(
            Math.sin(this.tumblePhase * 0.7),
            Math.cos(this.tumblePhase * 0.4) + 0.6,
            Math.sin(this.tumblePhase * 0.3) * 0.8,
          )
          .normalize();
        this.group.rotateOnWorldAxis(this.tumbleAxis, SPIN_AMBIENT);
      } else {
        this.group.rotation.y += SPIN_INTERACTIVE;
      }
      this.renderer.render(this.scene, this.camera);
      this.frameHandle = window.requestAnimationFrame(animate);
    };
    animate();
  }

  /**
   * Replaces the rendered graph. Layout runs under the current strategy.
   *
   * @param graph - The normalized graph.
   */
  public graph_set(graph: SceneGraph): void {
    this.graph = graph;
    this.rebuild();
  }

  /**
   * Switches the layout strategy and re-lays the current graph.
   *
   * @param strategy - Ranked tiers or the force-settled molecule.
   */
  public strategy_set(strategy: LayoutStrategy): void {
    this.strategy = strategy;
    this.rebuild();
  }

  /** @returns The active layout strategy. */
  public strategy_get(): LayoutStrategy {
    return this.strategy;
  }

  /**
   * Updates one node's status in place (progress-channel driven) without
   * re-laying the graph.
   *
   * @param nodeId - The node whose status changed.
   * @param status - The new status.
   */
  public status_update(nodeId: string, status: string): void {
    const node: SceneNode | undefined = this.graph.nodes.find((n: SceneNode) => n.id === nodeId);
    if (!node) return;
    node.status = status;
    const mesh: THREE.Mesh | undefined = this.meshes.get(nodeId);
    if (mesh && mesh.material instanceof THREE.MeshStandardMaterial) {
      mesh.material.color = nodeColor_pick(node, palette_read());
    }
  }

  /** Re-reads the palette (the THEME pill changed) and repaints. */
  public palette_refresh(): void {
    this.rebuild();
  }

  /** Fits the renderer to the container's current box. */
  public size_fit(): void {
    const width: number = Math.max(1, this.container.clientWidth);
    const height: number = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Tears the scene down and releases the GL context. */
  public dispose(): void {
    this.disposed = true;
    if (this.frameHandle !== null) window.cancelAnimationFrame(this.frameHandle);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** Rebuilds meshes and edges from the current graph and strategy. */
  private rebuild(): void {
    this.group.clear();
    this.meshes = new Map();
    const palette = palette_read();
    const placed: PlacedNode[] =
      this.strategy === 'molecule' ? layout_molecule(this.graph.nodes) : layout_ranked(this.graph.nodes);
    const byId: Map<string, PlacedNode> = new Map(placed.map((p: PlacedNode) => [p.node.id, p]));

    for (const { node, position, radius } of placed) {
      const geometry: THREE.SphereGeometry = new THREE.SphereGeometry(radius, 24, 18);
      const material: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
        color: nodeColor_pick(node, palette),
        roughness: 0.35,
        metalness: 0.15,
        emissive: node.id === this.selectedId ? new THREE.Color('#ffffff') : new THREE.Color('#000000'),
        emissiveIntensity: node.id === this.selectedId ? 0.35 : 0,
      });
      const mesh: THREE.Mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.userData['nodeId'] = node.id;
      this.group.add(mesh);
      this.meshes.set(node.id, mesh);
    }

    for (const { node, position } of placed) {
      for (const parentId of node.parentIds) {
        const parent: PlacedNode | undefined = byId.get(parentId);
        if (parent) this.edge_add(parent.position, position, palette.edge, false);
      }
      for (const joinId of node.joinParentIds) {
        const parent: PlacedNode | undefined = byId.get(joinId);
        if (parent) this.edge_add(parent.position, position, palette.join, true);
      }
    }

    // Frame the graph: pull the camera back far enough to hold it all.
    const span: number = placed.reduce(
      (widest: number, p: PlacedNode) => Math.max(widest, p.position.length() + 2), 6,
    );
    this.camera.position.z = span * 1.9;
  }

  /** Adds one edge line; joins are dashed. */
  private edge_add(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, dashed: boolean): void {
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    if (dashed) {
      const material: THREE.LineDashedMaterial = new THREE.LineDashedMaterial({
        color, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.9,
      });
      const line: THREE.Line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      this.group.add(line);
      return;
    }
    const material: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.75,
    });
    this.group.add(new THREE.Line(geometry, material));
  }

  /** Resolves a pointer event to a node and fires the matching handler. */
  private pick_handle(event: MouseEvent, kind: 'select' | 'activate'): void {
    const bounds: DOMRect = this.renderer.domElement.getBoundingClientRect();
    const pointer: THREE.Vector2 = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hits: THREE.Intersection[] = this.raycaster.intersectObjects([...this.meshes.values()]);
    const nodeId: unknown = hits[0]?.object.userData['nodeId'];
    if (typeof nodeId !== 'string') return;
    const node: SceneNode | undefined = this.graph.nodes.find((n: SceneNode) => n.id === nodeId);
    if (!node) return;
    if (kind === 'select') {
      this.selectedId = nodeId;
      this.rebuild();
      this.handlers.select?.(node);
    } else {
      this.handlers.activate?.(node);
    }
  }
}
