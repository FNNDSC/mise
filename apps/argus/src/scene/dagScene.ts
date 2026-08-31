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

/** How long after the last touch the idle spin stays paused. */
const SPIN_RESUME_MS: number = 10_000;

/** Wave delay between one dependency tier firing and the next. */
const WAVE_STEP_MS: number = 450;

/** How long one node's wave flare lasts (rise and fall). */
const WAVE_FLARE_MS: number = 700;

/** Rest between wave loops in the ambient miniature. */
const WAVE_LOOP_GAP_MS: number = 2_500;

/** Pointer travel (px) past which a press counts as a drag, not a click. */
const DRAG_THRESHOLD_PX: number = 4;

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
  root: THREE.Color;
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
    // The root wears a cool color against the warm status palette, so the
    // graph's origin reads at a glance in either layout. Themeable via
    // `--dag-root`; the fallback is the harbor seaglass.
    root: varColor('--dag-root', '#6fbfae'),
  };
}

/**
 * Colors one node by its state: errors are always visible, the root wears
 * its own cool color (unless it errored — errors win), activity is the
 * theme's accent, settled work is quiet, templates wear the gold.
 */
function nodeColor_pick(
  node: SceneNode,
  palette: ReturnType<typeof palette_read>,
  isRoot: boolean,
): THREE.Color {
  if (node.status === 'finishedWithError' || node.status === 'cancelled') return palette.error;
  if (isRoot) return palette.root;
  if (node.status === undefined) return palette.template;
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
  /** Edge lines with their endpoint identities, for live re-anchoring. */
  private edges: Array<{ line: THREE.Line; fromId: string; toId: string; dashed: boolean }> = [];
  private graph: SceneGraph = { nodes: [] };
  /** Idle spin stays paused until this clock time (0 = spinning). */
  private spinIdleUntil: number = 0;
  /** The grab in progress: which node, its drag plane, and travel so far. */
  private drag: { nodeId: string; plane: THREE.Plane; startX: number; startY: number; moved: boolean } | null = null;
  /** The live reaction simulation while (and shortly after) a grab. */
  private dragSim: ReturnType<typeof forceSimulation> | null = null;
  private dragSimNodes: Array<{ id: string; x: number; y: number; z: number; fx?: number | null; fy?: number | null; fz?: number | null }> = [];
  /** Swallows the click that ends a drag, so a pull is not a select. */
  private suppressClick: boolean = false;
  /** The pulse wave's schedule: node id to flare time (ms into the wave). */
  private waveTimes: Map<string, number> = new Map();
  /** Wall-clock start of the running wave, or null when no wave runs. */
  private waveStartAt: number | null = null;
  /** The camera flight in progress, or null. */
  private flight: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromQuat: THREE.Quaternion;
    toQuat: THREE.Quaternion;
    startedAt: number;
    durationMs: number;
    onDone: () => void;
  } | null = null;
  /** Camera home before a fly-in, restored by the fly-back. */
  private flightHome: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null;
  /** While inside a node (overlay up), the spin and picking hold still. */
  private holding: boolean = false;
  private strategy: LayoutStrategy = 'ranked';
  private selectedId: string | null = null;
  private frameHandle: number | null = null;
  private disposed: boolean = false;
  /** The hover tip naming the node under the pointer (pane mode only). */
  private tip: HTMLDivElement | null = null;
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
      this.renderer.domElement.addEventListener('click', (event: MouseEvent): void => {
        // The click that ends a pull is the pull's release, not a select.
        if (this.suppressClick) {
          this.suppressClick = false;
          return;
        }
        this.pick_handle(event, 'select');
      });
      this.renderer.domElement.addEventListener('dblclick', (event: MouseEvent): void =>
        this.pick_handle(event, 'activate'),
      );
      this.renderer.domElement.addEventListener('pointerdown', (event: PointerEvent): void =>
        this.press_handle(event),
      );
      this.renderer.domElement.addEventListener('pointerup', (): void => this.drag_end());
      this.renderer.domElement.addEventListener('pointercancel', (): void => this.drag_end());
      // Hovering names the node: a small tip follows the pointer over a
      // sphere, so identity does not cost a click.
      this.tip = document.createElement('div');
      this.tip.className = 'dag-node-tip';
      this.tip.hidden = true;
      container.appendChild(this.tip);
      this.renderer.domElement.addEventListener('pointermove', (event: PointerEvent): void => {
        if (this.drag !== null) {
          this.drag_move(event);
        } else if (this.viewDrag !== null) {
          this.view_move(event);
        } else {
          this.hover_handle(event);
        }
      });
      this.renderer.domElement.addEventListener('pointerleave', (): void => {
        if (this.tip) this.tip.hidden = true;
      });
      // The wheel dollies: closer to read a dense graph, back for the whole.
      this.renderer.domElement.addEventListener('wheel', (event: WheelEvent): void => {
        event.preventDefault();
        this.spinIdleUntil = Date.now() + SPIN_RESUME_MS;
        this.camera.position.z = Math.min(40, Math.max(3, this.camera.position.z + event.deltaY * 0.02));
      }, { passive: false });
      // Right-drag pans; the browser menu would eat the gesture.
      this.renderer.domElement.addEventListener('contextmenu', (event: Event): void =>
        event.preventDefault(),
      );
    }
    // A pane resize (a collapsed console, a divider drag) reshapes the box
    // without a window resize; an unfitted canvas would stretch the graph.
    new ResizeObserver((): void => this.size_fit()).observe(container);
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
        this.wave_animate();
      } else {
        // A touched graph holds still; the idle spin resumes after the wait.
        // A flight or a stay inside a node holds it unconditionally.
        if (
          Date.now() >= this.spinIdleUntil &&
          !this.holding &&
          this.flight === null &&
          this.projection === '3d'
        ) {
          this.group.rotation.y += SPIN_INTERACTIVE;
        }
        // The reaction simulation runs while hot: during a grab, and cooling
        // after release until it settles.
        if (this.dragSim !== null) {
          if (this.drag !== null || this.dragSim.alpha() > 0.02) {
            this.dragSim.tick();
            this.positions_sync();
          } else {
            this.dragSim = null;
            this.dragSimNodes = [];
          }
        }
        this.wave_animate();
        this.flight_animate();
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
    // Every arriving graph gets one wave; the ambient miniature loops it.
    this.wave_start();
  }

  /**
   * Starts the pulse wave: nodes flare in dependency order, a join waiting
   * for its last parent. History-honest — only nodes that actually executed
   * (terminal success or error, or an authored template node) fire, so on a
   * running feed the wave halts at the execution frontier.
   */
  public wave_start(): void {
    this.waveTimes = this.waveSchedule_compute();
    this.waveStartAt = this.waveTimes.size > 0 ? Date.now() : null;
  }

  /**
   * Flies the camera into a node: a dolly toward the sphere until it fills
   * the frame. The idle spin holds for the whole stay; `flight_back` reverses.
   *
   * @param nodeId - The node to fly into.
   * @param onArrived - Called once the camera is inside the node.
   */
  public flight_into(nodeId: string, onArrived: () => void): void {
    const mesh: THREE.Mesh | undefined = this.meshes.get(nodeId);
    if (mesh === undefined || this.flight !== null || this.holding) {
      return;
    }
    this.group.rotation.set(0, 0, 0);
    this.holding = true;
    this.flightHome = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
    };
    // Aim the camera at the node from its current stance, then dolly to just
    // shy of the surface — arrival reads as passing inside.
    const target: THREE.Vector3 = mesh.position.clone();
    const toPos: THREE.Vector3 = target
      .clone()
      .add(this.camera.position.clone().sub(target).normalize().multiplyScalar(0.4));
    const aim: THREE.Camera = this.camera.clone();
    aim.position.copy(this.camera.position);
    aim.lookAt(target);
    this.flight = {
      fromPos: this.camera.position.clone(),
      toPos,
      fromQuat: this.camera.quaternion.clone(),
      toQuat: aim.quaternion.clone(),
      startedAt: Date.now(),
      durationMs: 700,
      onDone: onArrived,
    };
  }

  /**
   * Flies the camera back out to its pre-dive stance and releases the hold.
   *
   * @param onDone - Called once the camera is home.
   */
  public flight_back(onDone: () => void): void {
    if (this.flightHome === null) {
      this.holding = false;
      onDone();
      return;
    }
    const home: { position: THREE.Vector3; quaternion: THREE.Quaternion } = this.flightHome;
    this.flight = {
      fromPos: this.camera.position.clone(),
      toPos: home.position.clone(),
      fromQuat: this.camera.quaternion.clone(),
      toQuat: home.quaternion.clone(),
      startedAt: Date.now(),
      durationMs: 700,
      onDone: (): void => {
        this.flightHome = null;
        this.holding = false;
        this.spinIdleUntil = Date.now() + SPIN_RESUME_MS;
        onDone();
      },
    };
  }

  /** Advances the camera flight, easing position and aim together. */
  private flight_animate(): void {
    if (this.flight === null) return;
    const raw: number = (Date.now() - this.flight.startedAt) / this.flight.durationMs;
    const t: number = Math.min(1, raw);
    // Smoothstep: gentle leave, gentle arrive.
    const eased: number = t * t * (3 - 2 * t);
    this.camera.position.lerpVectors(this.flight.fromPos, this.flight.toPos, eased);
    this.camera.quaternion.slerpQuaternions(this.flight.fromQuat, this.flight.toQuat, eased);
    if (t >= 1) {
      const done: () => void = this.flight.onDone;
      this.flight = null;
      done();
    }
  }

  /** Computes each fireable node's flare time, in ms into the wave. */
  private waveSchedule_compute(): Map<string, number> {
    const times: Map<string, number> = new Map();
    const present: Set<string> = new Set(this.graph.nodes.map((n: SceneNode) => n.id));
    const fired = (node: SceneNode): boolean =>
      node.status === undefined ||
      node.status === 'finishedSuccessfully' ||
      node.status === 'finishedWithError';
    // Relaxation to a fixpoint: cheap at feed scale, and immune to input order.
    let settled: boolean = false;
    while (!settled) {
      settled = true;
      for (const node of this.graph.nodes) {
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

  /** Applies the wave's flares for this frame; loops in ambient mode. */
  private wave_animate(): void {
    if (this.waveStartAt === null) return;
    const elapsed: number = Date.now() - this.waveStartAt;
    let peak: number = 0;
    for (const [id, fireAt] of this.waveTimes) {
      peak = Math.max(peak, fireAt);
      const mesh: THREE.Mesh | undefined = this.meshes.get(id);
      if (mesh === undefined || !(mesh.material instanceof THREE.MeshStandardMaterial)) continue;
      const dt: number = elapsed - fireAt;
      const flare: number =
        dt >= 0 && dt <= WAVE_FLARE_MS ? Math.sin((dt / WAVE_FLARE_MS) * Math.PI) : 0;
      const selectedBase: number = id === this.selectedId ? 0.35 : 0;
      mesh.material.emissive.setScalar(flare > 0 || id === this.selectedId ? 1 : 0);
      mesh.material.emissiveIntensity = Math.max(selectedBase, flare * 0.9);
    }
    if (elapsed > peak + WAVE_FLARE_MS) {
      // A future start leaves the graph quiet through the gap, then loops.
      this.waveStartAt = this.ambient ? Date.now() + WAVE_LOOP_GAP_MS : null;
    }
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

  /** The active projection: the sculpted 3D stage, or the flat schematic. */
  private projection: '3d' | '2d' = '3d';

  /**
   * Switches projection. 2D is the schematic reading: the layout flattens
   * to the plane, the view squares up face-on, the idle spin rests, and an
   * empty-space drag pans (there is no depth to orbit). 3D restores the
   * sculpted stage.
   *
   * @param projection - The projection to show.
   */
  public projection_set(projection: '3d' | '2d'): void {
    this.projection = projection;
    if (projection === '2d') {
      this.group.rotation.set(0, 0, 0);
    }
    this.rebuild();
  }

  /** @returns The active projection. */
  public projection_get(): '3d' | '2d' {
    return this.projection;
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
      const isRoot: boolean = node.parentIds.length === 0 && node.joinParentIds.length === 0;
      mesh.material.color = nodeColor_pick(node, palette_read(), isRoot);
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
    this.edges = [];
    this.dragSim = null;
    this.dragSimNodes = [];
    this.drag = null;
    const palette = palette_read();
    const placed: PlacedNode[] =
      this.strategy === 'molecule' ? layout_molecule(this.graph.nodes) : layout_ranked(this.graph.nodes);
    if (this.projection === '2d') {
      // The schematic: whatever shape the strategy found, flattened to the
      // plane the camera faces.
      for (const item of placed) item.position.z = 0;
    }
    const byId: Map<string, PlacedNode> = new Map(placed.map((p: PlacedNode) => [p.node.id, p]));

    for (const { node, position, radius } of placed) {
      const isRoot: boolean = node.parentIds.length === 0 && node.joinParentIds.length === 0;
      const geometry: THREE.SphereGeometry = new THREE.SphereGeometry(radius, 24, 18);
      const material: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
        color: nodeColor_pick(node, palette, isRoot),
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
        if (parent) this.edge_add(parentId, node.id, parent.position, position, palette.edge, false);
      }
      for (const joinId of node.joinParentIds) {
        const parent: PlacedNode | undefined = byId.get(joinId);
        if (parent) this.edge_add(joinId, node.id, parent.position, position, palette.join, true);
      }
    }

    // Frame the graph: pull the camera back far enough to hold it all.
    const span: number = placed.reduce(
      (widest: number, p: PlacedNode) => Math.max(widest, p.position.length() + 2), 6,
    );
    this.camera.position.z = span * 1.9;
  }

  /** Adds one edge line; joins are dashed. Endpoint ids allow live re-anchoring. */
  private edge_add(
    fromId: string,
    toId: string,
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: THREE.Color,
    dashed: boolean,
  ): void {
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    let line: THREE.Line;
    if (dashed) {
      const material: THREE.LineDashedMaterial = new THREE.LineDashedMaterial({
        color, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.9,
      });
      line = new THREE.Line(geometry, material);
      line.computeLineDistances();
    } else {
      const material: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
        color, transparent: true, opacity: 0.75,
      });
      line = new THREE.Line(geometry, material);
    }
    this.group.add(line);
    this.edges.push({ line, fromId, toId, dashed });
  }

  /** Copies simulation positions onto meshes and re-anchors every edge. */
  private positions_sync(): void {
    for (const simNode of this.dragSimNodes) {
      this.meshes.get(simNode.id)?.position.set(simNode.x, simNode.y, simNode.z);
    }
    for (const edge of this.edges) {
      const from: THREE.Mesh | undefined = this.meshes.get(edge.fromId);
      const to: THREE.Mesh | undefined = this.meshes.get(edge.toId);
      if (from === undefined || to === undefined) continue;
      edge.line.geometry.setFromPoints([from.position, to.position]);
      if (edge.dashed) edge.line.computeLineDistances();
    }
  }

  /** An empty-space drag steering the view: orbit, or pan with shift/right. */
  private viewDrag: {
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
    pan: boolean;
    moved: boolean;
  } | null = null;

  /**
   * A press touches the graph: the idle spin pauses exactly where it is —
   * never a snap — and what follows depends on what was under the pointer.
   * A node press begins a pull (the structure reacts through a live force
   * simulation anchored at the grabbed node); an empty-space press begins a
   * view drag — orbit, or pan with shift or the right button.
   */
  private press_handle(event: PointerEvent): void {
    if (this.holding || this.flight !== null) return;
    this.spinIdleUntil = Date.now() + SPIN_RESUME_MS;
    const hit: THREE.Mesh | null = this.mesh_under(event);
    const nodeId: unknown = hit?.userData['nodeId'];
    if (hit === null || typeof nodeId !== 'string') {
      this.viewDrag = {
        lastX: event.clientX,
        lastY: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        pan: event.shiftKey || event.button === 2 || event.button === 1,
        moved: false,
      };
      try {
        this.renderer.domElement.setPointerCapture(event.pointerId);
      } catch {
        // A capture refusal (synthetic events, a vanished pointer) only
        // costs drag continuity outside the canvas.
      }
      if (this.tip) this.tip.hidden = true;
      return;
    }
    // Drag in the plane through the node, facing the camera: intuitive
    // pull, no depth surprises.
    const normal: THREE.Vector3 = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane: THREE.Plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.position);
    this.drag = { nodeId, plane, startX: event.clientX, startY: event.clientY, moved: false };
    try {
      this.renderer.domElement.setPointerCapture(event.pointerId);
    } catch {
      // See above: capture is a nicety, not a dependency.
    }
    if (this.tip) this.tip.hidden = true;
  }

  /**
   * Builds the reaction simulation, from the meshes' current positions with
   * the grabbed node fixed. Deferred to the first real pointer movement: a
   * heated simulation on a mere press would shift nodes out from under the
   * click and dblclick raycasts. Links and charge only — no centering
   * force, or the pull would fight a recentering spring.
   */
  private dragSim_begin(nodeId: string): void {
    const links: Array<{ source: string; target: string }> = [];
    for (const node of this.graph.nodes) {
      for (const parentId of [...node.parentIds, ...node.joinParentIds]) {
        if (this.meshes.has(parentId)) links.push({ source: parentId, target: node.id });
      }
    }
    this.dragSimNodes = [...this.meshes.entries()].map(([id, mesh]) => ({
      id, x: mesh.position.x, y: mesh.position.y, z: mesh.position.z,
    }));
    this.dragSim = forceSimulation(this.dragSimNodes, 3)
      .force('link', forceLink(links).id((d: { id: string }) => d.id).distance(2.2))
      .force('charge', forceManyBody().strength(-6))
      .alpha(0.5)
      .alphaTarget(0.3)
      .stop();
    const grabbed = this.dragSimNodes.find((n) => n.id === nodeId);
    if (grabbed) {
      grabbed.fx = grabbed.x;
      grabbed.fy = grabbed.y;
      grabbed.fz = grabbed.z;
    }
  }

  /** Follows the pointer during a pull: the grabbed node tracks the drag plane. */
  private drag_move(event: PointerEvent): void {
    if (this.drag === null) return;
    this.spinIdleUntil = Date.now() + SPIN_RESUME_MS;
    if (
      !this.drag.moved &&
      Math.abs(event.clientX - this.drag.startX) + Math.abs(event.clientY - this.drag.startY) >
        DRAG_THRESHOLD_PX
    ) {
      this.drag.moved = true;
      this.dragSim_begin(this.drag.nodeId);
    }
    if (!this.drag.moved) return;
    const bounds: DOMRect = this.renderer.domElement.getBoundingClientRect();
    const pointer: THREE.Vector2 = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const point: THREE.Vector3 = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.drag.plane, point) === null) return;
    const grabbed = this.dragSimNodes.find((n) => n.id === this.drag?.nodeId);
    if (grabbed) {
      grabbed.fx = point.x;
      grabbed.fy = point.y;
      grabbed.fz = point.z;
    }
  }

  /** Steers the view from an empty-space drag: orbit, or pan. */
  private view_move(event: PointerEvent): void {
    if (this.viewDrag === null) return;
    this.spinIdleUntil = Date.now() + SPIN_RESUME_MS;
    const dx: number = event.clientX - this.viewDrag.lastX;
    const dy: number = event.clientY - this.viewDrag.lastY;
    this.viewDrag.lastX = event.clientX;
    this.viewDrag.lastY = event.clientY;
    if (
      !this.viewDrag.moved &&
      Math.abs(event.clientX - this.viewDrag.startX) +
        Math.abs(event.clientY - this.viewDrag.startY) > DRAG_THRESHOLD_PX
    ) {
      this.viewDrag.moved = true;
    }
    if (!this.viewDrag.moved) return;
    if (this.viewDrag.pan || this.projection === '2d') {
      // Screen-proportional pan: the graph follows the pointer.
      const factor: number = this.camera.position.z * 0.0016;
      this.camera.position.x -= dx * factor;
      this.camera.position.y += dy * factor;
    } else {
      this.group.rotation.y += dx * 0.005;
      this.group.rotation.x = Math.min(
        1.2,
        Math.max(-1.2, this.group.rotation.x + dy * 0.005),
      );
    }
  }

  /** Releases a pull: the grip opens and the simulation cools to rest. */
  private drag_end(): void {
    if (this.viewDrag !== null) {
      if (this.viewDrag.moved) this.suppressClick = true;
      this.viewDrag = null;
      this.spinIdleUntil = Date.now() + SPIN_RESUME_MS;
    }
    if (this.drag === null) return;
    this.spinIdleUntil = Date.now() + SPIN_RESUME_MS;
    if (this.drag.moved) this.suppressClick = true;
    const grabbed = this.dragSimNodes.find((n) => n.id === this.drag?.nodeId);
    if (grabbed) {
      grabbed.fx = null;
      grabbed.fy = null;
      grabbed.fz = null;
    }
    this.dragSim?.alphaTarget(0);
    this.drag = null;
  }

  /** @returns The node mesh under a pointer event, or null. */
  private mesh_under(event: MouseEvent): THREE.Mesh | null {
    const bounds: DOMRect = this.renderer.domElement.getBoundingClientRect();
    const pointer: THREE.Vector2 = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    // A raycast can land between a rebuild and its first render, when the
    // fresh meshes still carry identity matrices; bring them current.
    this.group.updateMatrixWorld(true);
    this.raycaster.setFromCamera(pointer, this.camera);
    const hits: THREE.Intersection[] = this.raycaster.intersectObjects([...this.meshes.values()]);
    const object: THREE.Object3D | undefined = hits[0]?.object;
    return object instanceof THREE.Mesh ? object : null;
  }

  /** Names the node under the pointer in the hover tip, or hides it. */
  private hover_handle(event: PointerEvent): void {
    if (this.tip === null) return;
    const nodeId: unknown = this.mesh_under(event)?.userData['nodeId'];
    const node: SceneNode | undefined =
      typeof nodeId === 'string'
        ? this.graph.nodes.find((n: SceneNode) => n.id === nodeId)
        : undefined;
    if (node === undefined) {
      this.tip.hidden = true;
      this.renderer.domElement.style.cursor = '';
      return;
    }
    const bounds: DOMRect = this.renderer.domElement.getBoundingClientRect();
    this.tip.textContent = node.label;
    this.tip.style.left = `${event.clientX - bounds.left + 14}px`;
    this.tip.style.top = `${event.clientY - bounds.top + 10}px`;
    this.tip.hidden = false;
    this.renderer.domElement.style.cursor = 'pointer';
  }

  /** Resolves a pointer event to a node and fires the matching handler. */
  private pick_handle(event: MouseEvent, kind: 'select' | 'activate'): void {
    const nodeId: unknown = this.mesh_under(event)?.userData['nodeId'];
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
