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
  NODE_RADIUS,
  PHYSICS_DEFAULT,
  molecule_prepare,
  moleculeRadii_of as orreryRadii_of,
  ranked_layout,
  type HierarchyArrangement,
  type HierarchyNode,
  type HierarchyPositions,
  type MoleculeNode,
  type MoleculeSettle as OrreryMoleculeSettle,
  type PhysicsTerms,
  type Vec3,
} from '@fnndsc/orrery/layout';
import {
  STAR_GLOW,
  WAVE_STEP_MS,
  haloRadius_of,
  CensusField,
  HandoffField,
  SphereField,
  StarField,
  TubeField,
  type NodeState,
  type Palette,
  type CensusNode,
  type HandoffLook,
  type TubeNode,
  type TubeOwner,
  type StarEntry,
  CameraRig,
  PointerGestures,
  Picker,
  type PickStar,
  type PickNebula,
  DRAG_THRESHOLD_PX,
  type WorldReach,
} from '@fnndsc/orrery';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
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
  /** Collapsed-group multiplicity (×N); undefined or 1 for singletons. */
  count?: number;
  /** A hue the host assigns (a mode's color, e.g. by compute); errors still win. */
  hue?: string;
  /**
   * A ghost drawn as a halo: a translucent sphere at the anchor's place,
   * sized by `count`, that names a cluster on hover and takes a click
   * when no solid sphere is under the pointer. Never edged.
   */
  halo?: boolean;
  /**
   * Drawn as a lit sphere even when the scene draws stars: a node the
   * operator is at (an entered feed's own nodes) stays solid to hover and
   * press, whatever its size on screen.
   */
  solid?: boolean;
  /**
   * Drawn faint: the rest of a field while one part of it is entered.
   * Present in the settle and drawn, but at a fraction of its opacity, and
   * its edges with it.
   */
  dim?: boolean;
  /**
   * The share of a collapsed group that ended in error, 0..1. Hues the
   * sphere between done and error by that share rather than painting a
   * group of eighty thousand red for one failure; absent for a clean group.
   */
  share?: number;
  /**
   * Present in the settle, never drawn: an anchor that pulls its children
   * together (the universe hangs feeds of one shape from one), with no
   * sphere, no edge and no pick of its own.
   */
  ghost?: boolean;
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
  /** A click on empty space cleared the selection. */
  deselect?: () => void;
  /** The words the hover tip shows for a node; null for the node's label. */
  tip?: (node: SceneNode) => string | null;
  /**
   * A settle too big for one frame is run in slices, and each slice says
   * how far it has come; `done === total` is the settle's end. A scene
   * given this handler never holds the page for a whole settle.
   */
  progress?: (done: number, total: number, nodes: number) => void;
  /**
   * The feed a node belongs to, for the hand-off: while the scene draws
   * stars, a feed near enough to read turns solid as a whole. No key, or no
   * handler, and a node stays a star.
   */
  handoffKey?: (node: SceneNode) => string | null;
}

/** The terms a settle honours: orrery's own, re-exported for the panes. */
export type { PhysicsTerms };
export { PHYSICS_DEFAULT };

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


/** How long one node's wave flare lasts (rise and fall). */
const WAVE_FLARE_MS: number = 700;

/** Rest between wave loops in the ambient miniature. */
const WAVE_LOOP_GAP_MS: number = 2_500;

/** How long a tap's name stays up after the finger lifts. */
const TAP_TIP_MS: number = 1500;

/** Statuses grouped for coloring. */
const RUNNING_STATUSES: ReadonlySet<string> = new Set([
  'created', 'waiting', 'scheduled', 'started', 'registeringFiles',
]);

/**
 * Reads the live LCARS palette from the document's computed style.
 *
 * @returns The scene's colors, tracking the active theme.
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
    // The root wears a cool color against the warm status palette, so the
    // graph's origin reads at a glance in either layout. Themeable via
    // `--dag-root`; the fallback is the harbor seaglass.
    root: varColor('--dag-root', '#6fbfae'),
    // The wave flares COOL against the warm status palette: a white flare
    // vanished on butter (finished) nodes. Themeable via `--dag-pulse`.
    pulse: varColor('--dag-pulse', '#48d8f0'),
  };
}

/**
 * Colors one node by its state: errors are always visible, the root wears
 * its own cool color (unless it errored — errors win), activity is the
 * theme's accent, settled work is quiet, templates wear the gold.
 */
const hueColors: Map<string, THREE.Color> = new Map();

/** A host-assigned hue as a scene color, parsed once per distinct value. */
function hueColor_get(hue: string): THREE.Color {
  let color: THREE.Color | undefined = hueColors.get(hue);
  if (color === undefined) {
    color = new THREE.Color(hue);
    hueColors.set(hue, color);
  }
  return color;
}

/**
 * A node's state as orrery draws it, read from its ChRIS status: at work,
 * failed (the stage errored, or every job it stands for did), finished
 * (it ran, or an aggregate settled), or resting.
 *
 * @param node - The node.
 * @returns Its state.
 */
function state_of(node: SceneNode): NodeState {
  if (node.status !== undefined && RUNNING_STATUSES.has(node.status)) return 'live';
  if (node.status === 'finishedWithError' || (node.share !== undefined && node.share >= 1)) return 'failed';
  if (node.status === 'finishedSuccessfully' || (node.share !== undefined && node.status !== undefined)) return 'done';
  return 'rest';
}

function nodeColor_pick(
  node: SceneNode,
  palette: ReturnType<typeof palette_read>,
  isRoot: boolean,
): THREE.Color {
  if (node.share !== undefined && node.status !== 'cancelled') {
    if (node.share >= 1) return palette.error;
    // Square root so a small share still shows as a trace of red.
    return palette.done.clone().lerp(palette.error, Math.sqrt(Math.max(0, node.share)));
  }
  if (node.status === 'finishedWithError' || node.status === 'cancelled') return palette.error;
  if (node.hue !== undefined) return hueColor_get(node.hue);
  if (isRoot) return palette.root;
  if (node.status === undefined) return palette.template;
  if (node.status === 'finishedSuccessfully') return palette.done;
  if (RUNNING_STATUSES.has(node.status)) return palette.running;
  return palette.unknown;
}

/**
 * Ranked placement is declared once in `./rankedLayout.js` and drawn twice
 * — here, and as SVG in a preview card, which cannot hold a WebGL context.
 * What this file adds is the third dimension: the tree is a sheet, every
 * node at z = 0, so an orbit reads as turning the sheet and never scrambles
 * the hierarchy (the earlier per-node depth jitter made a turned tree look
 * like a different feed).
 */

/**
 * A scene node as orrery's molecule reads it: its parents with its joins
 * after them, and its metric.
 *
 * @param node - The scene node.
 * @returns The molecule node.
 */
function moleculeNode_of(node: SceneNode): MoleculeNode {
  const out: MoleculeNode = { id: node.id, parents: [...node.parentIds, ...node.joinParentIds] };
  if (node.metric !== undefined) out.metric = node.metric;
  return out;
}

/**
 * The ranked layout, placed in the scene: orrery places the tiers, the scene
 * holds them as vectors beside their nodes.
 *
 * @param nodes - The graph's nodes.
 * @returns Every node placed.
 */
function layout_ranked(nodes: SceneNode[]): PlacedNode[] {
  const places = ranked_layout(nodes.map((node: SceneNode) => {
    const out: { id: string; parentIds: string[]; metric?: number } = { id: node.id, parentIds: node.parentIds };
    if (node.metric !== undefined) out.metric = node.metric;
    return out;
  }));
  return nodes.map((node: SceneNode, index: number): PlacedNode => {
    const at = places[index];
    return { node, position: new THREE.Vector3(...(at?.position ?? [0, 0, 0])), radius: at?.radius ?? NODE_RADIUS };
  });
}

/**
 * A molecule settle that can be run in slices, holding its places as the
 * scene's vectors: orrery settles, the scene draws.
 */
interface MoleculeSettle {
  total: number;
  moving: number;
  step: (ticks: number) => void;
  place: () => PlacedNode[];
}

/**
 * Each node's radius, as the molecule settle sizes it.
 *
 * @param nodes - The graph's nodes.
 * @returns Radius by id.
 */
function moleculeRadii_of(nodes: ReadonlyArray<SceneNode>): Map<string, number> {
  return orreryRadii_of(nodes.map(moleculeNode_of));
}

/**
 * Builds orrery's molecule settle over the scene's nodes and seeds.
 *
 * @param nodes - The graph's nodes.
 * @param dimensions - 2 or 3.
 * @param seed - Where nodes stood last.
 * @param physics - The terms of this settle.
 * @param frozen - Nodes that stand where their seed put them.
 * @returns The settle, placing into the scene's vectors.
 */
function moleculeScene_prepare(
  nodes: SceneNode[],
  dimensions: 2 | 3 = 3,
  seed: Map<string, THREE.Vector3> = new Map(),
  physics: PhysicsTerms = PHYSICS_DEFAULT,
  frozen: ReadonlySet<string> = new Set(),
): MoleculeSettle {
  const seeds: Map<string, Vec3> = new Map([...seed].map(([id, at]: [string, THREE.Vector3]): [string, Vec3] => [id, [at.x, at.y, at.z]]));
  const settle: OrreryMoleculeSettle = molecule_prepare(nodes.map(moleculeNode_of), dimensions, seeds, physics, frozen);
  return {
    total: settle.total,
    moving: settle.moving,
    step: settle.step,
    place: (): PlacedNode[] => settle.place().map((place, index: number): PlacedNode => ({
      node: nodes[index] as SceneNode,
      position: new THREE.Vector3(...place.position),
      radius: place.radius,
    })),
  };
}

/**
 * Lays out a molecule in one go.
 *
 * @returns Every node placed.
 */
function layout_molecule(
  nodes: SceneNode[],
  dimensions: 2 | 3 = 3,
  seed: Map<string, THREE.Vector3> = new Map(),
  physics: PhysicsTerms = PHYSICS_DEFAULT,
  frozen: ReadonlySet<string> = new Set(),
): PlacedNode[] {
  const settle: MoleculeSettle = moleculeScene_prepare(nodes, dimensions, seed, physics, frozen);
  settle.step(settle.total);
  return settle.place();
}

/**
 * How a rebuild settles the graph it draws.
 *
 * - `full`: every node settles (seeded nodes start where they stood).
 * - `new`: nodes that already stood somewhere hold still; only nodes new to
 *   the scene settle among them — a landing adds a molecule without moving
 *   three thousand spheres.
 * - `hold`: nothing settles when every node already stands somewhere (a
 *   census toggle, a palette change, a space re-shown as it was); any new
 *   node settles as under `new`.
 */
export type SettleMode = 'full' | 'new' | 'hold';

/** Settles smaller than this many ticks × nodes run in one go. */
const SLICE_MIN_WORK: number = 90 * 400;
/** Time a settle may take from one frame before it yields to the next. */
const SLICE_BUDGET_MS: number = 12;

/** How the scene draws its nodes: lit spheres, or points of light. */
export type DrawMode = 'spheres' | 'stars';


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
  /** What lies under a pointer, among everything drawn. */
  private readonly picker: Picker;
  /** The solid spheres, halos and plain edges. */
  private readonly spheres: SphereField = new SphereField(this.group);
  /** Every drawn sphere and halo, by its node's id: the sphere field's own map. */
  private get meshes(): Map<string, THREE.Mesh> {
    return this.spheres.map;
  }
  /** The field's stars, threads and nebulae. */
  private readonly starField: StarField = new StarField(this.group);
  /** Every solid molecule's tubes, and the lamps its stages wear. */
  private readonly tubes: TubeField = new TubeField({
    parent: this.group,
    node: (id: string): TubeNode | undefined => this.tubeNode_of(id),
    sphere: (id: string): THREE.Mesh | undefined => this.meshes.get(id),
    palette: (): Palette => palette_read(),
  });
  /** Every molecule's place between stars and spheres. */
  private readonly handoffField: HandoffField = new HandoffField({
    spheres: this.spheres,
    stars: this.starField,
    tubes: this.tubes,
    look: (id: string): HandoffLook | undefined => this.handoffLook_of(id),
  });
  /** Every job of every stage, when the scene draws a census. */
  private readonly censusField: CensusField = new CensusField({
    parent: this.group,
    stars: this.starField,
    tubes: this.tubes,
    starsView: () => ({ pixelRatio: window.devicePixelRatio, heightPx: this.renderer.domElement.height, fovDeg: this.camera.fov }),
  });

  /** Where the last projection left every node — the next settle's seed. */
  private lastPositions: Map<string, THREE.Vector3> = new Map();
  /** Nodes held still through the current settle. */
  private frozen: Set<string> = new Set();
  /** Physics for the current settle alone, over the standing terms. */
  private physicsOnce: Partial<PhysicsTerms> | undefined = undefined;

  /** CENSUS: render every member of every ×N group as an instanced point. */
  private census: boolean = false;

  /** The molecule's physics terms (see PhysicsTerms). */
  private physics: PhysicsTerms = { ...PHYSICS_DEFAULT };

  /** Sets physics terms and re-settles (warm-started, so it morphs). */
  public physics_set(terms: Partial<PhysicsTerms>, resettle: boolean = true): void {
    this.physics = { ...this.physics, ...terms };
    // A caller about to set a new graph anyway changes the terms without
    // settling the old one first: the first paint of a space used to
    // settle three thousand spheres twice.
    if (resettle) this.rebuild();
  }

  public physics_get(): PhysicsTerms {
    return { ...this.physics };
  }


  /**
   * Toggles the census projection: the full multiplicity of the graph as
   * instanced members on analytic shells (spectacle), versus the semantic
   * shape (work). Selection belongs to shape; census draws, never picks.
   *
   * @param on - Whether census is active.
   */
  public census_set(on: boolean): void {
    if (this.census === on) return;
    this.census = on;
    // The census shells what stands; it moves nothing.
    this.rebuild(true, 'hold');
  }

  public census_get(): boolean {
    return this.census;
  }
  private graph: SceneGraph = { nodes: [] };
  /** The grab in progress: which node, its drag plane, and travel so far. */
  private drag: {
    nodeId: string;
    plane: THREE.Plane;
    startX: number;
    startY: number;
    moved: boolean;
    solo: boolean;
    home: THREE.Vector3;
  } | null = null;
  /** The live reaction simulation while (and shortly after) a grab. */
  private dragSim: ReturnType<typeof forceSimulation> | null = null;
  private dragSimNodes: Array<{ id: string; x: number; y: number; z: number; fx?: number | null; fy?: number | null; fz?: number | null }> = [];
  /** The pulse wave's schedule: node id to flare time (ms into the wave). */
  private waveTimes: Map<string, number> = new Map();
  /** Wall-clock start of the running wave, or null when no wave runs. */
  private waveStartAt: number | null = null;
  /**
   * The camera and the world it turns: the focus, the flights, the hold
   * inside a node, the idle spin, and whether the operator has placed the
   * camera since the scene last framed itself.
   */
  private readonly rig: CameraRig;

  /** How nodes are drawn: lit spheres (every pane), or stars (the universe's choice). */
  private drawMode: DrawMode = 'spheres';
  /** Placed nodes by id, for the spheres a solid feed draws. */
  private placedById: Map<string, PlacedNode> = new Map();

  /**
   * The pointer's intents on the canvas — the view drag, the fingers, the
   * taps — or null for a miniature, which nobody steers.
   */
  private gestures: PointerGestures | null = null;
  /** The pending hide of a tap's name. */
  private tapTipTimer: number | null = null;
  /** The node the hover tip names, and where the pointer was. */
  private hovered: { id: string; x: number; y: number } | null = null;

  /** Times the scene has framed the graph itself (`camera_fit`). */
  private fits: number = 0;
  private strategy: LayoutStrategy = 'ranked';
  private selectedId: string | null = null;
  private frameHandle: number | null = null;
  private disposed: boolean = false;
  /** The hover tip naming the node under the pointer (pane mode only). */
  private tip: HTMLDivElement | null = null;
  /** The wave's flare color, re-read from the palette on every rebuild. */
  private pulseColor: THREE.Color = new THREE.Color('#48d8f0');

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
    // The renderer sizes its canvas in DEVICE pixels and never writes the
    // CSS size (`setSize(w, h, false)` below); the class pins the canvas to
    // its mount so a HiDPI display cannot spill it sideways — one rule for
    // every mount (a pane, a /bin diagram, the header's cycler), not a
    // per-host stylesheet that a new host forgets.
    this.renderer.domElement.classList.add('dag-scene-canvas');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.position.set(0, 0, 14);
    this.rig = new CameraRig(this.camera, this.group);
    this.picker = new Picker(this.camera, this.group, this.renderer.domElement, {
      meshes: (): Iterable<THREE.Object3D> => this.meshes.values(),
      stars: (): Iterable<PickStar> => this.starField.list(),
      nebulae: (): Iterable<PickNebula> => this.starField.nebulae(),
      // A census is picked by its members only while it stands.
      census: () => (this.census && this.censusField.drawn() ? this.censusField : null),
    }, STAR_GLOW);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key: THREE.DirectionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(4, 6, 8);
    this.scene.add(key);
    this.scene.add(this.group);
    container.appendChild(this.renderer.domElement);
    this.size_fit();
    if (!this.ambient) {
      // Hovering names the node: a small tip follows the pointer over a
      // sphere, so identity does not cost a click.
      this.tip = document.createElement('div');
      this.tip.className = 'dag-node-tip';
      this.tip.hidden = true;
      container.appendChild(this.tip);
      this.gestures = new PointerGestures(this.renderer.domElement, this.rig, {
        grab_begin: (event: PointerEvent): boolean => this.grab_begin(event),
        grab_move: (event: PointerEvent): void => this.drag_move(event),
        grab_end: (): boolean => this.grab_end(),
        hover: (event: PointerEvent): void => this.hover_handle(event),
        leave: (event: PointerEvent): void => this.leave_handle(event),
        tap: (event: MouseEvent, kind: 'select' | 'activate'): void => this.pick_handle(event, kind),
        tip_hide: (): void => { if (this.tip) this.tip.hidden = true; },
      }, {
        flat: (): boolean => this.projection === '2d',
        // Census is a place: the camera parks off the focus.
        untethered: (): boolean => this.census,
      });
    }
    // A pane resize (a collapsed console, a divider drag) reshapes the box
    // without a window resize; an unfitted canvas would stretch the graph.
    new ResizeObserver((): void => this.size_fit()).observe(container);
    const animate = (): void => {
      if (this.disposed) return;
      if (this.ambient) {
        this.rig.tumble_step();
        this.wave_animate();
      } else {
        // A touched graph holds still; the idle spin resumes after the wait.
        // A flight or a stay inside a node holds it unconditionally.
        this.rig.spin_step(!(this.gestures?.pointerOver() ?? false) && this.projection === '3d');
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
        if (this.dragReturns.length > 0) {
          const now: number = Date.now();
          this.dragReturns = this.dragReturns.filter((entry): boolean => {
            const t: number = Math.min(1, (now - entry.startedAt) / 300);
            const eased: number = t * t * (3 - 2 * t);
            entry.mesh.position.lerpVectors(entry.from, entry.to, eased);
            return t < 1;
          });
          this.positions_sync();
        }
        this.wave_animate();
        this.rig.flight_step();
      }
      this.starField.scale_update(this.renderer.domElement.height, this.camera.fov);
      this.handoff_step();
      this.tubes.frame(performance.now());
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
  public graph_set(graph: SceneGraph, options: { wave?: boolean; fit?: boolean; frozen?: ReadonlyArray<string>; physics?: Partial<PhysicsTerms>; settle?: SettleMode } = {}): void {
    this.graph = graph;
    // Nodes to hold still through this settle, and physics for it alone:
    // a descent settles one feed while the field around it stands, with
    // no gravity — gravity pulls to the origin, and a feed unfolding far
    // from it would stream there instead of opening where it stood.
    this.frozen = new Set(options.frozen ?? []);
    this.physicsOnce = options.physics;
    // A graph arriving under a flight keeps the camera where the flight
    // put it (`fit: false`); every other arrival is framed whole.
    this.rebuild(options.fit !== false, options.settle ?? 'full');
    // An ARRIVING graph gets one wave; a local re-projection (a scale or
    // layout flip) must not fire one — an unasked pulse reads as a glitch.
    if (options.wave !== false) this.wave_start();
  }

  /** Whether the pane's wave loops continuously (the PULSE ON state). */
  private waveLooping: boolean = false;

  /** Sets continuous wave looping; enabling fires a wave immediately. */
  public waveLoop_set(on: boolean): void {
    this.waveLooping = on;
    if (on) this.wave_start();
    // Turning it off lets the current wave finish and simply not renew.
  }

  /** @returns Whether the wave is looping. */
  public waveLoop_get(): boolean {
    return this.waveLooping;
  }

  /**
   * Where every node settled last, by id, for a caller that remembers.
   *
   * @returns Rounded positions, node id to [x, y, z].
   */
  public positions_get(): Record<string, [number, number, number]> {
    const out: Record<string, [number, number, number]> = {};
    for (const [id, position] of this.lastPositions) {
      out[id] = [Math.round(position.x * 100) / 100, Math.round(position.y * 100) / 100, Math.round(position.z * 100) / 100];
    }
    return out;
  }

  /**
   * Seeds the next settle from remembered positions: a node that was here
   * before starts where it stood, a new one starts fresh. Takes effect on
   * the next `graph_set`.
   *
   * @param positions - Node id to [x, y, z].
   */
  public positions_seed(positions: Record<string, [number, number, number]>): void {
    this.lastPositions = new Map(
      Object.entries(positions).map(([id, [x, y, z]]): [string, THREE.Vector3] => [id, new THREE.Vector3(x, y, z)]),
    );
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
    // In census there is no mesh per node: fly to the group's first member.
    const censusIndex: number = mesh === undefined ? this.censusField.ids().indexOf(nodeId) : -1;
    if ((mesh === undefined && censusIndex < 0) || this.rig.flying() || this.rig.holding_get()) {
      return;
    }
    // The dive leaves the graph exactly as the operator has it — no reset
    // snap. World position: the camera flies in world space, and the group
    // may be rotated.
    this.group.updateMatrixWorld(true);
    const target: THREE.Vector3 =
      mesh !== undefined
        ? mesh.getWorldPosition(new THREE.Vector3())
        : this.group.localToWorld((this.censusField.positions()[censusIndex] ?? new THREE.Vector3()).clone());
    this.rig.flyInto(target, onArrived);
  }

  /**
   * Flies the camera to frame a set of nodes: the fit `camera_fit` would
   * give those nodes alone, reached by a flight from where the camera
   * stands rather than a cut. A descent into one feed frames that feed;
   * the climb back frames everything. Never holds: picking goes on.
   *
   * @param ids - The nodes to frame; every drawn node when empty.
   * @param durationMs - The flight's length.
   * @param onDone - Called when the camera arrives.
   * @param bulk - The share of the nodes the frame must hold, 0..1: at 1
   *   every outlier is inside the frame; at 0.85 the farthest few spill,
   *   and the bulk is close enough to touch. A large feed's settle throws
   *   a few nodes far out, and a frame that held them all put the feed at
   *   the centre as a starburst of two-pixel spheres nobody could click.
   */
  public camera_flyToFit(ids: ReadonlyArray<string>, durationMs: number, onDone: () => void, bulk: number = 1, margin: number = 1.15): void {
    const wanted: Set<string> = new Set(ids);
    const reaches: WorldReach[] = [];
    this.group.updateMatrixWorld(true);
    for (const id of this.drawnIds()) {
      if (wanted.size > 0 && !wanted.has(id)) continue;
      const drawn = this.nodeWorld_of(id);
      if (drawn !== null) reaches.push(drawn);
    }
    this.rig.flyToFit(reaches, durationMs, onDone, bulk, margin);
  }

  /**
   * Whether the operator has placed the camera since the scene last framed
   * the graph: a wheel or a drag. A repaint of the same space keeps a
   * placed camera; a fresh space is framed whole.
   *
   * @returns True once the operator has wheeled or dragged since the last fit.
   */
  public camera_touched(): boolean {
    return this.rig.touched_get();
  }

  /**
   * Draws the nodes as lit spheres or as stars. Moves nothing: the scene
   * is redrawn where it stands, the camera where the operator put it.
   *
   * @param mode - The draw mode.
   */
  public draw_set(mode: DrawMode): void {
    if (mode === this.drawMode) return;
    this.drawMode = mode;
    this.rebuild(false, 'hold');
  }

  /** @returns How nodes are drawn. */
  public draw_get(): DrawMode {
    return this.drawMode;
  }

  /**
   * What the scene holds, for a surface asked to say so: how it draws,
   * how many nodes are solid spheres and how many stars, which of the
   * graph's solid-marked nodes are drawn solid, and the hand-off's state.
   *
   * @returns A plain summary.
   */
  public state_get(): Record<string, unknown> {
    const solidMarked: string[] = this.graph.nodes.filter((node: SceneNode): boolean => node.solid === true).map((node: SceneNode): string => node.id);
    const solidDrawn: number = solidMarked.filter((id: string): boolean => this.meshes.has(id)).length;
    return {
      draw: this.drawMode,
      arrangement: this.arrangement,
      census: this.census,
      nodes: this.graph.nodes.length,
      meshes: this.meshes.size,
      stars: this.starField.count(),
      solidMarked: solidMarked.length,
      solidDrawn,
      tubes: this.tubes.materialCount(),
      censusTubes: this.tubes.censusCount(),
      handoffGroups: this.handoffField.size(),
      handoffSolid: this.handoffField.solidCount(),
      camera: this.rig.eyeDistance().toFixed(1),
      settling: this.slicing,
    };
  }

  /**
   * Flies the camera toward one node, along the line it already looks
   * down, to a distance where its neighbourhood fills the view: the zoom
   * into the star the operator clicked, not a framing of all it belongs to.
   *
   * @param id - The node.
   * @param distance - How far from it to stop, in scene units.
   * @param durationMs - The flight's length.
   * @param onDone - Called on arrival (at once when the node is not drawn).
   */
  public camera_flyToward(id: string, distance: number, durationMs: number, onDone: () => void): void {
    const drawn = this.nodeWorld_of(id);
    if (drawn === null) {
      onDone();
      return;
    }
    this.rig.flyToward(drawn, distance, durationMs, onDone);
  }

  /**
   * Whether the camera is parked inside a node.
   *
   * The fly-in dollies to just shy of a node's surface, so while this is
   * true the pane is filled by the inside of one sphere. Anything that can
   * leave an operator there without an overlay on top has to be able to ask
   * this and fly them back.
   *
   * @returns True while the camera is held inside a node.
   */
  public holding_get(): boolean {
    return this.rig.holding_get();
  }

  /**
   * Flies the camera back out to its pre-dive stance and releases the hold.
   *
   * @param onDone - Called once the camera is home.
   */
  public flight_back(onDone: () => void): void {
    this.rig.flyBack(onDone);
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
    if (this.census && this.censusField.drawn()) {
      // The wave rides the cloud: every job flares with its stage's fire time.
      peak = this.censusField.flare((id: string): number | undefined => this.waveTimes.get(id), elapsed, this.pulseColor, WAVE_FLARE_MS);
      if (elapsed > peak + WAVE_FLARE_MS) {
        this.waveStartAt = this.ambient || this.waveLooping ? Date.now() + WAVE_LOOP_GAP_MS : null;
      }
      return;
    }
    for (const [id, fireAt] of this.waveTimes) {
      peak = Math.max(peak, fireAt);
      const mesh: THREE.Mesh | undefined = this.meshes.get(id);
      if (mesh === undefined || !(mesh.material instanceof THREE.MeshStandardMaterial)) continue;
      const dt: number = elapsed - fireAt;
      const flare: number =
        dt >= 0 && dt <= WAVE_FLARE_MS ? Math.sin((dt / WAVE_FLARE_MS) * Math.PI) : 0;
      // The flare pops in two channels at once: a cool color (white died on
      // the butter of finished nodes) and a size swell.
      mesh.scale.setScalar(1 + flare * 0.45);
      if (flare > 0) {
        mesh.material.emissive.copy(this.pulseColor);
        mesh.material.emissiveIntensity = flare * 1.2;
      } else {
        mesh.material.emissive.setScalar(id === this.selectedId ? 1 : 0);
        mesh.material.emissiveIntensity = id === this.selectedId ? 0.35 : 0;
      }
    }
    if (elapsed > peak + WAVE_FLARE_MS) {
      // A future start leaves the graph quiet through the gap, then loops.
      this.waveStartAt = this.ambient || this.waveLooping ? Date.now() + WAVE_LOOP_GAP_MS : null;
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

  /** Clears the node selection (a new graph owes nothing to the old one). */
  public selection_clear(): void {
    this.selectedId = null;
    this.selection_paint();
  }

  /**
   * Lights the selected sphere and dims the rest, touching materials only.
   * Selection used to rebuild the scene: every click re-ran the settle of
   * every node (seconds, on three thousand) and refitted the camera to
   * the whole graph, so a click on a sphere the operator had dollied up
   * to threw them back out to the whole space before anything else
   * happened, and a double click could never land. A selection is paint.
   */
  private selection_paint(): void {
    this.spheres.select(this.selectedId);
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
      this.group.quaternion.identity();
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
    if (node.status === status) return;
    node.status = status;
    const isRoot: boolean = node.parentIds.length === 0 && node.joinParentIds.length === 0;
    this.spheres.recolor(nodeId, nodeColor_pick(node, palette_read(), isRoot));
    // A stage that started or finished changes what its tubes carry: a
    // stream, a replay, or nothing.
    if (this.tubes.holds(nodeId)) this.tubes.stale_mark();
  }

  /** Re-reads the palette (the THEME pill changed) and repaints. */
  public palette_refresh(): void {
    this.rebuild(true, 'hold');
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
    this.layoutWorker?.terminate();
    this.layoutWorker = null;
    if (this.frameHandle !== null) window.cancelAnimationFrame(this.frameHandle);
    this.gestures?.detach();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.spheres.dispose();
  }

  /**
   * Fits the camera to the placed graph: distance from the bounding sphere
   * so a sprawling molecule (or a wide 2D settle) sits inside the frustum
   * instead of clipping through the near plane as black voids — or leaving
   * the view entirely.
   */
  /**
   * Builds the census: one instanced member per collapsed count, on a
   * fibonacci shell around its group's anchor; equal-count parent/child
   * groups pair members by index, so chains of ×N groups render as
   * branched filaments over the shell — the cell-surface reading.
   */
  private censusBuild(placed: PlacedNode[], palette: ReturnType<typeof palette_read>, fit: boolean = true): void {
    // A ghost (a cluster's anchor) is nobody's job; it still counts in the
    // cloud's centre and in how deep a stage lies.
    const nodes: CensusNode[] = placed.map((item: PlacedNode): CensusNode => {
      const node: SceneNode = item.node;
      const isRoot: boolean = node.parentIds.length === 0 && node.joinParentIds.length === 0;
      return {
        id: node.id,
        position: item.position,
        radius: item.radius,
        count: Math.max(1, node.count ?? 1),
        color: nodeColor_pick(node, palette, isRoot),
        dim: node.dim === true,
        ember: (node.share !== undefined && node.share > 0) || node.status === 'finishedWithError',
        state: state_of(node),
        parents: node.parentIds,
        ghost: node.ghost === true,
      };
    });
    const cloud = this.censusField.build(nodes, this.drawMode === 'stars', palette);
    const center: THREE.Vector3 = cloud.center;
    const cloudRadius: number = cloud.radius;

    // The census parks the camera only when a framing was asked for: a
    // descent redraws under a camera the flight has placed, and re-parking
    // it there was the view resetting under every click.
    if (!this.ambient && fit) {
      // A census cloud grown from near-planar anchors reads edge-on from
      // the axis; open on a three-quarter orbit so the shells read as
      // volume from the first frame.
      this.rig.frame(center, cloudRadius, { stance: 'threeQuarter', farScale: 2.5 });
    }
  }

  private camera_fit(placed: PlacedNode[]): void {
    if (placed.length === 0) return;
    this.rig.touch_clear();
    // How many times the scene has framed the graph itself, on the canvas:
    // a smoke reads it to prove a click did not refit a placed camera.
    this.fits += 1;
    this.renderer.domElement.dataset['fits'] = String(this.fits);
    const center: THREE.Vector3 = new THREE.Vector3();
    for (const item of placed) center.add(item.position);
    center.divideScalar(placed.length);
    // A space of molecules (a host that names them) is framed by its bulk:
    // a few bodies flung far out would otherwise shrink the galaxies to a
    // speck. A single graph is framed whole.
    const reaches: number[] = placed.map((item: PlacedNode): number => center.distanceTo(item.position) + item.radius).sort((a: number, b: number): number => a - b);
    const share: number = this.handlers.handoffKey !== undefined ? 0.95 : 1;
    const radius: number = Math.max(1, reaches[Math.max(0, Math.ceil(reaches.length * share) - 1)] ?? 1);
    // The far plane always clears the framed graph: a fixed 200 clipped
    // sprawling molecules into black voids (and swallowed 2D whole).
    this.rig.frame(center, radius);
  }


  /** Counts rebuilds, so a sliced settle overtaken by a newer one stops. */
  private rebuildGen: number = 0;
  /** Whether a settle is running in slices, its readout up. */
  private slicing: boolean = false;

  /**
   * Rebuilds meshes and edges from the current graph and strategy.
   *
   * @param fit - Frame the result.
   * @param mode - How the graph settles; see {@link SettleMode}.
   */
  private rebuild(fit: boolean = true, mode: SettleMode = 'full'): void {
    const generation: number = ++this.rebuildGen;
    // A settle in slices overtaken by this rebuild ends here: its readout
    // closes, or a quick rebuild after it would leave the bar standing at
    // whatever it last said.
    if (this.slicing) {
      this.slicing = false;
      this.handlers.progress?.(1, 1, 0);
    }
    if (this.strategy !== 'molecule') {
      this.draw(layout_ranked(this.graph.nodes), fit);
      return;
    }
    let frozen: ReadonlySet<string> = this.frozen;
    if (mode !== 'full' && frozen.size === 0) {
      const standing: string[] = this.graph.nodes.map((node: SceneNode): string => node.id).filter((id: string): boolean => this.lastPositions.has(id));
      if (standing.length > 0) frozen = new Set(standing);
    }
    const settle: MoleculeSettle = moleculeScene_prepare(
      this.graph.nodes,
      this.projection === '2d' ? 2 : 3,
      this.lastPositions,
      this.physicsOnce !== undefined ? { ...this.physics, ...this.physicsOnce } : this.physics,
      frozen,
    );
    // A settle too big for one frame runs in slices when someone is told
    // how far it has come: the page keeps drawing the scene that stands,
    // the operator sees a bar move, and the new scene replaces it at the
    // end. Without a listener, and for a small settle, it runs in one go.
    const nodes: number = this.graph.nodes.length;
    const progress = this.handlers.progress;
    // The work is the ticks times the nodes that move: a descent settles a
    // handful among thousands and must land in the same call, since the
    // flight that follows reads the meshes it draws.
    const small: boolean = settle.total * settle.moving < SLICE_MIN_WORK;
    // A host that names its molecules (the universe) settles a big space
    // as a hierarchy in a worker: molecules alone, then molecules as bodies.
    // SPOKES and CLUMPS exist only there, at any size; a small galaxy
    // settles on the page as it always has.
    if ((!small || this.arrangement !== 'galaxy') && progress !== undefined && this.handlers.handoffKey !== undefined && this.frozen.size === 0) {
      this.hierarchy_run(generation, fit, frozen, progress);
      return;
    }
    if (progress === undefined || small) {
      settle.step(settle.total);
      this.draw(settle.place(), fit);
      return;
    }
    let done: number = 0;
    this.slicing = true;
    progress(0, settle.total, nodes);
    const slice = (): void => {
      if (generation !== this.rebuildGen || this.disposed) return;
      const started: number = performance.now();
      while (done < settle.total && performance.now() - started < SLICE_BUDGET_MS) {
        settle.step(1);
        done += 1;
      }
      if (done < settle.total) {
        progress(done, settle.total, nodes);
        window.requestAnimationFrame(slice);
        return;
      }
      this.slicing = false;
      this.draw(settle.place(), fit);
      progress(settle.total, settle.total, nodes);
    };
    window.requestAnimationFrame(slice);
  }

  /** The layout worker, made on the first big settle and kept. */
  private layoutWorker: Worker | null = null;
  /** How a hierarchy sits molecules around their anchor. */
  private arrangement: HierarchyArrangement = 'galaxy';
  /** Where each arrangement's spheres stood, for a return to it. */
  private arrangementMemory: Map<HierarchyArrangement, Map<string, THREE.Vector3>> = new Map();

  /**
   * Arranges molecules as clumps or spokes. The space is laid out afresh:
   * a remembered shape would keep the old arrangement.
   *
   * @param arrangement - The arrangement.
   */
  public arrangement_set(arrangement: HierarchyArrangement, remembered?: Record<string, [number, number, number]>): void {
    if (arrangement === this.arrangement) return;
    // Each arrangement keeps where its spheres stood: going back to one
    // already seen redraws it, and only a first visit pays its settle.
    this.arrangementMemory.set(this.arrangement, new Map(this.lastPositions));
    this.arrangement = arrangement;
    let kept: Map<string, THREE.Vector3> | undefined = this.arrangementMemory.get(arrangement);
    if (kept === undefined && remembered !== undefined && Object.keys(remembered).length > 0) {
      kept = new Map(Object.entries(remembered).map(([id, [x, y, z]]): [string, THREE.Vector3] => [id, new THREE.Vector3(x, y, z)]));
    }
    this.lastPositions = kept ?? new Map();
    this.rebuild(true, kept === undefined ? 'full' : 'hold');
  }

  /** @returns How a hierarchy sits molecules round their hubs. */
  public arrangement_get(): HierarchyArrangement {
    return this.arrangement;
  }

  /**
   * Settles the graph as a hierarchy in the worker, reporting progress, and
   * draws the answer if no newer rebuild has overtaken it.
   */
  private hierarchy_run(generation: number, fit: boolean, frozen: ReadonlySet<string>, progress: (done: number, total: number, nodes: number) => void): void {
    const keyOf = this.handlers.handoffKey;
    if (keyOf === undefined) return;
    const radii: Map<string, number> = moleculeRadii_of(this.graph.nodes);
    const nodes: HierarchyNode[] = this.graph.nodes.map((node: SceneNode): HierarchyNode => {
      const seed: THREE.Vector3 | undefined = this.lastPositions.get(node.id);
      return {
        id: node.id,
        parents: [...node.parentIds, ...node.joinParentIds],
        radius: radii.get(node.id) ?? NODE_RADIUS,
        group: node.ghost === true ? null : keyOf(node),
        ...(seed === undefined ? {} : { seed: [seed.x, seed.y, seed.z] as [number, number, number] }),
        ...(frozen.has(node.id) ? { frozen: true } : {}),
      };
    });
    const total: number = 1000;
    const count: number = nodes.length;
    this.slicing = true;
    progress(0, total, count);
    if (this.layoutWorker === null) {
      this.layoutWorker = new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' });
    }
    const worker: Worker = this.layoutWorker;
    const physics = this.physicsOnce !== undefined ? { ...this.physics, ...this.physicsOnce } : this.physics;
    worker.onmessage = (event: MessageEvent<{ generation: number; type: 'progress' | 'done' | 'failed'; fraction?: number; positions?: HierarchyPositions; reason?: string }>): void => {
      const answer = event.data;
      if (answer.generation !== this.rebuildGen || this.disposed) return;
      if (answer.type === 'progress') {
        progress(Math.min(total - 1, Math.floor((answer.fraction ?? 0) * total)), total, count);
        return;
      }
      if (answer.type === 'failed') {
        // An engine the host does not know: the space stays as it stood,
        // and the reason is said, never drawn as every node at the origin.
        console.error(`layout: ${answer.reason ?? 'the engine failed'}`);
        this.slicing = false;
        progress(total, total, count);
        return;
      }
      const positions: HierarchyPositions = answer.positions ?? {};
      const placed: PlacedNode[] = this.graph.nodes.map((node: SceneNode): PlacedNode => {
        const at: [number, number, number] = positions[node.id] ?? [0, 0, 0];
        return { node, position: new THREE.Vector3(at[0], at[1], at[2]), radius: radii.get(node.id) ?? NODE_RADIUS };
      });
      this.slicing = false;
      this.draw(placed, fit);
      progress(total, total, count);
    };
    worker.postMessage({ generation, nodes, physics, arrangement: this.arrangement });
  }

  /** Draws placed nodes as the scene: meshes, edges, census, the frame. */
  private draw(placed: PlacedNode[], fit: boolean): void {
    this.group.clear();
    this.spheres.clear();
    this.censusField.clear();
    this.dragSim = null;
    this.dragSimNodes = [];
    this.drag = null;
    this.starField.clear();
    this.handoffField.clear();
    this.placedById = new Map();
    this.tubes.clear();
    const palette = palette_read();
    this.pulseColor = palette.pulse;
    this.lastPositions = new Map(placed.map((p: PlacedNode): [string, THREE.Vector3] => [p.node.id, p.position.clone()]));
    if (this.projection === '2d') {
      // The molecule already settled in-plane; ranked drops only its
      // parallax hash — its layout was two-dimensional by construction.
      for (const item of placed) item.position.z = 0;
    }
    if (this.census) {
      // The census shells every job but the feed the operator is at: an
      // entered feed stays solid spheres in its tubes, whatever the density.
      const solidOnes: PlacedNode[] = placed.filter((item: PlacedNode): boolean => item.node.solid === true && item.node.ghost !== true);
      this.censusBuild(placed.filter((item: PlacedNode): boolean => item.node.solid !== true), palette, fit);
      if (solidOnes.length > 0) this.solid_draw(solidOnes, palette);
      return;
    }
    if (!this.ambient && fit) this.camera_fit(placed);
    const byId: Map<string, PlacedNode> = new Map(placed.map((p: PlacedNode) => [p.node.id, p]));

    // Stars: every node but a solid one is a point of light, a halo a
    // nebula; they are drawn in batches after this loop.
    const starring: boolean = this.drawMode === 'stars';
    const starred: StarEntry[] = [];
    const handoffKey = starring ? this.handlers.handoffKey : undefined;
    for (const { node, position, radius } of placed) {
      if (node.ghost === true && node.halo !== true) continue;
      if (starring && node.solid !== true) {
        if (node.halo === true) {
          this.nebula_add(node, position, palette);
          continue;
        }
        const isRoot: boolean = node.parentIds.length === 0 && node.joinParentIds.length === 0;
        starred.push({
          id: node.id,
          position: position.clone(),
          radius,
          color: nodeColor_pick(node, palette, isRoot).clone(),
          dim: node.dim === true,
          ember: (node.share !== undefined && node.share > 0) || node.status === 'finishedWithError',
        });
        continue;
      }
      if (node.halo === true) {
        this.spheres.halo_add(node.id, position, haloRadius_of(node.count ?? 1), palette.edge, node.dim === true);
        continue;
      }
      const isRoot: boolean = node.parentIds.length === 0 && node.joinParentIds.length === 0;
      // 2D is drawn flat: discs, not lit spheres — the schematic reading
      // all the way down; status colour, selection and flare carry over.
      this.spheres.sphere_add(node.id, position, radius, {
        color: nodeColor_pick(node, palette, isRoot),
        dim: node.dim === true,
        selected: node.id === this.selectedId,
        flat: this.projection === '2d',
      });
    }

    if (starred.length > 0) this.starField.draw(starred, window.devicePixelRatio, this.renderer.domElement.height, this.camera.fov);
    for (const item of placed) this.placedById.set(item.node.id, item);
    if (handoffKey !== undefined) {
      const byNode: Map<string, SceneNode> = new Map(this.graph.nodes.map((node: SceneNode): [string, SceneNode] => [node.id, node]));
      this.handoffField.gather(starred, (id: string): string | null => {
        const node: SceneNode | undefined = byNode.get(id);
        return node === undefined ? null : handoffKey(node);
      });
    }
    // An edge between two solid nodes is a line as ever; an edge touching a
    // star is a thread, all of them one batch.
    const threads: number[] = [];
    const threadColors: number[] = [];
    const solid = (item: PlacedNode): boolean => !starring || item.node.solid === true;
    const thread_add = (from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, dim: boolean, owner: SceneNode): void => {
      const k: number = dim ? 0.35 : 1;
      const segment: number = threads.length / 6;
      threads.push(from.x, from.y, from.z, to.x, to.y, to.z);
      threadColors.push(color.r * k, color.g * k, color.b * k, color.r * k, color.g * k, color.b * k);
      const key: string | null = dim || handoffKey === undefined ? null : handoffKey(owner);
      if (key !== null) this.handoffField.thread_note(key, segment);
    };
    for (const item of placed) {
      const { node, position } = item;
      if (node.ghost === true) continue;
      for (const parentId of node.parentIds) {
        const parent: PlacedNode | undefined = byId.get(parentId);
        if (!parent || parent.node.ghost === true) continue;
        const dim: boolean = node.dim === true || parent.node.dim === true;
        if (solid(item) && solid(parent)) { if (!starring && dim) this.spheres.edge_add(parentId, node.id, parent.position, position, palette.edge, false, dim); }
        else thread_add(parent.position, position, palette.edge, dim, node);
      }
      for (const joinId of node.joinParentIds) {
        const parent: PlacedNode | undefined = byId.get(joinId);
        if (!parent) continue;
        const dim: boolean = node.dim === true || parent.node.dim === true;
        if (solid(item) && solid(parent)) { if (!starring && dim) this.spheres.edge_add(joinId, node.id, parent.position, position, palette.join, true, dim); }
        else thread_add(parent.position, position, palette.join, dim, node);
      }
    }
    // Solid spheres are joined by tubes: under stars, the nodes marked solid
    // (a feed the operator entered); drawn as spheres, every node not dimmed
    // — the DAG pane's graph and the universe's SPHERES alike. Dimmed
    // scenery keeps its faint lines.
    {
      const solidIds: string[] = placed
        .filter((item: PlacedNode): boolean => item.node.ghost !== true && item.node.halo !== true && (starring ? item.node.solid === true : item.node.dim !== true))
        .map((item: PlacedNode): string => item.node.id);
      if (solidIds.length > 0) {
        const entered: TubeOwner = { tubes: null, mix: 1 };
        this.tubes.build(entered, solidIds, new Set(solidIds));
      }
    }
    this.starField.threads_draw(threads, threadColors);

  }


  /**
   * Steps the hand-off once a frame: a feed whose largest sphere spans
   * more than a few pixels turns solid, crossfading, its threads rising
   * to edges; one that shrinks back goes to stars and its spheres are let go.
   */
  private handoff_step(): void {
    if (this.handoffField.size() === 0) return;
    const height: number = this.renderer.domElement.clientHeight || 1;
    const perUnit: number = height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.group.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    const view: THREE.Matrix4 = new THREE.Matrix4().multiplyMatrices(this.camera.matrixWorldInverse, this.group.matrixWorld);
    this.handoffField.step(view, perUnit, performance.now());
  }


  /**
   * How a placed node's sphere is drawn when its molecule turns solid.
   *
   * @param id - The node.
   * @returns Where it stands, how large, what hue.
   */
  private handoffLook_of(id: string): HandoffLook | undefined {
    const placed: PlacedNode | undefined = this.placedById.get(id);
    if (placed === undefined) return undefined;
    const isRoot: boolean = placed.node.parentIds.length === 0 && placed.node.joinParentIds.length === 0;
    return { position: placed.position, radius: placed.radius, color: nodeColor_pick(placed.node, palette_read(), isRoot) };
  }

  /**
   * A placed node as the tubes read it.
   *
   * @param id - The node.
   * @returns Where it stands, how large, what it hangs from, its state.
   */
  private tubeNode_of(id: string): TubeNode | undefined {
    const placed: PlacedNode | undefined = this.placedById.get(id);
    if (placed === undefined) return undefined;
    return {
      position: placed.position,
      radius: placed.radius,
      parents: placed.node.parentIds,
      joins: placed.node.joinParentIds,
      state: state_of(placed.node),
    };
  }


  /**
   * A cluster's handle while the scene draws stars: a soft glow at its
   * anchor, facing the camera, sized as its halo would be.
   */
  private nebula_add(node: SceneNode, position: THREE.Vector3, palette: ReturnType<typeof palette_read>): void {
    this.starField.nebula_add(node.id, position, haloRadius_of(node.count ?? 1), palette.edge, node.dim === true);
  }


  /**
   * Where a drawn node stands in the world and how big it is — a sphere,
   * a star or a census member alike — for flights and framing.
   *
   * @param id - The node.
   * @returns Its world position and radius, or null when it is not drawn.
   */
  private nodeWorld_of(id: string): { position: THREE.Vector3; radius: number } | null {
    const mesh: THREE.Mesh | undefined = this.meshes.get(id);
    if (mesh !== undefined) {
      const sphere: THREE.BufferGeometry = mesh.geometry;
      if (sphere.boundingSphere === null) sphere.computeBoundingSphere();
      return { position: mesh.getWorldPosition(new THREE.Vector3()), radius: sphere.boundingSphere?.radius ?? NODE_RADIUS };
    }
    const star: StarEntry | undefined = this.starField.entry(id);
    if (star !== undefined) return { position: this.group.localToWorld(star.position.clone()), radius: star.radius };
    return null;
  }

  /** Every drawn node's id: spheres and stars. */
  private drawnIds(): string[] {
    return [...this.meshes.keys(), ...this.starField.ids()];
  }


  /** Copies simulation positions onto meshes and re-anchors every edge. */
  private positions_sync(): void {
    for (const simNode of this.dragSimNodes) {
      this.meshes.get(simNode.id)?.position.set(simNode.x, simNode.y, simNode.z);
      // Where a pulled node comes to rest is where it stands: a later
      // redraw starts from here instead of snapping it back.
      this.lastPositions.set(simNode.id, new THREE.Vector3(simNode.x, simNode.y, simNode.z));
    }
    this.tubes.follow();
    this.spheres.edges_follow();
  }

  /**
   * A press the gestures could not place: when it landed on a node it
   * begins a pull (the structure reacts through a live force simulation
   * anchored at the grabbed node) and the press is the scene's to follow.
   *
   * @param event - The press.
   * @returns True when a node was taken hold of.
   */
  private grab_begin(event: PointerEvent): boolean {
    const hit: THREE.Mesh | null = this.picker.mesh_under(event);
    const nodeId: unknown = hit?.userData['nodeId'];
    if (hit === null || typeof nodeId !== 'string') return false;
    // Drag in the plane through the node, facing the camera: intuitive
    // pull, no depth surprises.
    const normal: THREE.Vector3 = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    // The plane runs through the node where it stands in the WORLD: the ray
    // it is cut with is in world space, and the group may be moved and
    // turned (the universe turns about its focus).
    this.group.updateMatrixWorld(true);
    const plane: THREE.Plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.getWorldPosition(new THREE.Vector3()));
    this.drag = {
      nodeId, plane, startX: event.clientX, startY: event.clientY, moved: false,
      // Ranked is deterministic truth: a pull peeks at ONE node and the
      // release returns it home. The whole-graph elastic reaction belongs
      // to the molecule — heating it under ranked dissolved the tiers.
      solo: this.strategy === 'ranked',
      home: hit.position.clone(),
    };
    return true;
  }

  /**
   * Builds the reaction simulation, from the meshes' current positions with
   * the grabbed node fixed. Deferred to the first real pointer movement: a
   * heated simulation on a mere press would shift nodes out from under the
   * click and dblclick raycasts. Links and charge only — no centering
   * force, or the pull would fight a recentering spring.
   */
  private dragSim_begin(nodeId: string): void {
    // A pull moves the grabbed node's own molecule — the nodes joined to it
    // by edges, never across a cluster's halo, never a dimmed one — and
    // leaves the rest of the field where it stands. Pulling one feed in a
    // universe of seven hundred re-settled all of them under physics that
    // were not the universe's own.
    const halo = (id: string): boolean => this.meshes.get(id)?.userData['halo'] === true;
    const dim = (id: string): boolean => this.meshes.get(id)?.userData['dim'] === true;
    const all: Array<{ source: string; target: string }> = [];
    const around: Map<string, string[]> = new Map();
    for (const node of this.graph.nodes) {
      for (const parentId of [...node.parentIds, ...node.joinParentIds]) {
        if (!this.meshes.has(parentId) || !this.meshes.has(node.id) || halo(parentId) || halo(node.id)) continue;
        all.push({ source: parentId, target: node.id });
        around.set(parentId, [...(around.get(parentId) ?? []), node.id]);
        around.set(node.id, [...(around.get(node.id) ?? []), parentId]);
      }
    }
    const molecule: Set<string> = new Set([nodeId]);
    const queue: string[] = [nodeId];
    while (queue.length > 0) {
      const at: string = queue.pop() as string;
      for (const next of around.get(at) ?? []) {
        if (molecule.has(next) || dim(next)) continue;
        molecule.add(next);
        queue.push(next);
      }
    }
    const links: Array<{ source: string; target: string }> = all.filter((link): boolean => molecule.has(link.source) && molecule.has(link.target));
    this.dragSimNodes = [...molecule].map((id: string) => {
      const mesh: THREE.Mesh = this.meshes.get(id) as THREE.Mesh;
      return { id, x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
    });
    // The pull reacts with the forces the layout settled under — the same
    // link lengths, charge by size within the hug's reach, no overlap — so
    // a tug moves the molecule rather than blowing it apart (generic forces
    // disagreed with the rest the layout had found, and every node fled).
    const radii: Map<string, number> = moleculeRadii_of(this.graph.nodes);
    const radiusOf = (id: string): number => radii.get(id) ?? NODE_RADIUS;
    this.dragSim = forceSimulation(this.dragSimNodes, this.projection === '2d' ? 2 : 3)
      .force('link', forceLink(links).id((d: { id: string }) => d.id).distance(
        (link: { source: { id: string }; target: { id: string } }): number => radiusOf(link.source.id) + radiusOf(link.target.id) + 1.4,
      ))
      .force('charge', forceManyBody().strength((d: { id: string }): number => -6 * (radiusOf(d.id) / NODE_RADIUS) ** 2).distanceMax(12))
      .force('collide', forceCollide().radius((d: { id: string }): number => radiusOf(d.id) * 1.2))
      .alpha(0.25)
      .alphaTarget(0.08)
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
    this.rig.spin_pause();
    if (
      !this.drag.moved &&
      Math.abs(event.clientX - this.drag.startX) + Math.abs(event.clientY - this.drag.startY) >
        DRAG_THRESHOLD_PX
    ) {
      this.drag.moved = true;
      if (!this.drag.solo) this.dragSim_begin(this.drag.nodeId);
    }
    if (!this.drag.moved) return;
    const point: THREE.Vector3 = new THREE.Vector3();
    if (this.picker.ray_aim(event).ray.intersectPlane(this.drag.plane, point) === null) return;
    // Back into the group's own space, where the node and the simulation
    // live: pinned to a world point, the node leapt away and dragged its
    // whole molecule after it.
    this.group.worldToLocal(point);
    if (this.drag.solo) {
      const mesh: THREE.Mesh | undefined = this.meshes.get(this.drag.nodeId);
      if (mesh !== undefined) {
        mesh.position.copy(point);
        this.positions_sync();
      }
      return;
    }
    const grabbed = this.dragSimNodes.find((n) => n.id === this.drag?.nodeId);
    if (grabbed) {
      grabbed.fx = point.x;
      grabbed.fy = point.y;
      grabbed.fz = point.z;
    }
  }

  /** Nodes easing home after a ranked peek: mesh, from, to, start time. */
  private dragReturns: Array<{ mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; startedAt: number }> = [];

  /**
   * Releases a pull: the grip opens and the simulation cools to rest.
   *
   * @returns Whether the pull had moved, so its click is swallowed.
   */
  private grab_end(): boolean {
    if (this.drag === null) return false;
    const moved: boolean = this.drag.moved;
    if (this.drag.solo && this.drag.moved) {
      const mesh: THREE.Mesh | undefined = this.meshes.get(this.drag.nodeId);
      if (mesh !== undefined) {
        this.dragReturns.push({
          mesh, from: mesh.position.clone(), to: this.drag.home.clone(), startedAt: Date.now(),
        });
      }
    }
    const grabbed = this.dragSimNodes.find((n) => n.id === this.drag?.nodeId);
    if (grabbed) {
      grabbed.fx = null;
      grabbed.fy = null;
      grabbed.fz = null;
    }
    this.dragSim?.alphaTarget(0);
    this.drag = null;
    return moved;
  }

  /**
   * Draws nodes as lit spheres joined by tubes, among a census: the feed the
   * operator entered, which the census's points would otherwise swallow.
   *
   * @param solidOnes - The nodes to draw solid.
   * @param palette - The palette.
   */
  private solid_draw(solidOnes: ReadonlyArray<PlacedNode>, palette: ReturnType<typeof palette_read>): void {
    for (const item of solidOnes) {
      this.placedById.set(item.node.id, item);
      const isRoot: boolean = item.node.parentIds.length === 0 && item.node.joinParentIds.length === 0;
      this.spheres.sphere_add(item.node.id, item.position, item.radius, { color: nodeColor_pick(item.node, palette, isRoot) });
    }
    const ids: string[] = solidOnes.map((item: PlacedNode): string => item.node.id);
    const entered: TubeOwner = { tubes: null, mix: 1 };
    this.tubes.build(entered, ids, new Set(ids));
  }

  /**
   * The pointer left the field. A finger lifting leaves at once, so its
   * name stays up a moment to be read; a cursor's goes with it.
   *
   * @param event - The leave.
   */
  private leave_handle(event: PointerEvent): void {
    this.hovered = null;
    if (event.pointerType === 'touch' && this.tip !== null && !this.tip.hidden) {
      if (this.tapTipTimer !== null) window.clearTimeout(this.tapTipTimer);
      this.tapTipTimer = window.setTimeout((): void => {
        this.tapTipTimer = null;
        if (this.tip !== null && (this.gestures?.fingersDown() ?? 0) === 0) this.tip.hidden = true;
      }, TAP_TIP_MS);
      return;
    }
    if (this.tip) this.tip.hidden = true;
  }

  /** Names the node under the pointer in the hover tip, or hides it. */
  private hover_handle(event: PointerEvent): void {
    if (this.tip === null) return;
    // In census the spheres are members of one instanced mesh: the group
    // under the pointer is what the tip names, as a click would pick.
    const nodeId: unknown = this.picker.node_under(event, this.gestures?.pressKind() === 'touch');
    const node: SceneNode | undefined =
      typeof nodeId === 'string'
        ? this.graph.nodes.find((n: SceneNode) => n.id === nodeId)
        : undefined;
    if (node === undefined) {
      this.tip.hidden = true;
      this.renderer.domElement.style.cursor = '';
      this.hovered = null;
      return;
    }
    this.hovered = { id: node.id, x: event.clientX, y: event.clientY };
    const bounds: DOMRect = this.renderer.domElement.getBoundingClientRect();
    this.tip.textContent = this.handlers.tip?.(node) ?? node.label;
    this.tip.style.left = `${event.clientX - bounds.left + 14}px`;
    this.tip.style.top = `${event.clientY - bounds.top + 10}px`;
    this.tip.hidden = false;
    this.renderer.domElement.style.cursor = 'pointer';
  }

  /** Resolves a pointer event to a node and fires the matching handler. */
  private pick_handle(event: MouseEvent, kind: 'select' | 'activate'): void {
    // What the tip names is what a click takes, when the pointer has not
    // moved off it: the operator aimed at the node they read.
    const held = this.hovered;
    const nodeId: string | null = held !== null && Math.hypot(event.clientX - held.x, event.clientY - held.y) <= 6
      ? held.id
      : this.picker.node_under(event, this.gestures?.pressKind() === 'touch');
    if (nodeId === null) {
      // Empty space is the natural off switch for the node detail.
      if (kind === 'select' && this.selectedId !== null) {
        this.selection_clear();
        this.handlers.deselect?.();
      }
      return;
    }
    const node: SceneNode | undefined = this.graph.nodes.find((n: SceneNode) => n.id === nodeId);
    if (!node) return;
    if (kind === 'select') {
      this.selectedId = nodeId;
      if (!this.census) this.selection_paint();
      this.handlers.select?.(node);
    } else {
      this.handlers.activate?.(node);
    }
  }
}
