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
import type { HierarchyArrangement, HierarchyNode, HierarchyPositions } from './hierarchy.js';
import {
  rankedLayout_compute,
  type RankedLayout,
  type RankedPlacement,
} from './rankedLayout.js';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  forceZ,
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

/** The physics terms the molecule settle may honor (expert knobs; GRAVITY is a meaning). */
export interface PhysicsTerms {
  charge: boolean;
  link: boolean;
  collide: boolean;
  gravity: boolean;
  /**
   * How far a node's repulsion reaches, in scene units; unbounded when
   * absent. A sparse graph settles as wide as its charge carries, so six
   * spheres spread across a field and read as dots: bounding the reach
   * lets a small molecule hug itself while a crowd still spreads.
   */
  reach?: number;
}

export const PHYSICS_DEFAULT: PhysicsTerms = { charge: true, link: true, collide: true, gravity: false };

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

/** How faint a dimmed node and its edges are drawn. */
const DIM_OPACITY: number = 0.16;

/** How faint a cluster's halo is drawn. */
const HALO_OPACITY: number = 0.09;

/**
 * A halo's radius by the feeds it gathers: room for a few, more for a crowd,
 * never so much it swallows the neighbouring cluster.
 *
 * @param count - The feeds of the shape.
 * @returns The radius in scene units.
 */
function haloRadius_of(count: number): number {
  return 1.6 + 0.45 * Math.sqrt(Math.max(1, count));
}

/** Vertical distance between ranked tiers. */
const TIER_SPACING: number = 2.6;

/** Horizontal spread between siblings in a tier. */
const SIBLING_SPACING: number = 2.0;

/** Idle rotation speed, radians per frame. */
const SPIN_INTERACTIVE: number = 0.0022;

/** The world's up: the axis the idle spin and a sideways orbit turn about. */
const WORLD_UP: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
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
/** Two taps within this span and distance are a double tap. */
const DOUBLE_TAP_MS: number = 350;
const DOUBLE_TAP_PX: number = 30;
/** How long a tap's name stays up after the finger lifts. */
const TAP_TIP_MS: number = 1500;
/** A fingertip is wider than a cursor: the least a star reaches for one. */
const TOUCH_REACH_PX: number = 14;

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
  root: THREE.Color; pulse: THREE.Color;
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
/** The k-th of n points on a fibonacci sphere of the given radius. */
function fibonacciPoint_make(k: number, n: number, radius: number): THREE.Vector3 {
  const golden: number = Math.PI * (3 - Math.sqrt(5));
  const y: number = n === 1 ? 0 : 1 - (2 * k) / (n - 1);
  const ring: number = Math.sqrt(Math.max(0, 1 - y * y));
  const angle: number = golden * k;
  return new THREE.Vector3(Math.cos(angle) * ring * radius, y * radius, Math.sin(angle) * ring * radius);
}

function layout_ranked(nodes: SceneNode[]): PlacedNode[] {
  const metrics: number[] = nodes.map((n: SceneNode): number => n.metric ?? 0);
  const metricPeak: number = Math.max(...metrics, 0);
  // The placement itself is declared once, in `rankedLayout`, and drawn
  // twice: here in three.js and as SVG in a preview card. What remains here
  // is turning layout units into scene units and scaling by the metric.
  const layout: RankedLayout = rankedLayout_compute(nodes);
  const slots: Map<string, RankedPlacement> = new Map(
    layout.placements.map((placement: RankedPlacement): [string, RankedPlacement] => [placement.id, placement]),
  );

  const placed: PlacedNode[] = [];
  for (const node of nodes) {
    const at: RankedPlacement | undefined = slots.get(node.id);
    const x: number = ((at?.x ?? 0) - layout.width / 2) * SIBLING_SPACING;
    const y: number = ((layout.tierCount - 1) / 2 - (at?.tier ?? 0)) * TIER_SPACING;
    // Metric scaling applies in every layout: a mode pill that changes
    // nothing on screen reads as broken. No metric = uniform.
    const metric: number = node.metric ?? 0;
    const scale: number = metricPeak > 0 ? 0.55 + (metric / metricPeak) * 1.0 : 1;
    placed.push({ node, position: new THREE.Vector3(x, y, 0), radius: NODE_RADIUS * scale });
  }
  return placed;
}

/**
 * The compute molecule: a d3-force-3d settling with node radii scaled by
 * the metric (degree when no metric arrived). The graph finds its own
 * shape; scale carries meaning.
 */
/**
 * A molecule settle that can be run in slices: the simulation built, its
 * ticks counted, stepped as the caller has time, and placed at the end.
 *
 * @property total - The ticks this settle runs; zero when nothing moves.
 * @property moving - How many nodes the simulation moves.
 * @property step - Runs up to `ticks` more ticks.
 * @property place - Where every node stands now.
 */
interface MoleculeSettle {
  total: number;
  /** Nodes the simulation moves: pinned ones cost nothing. */
  moving: number;
  step: (ticks: number) => void;
  place: () => PlacedNode[];
}

/**
 * Each node's radius, as the molecule settle sizes it: the metric (degree
 * when none arrived) against the graph's peak.
 *
 * @param nodes - The graph's nodes.
 * @returns Radius by id.
 */
function moleculeRadii_of(nodes: ReadonlyArray<SceneNode>): Map<string, number> {
  const degree: Map<string, number> = new Map();
  for (const node of nodes) {
    for (const parentId of [...node.parentIds, ...node.joinParentIds]) {
      degree.set(parentId, (degree.get(parentId) ?? 0) + 1);
      degree.set(node.id, (degree.get(node.id) ?? 0) + 1);
    }
  }
  const metrics: number[] = nodes.map((n: SceneNode): number => n.metric ?? degree.get(n.id) ?? 1);
  const peak: number = Math.max(...metrics, 1);
  return new Map(nodes.map((n: SceneNode, i: number): [string, number] => [n.id, NODE_RADIUS * (0.5 + ((metrics[i] ?? 1) / peak) * 1.2)]));
}

/**
 * Lays out a molecule in one go — {@link molecule_prepare} run to its end.
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
  const settle: MoleculeSettle = molecule_prepare(nodes, dimensions, seed, physics, frozen);
  settle.step(settle.total);
  return settle.place();
}

/**
 * Builds a molecule settle without running it.
 *
 * @param nodes - The graph's nodes.
 * @param dimensions - 2 or 3.
 * @param seed - Where nodes stood last; a seeded node starts there.
 * @param physics - The terms of this settle.
 * @param frozen - Nodes that stand where their seed put them.
 * @returns The settle, ready to step.
 */
function molecule_prepare(
  nodes: SceneNode[],
  dimensions: 2 | 3 = 3,
  seed: Map<string, THREE.Vector3> = new Map(),
  physics: PhysicsTerms = PHYSICS_DEFAULT,
  frozen: ReadonlySet<string> = new Set(),
): MoleculeSettle {
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

  // Radius is physics, not paint: the metric sets each node's room in the
  // settle, so TIME and SIZE reshape the molecule, not just its spheres.
  const radii: number[] = metrics.map(
    (metric: number): number => NODE_RADIUS * (0.5 + (metric / metricPeak) * 1.2),
  );
  const radiusOf: Map<string, number> = new Map(nodes.map((n: SceneNode, i: number): [string, number] => [n.id, radii[i] ?? NODE_RADIUS]));

  // Warm start: a re-projection (a metric flip) morphs from where the
  // graph stands instead of re-rolling a new equilibrium.
  // A frozen node stands where its seed put it and pushes on nothing: the
  // rest of a field holds still while one part of it settles.
  const simNodes: Array<{ id: string; x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number }> = nodes.map(
    (n: SceneNode) => {
      const from: THREE.Vector3 | undefined = seed.get(n.id);
      if (from === undefined) return { id: n.id };
      if (frozen.has(n.id)) return { id: n.id, x: from.x, y: from.y, z: from.z, fx: from.x, fy: from.y, fz: from.z };
      return { id: n.id, x: from.x, y: from.y, z: from.z };
    },
  );
  // Only what moves is simulated. A frozen node with a place stands there
  // and pushes on nothing, so a settle with most of the field frozen (a
  // descent into one feed among three thousand spheres) simulates the free
  // nodes and whatever they link to, not the field: the whole-field settle
  // held the page for seconds and flights caught under it arrived in one
  // frame.
  const pinned = (d: { id: string; fx?: number }): boolean => frozen.has(d.id) && d.fx !== undefined;
  let simulated: typeof simNodes = simNodes;
  let simLinks: typeof links = links;
  if (frozen.size > 0) {
    const free: Set<string> = new Set(simNodes.filter((d): boolean => !pinned(d)).map((d): string => d.id));
    simLinks = links.filter((link): boolean => free.has(link.source) || free.has(link.target));
    const kept: Set<string> = new Set(free);
    for (const link of simLinks) { kept.add(link.source); kept.add(link.target); }
    simulated = simNodes.filter((d): boolean => kept.has(d.id));
    const present: Set<string> = new Set(simulated.map((d): string => d.id));
    simLinks = simLinks.filter((link): boolean => present.has(link.source) && present.has(link.target));
  }
  // In 2D the simulation itself is two-dimensional: a 3D settle flattened
  // afterwards piles nodes that resolved their overlaps in depth.
  const charge = forceManyBody().strength(
    physics.charge
      ? (d: { id: string }): number => (frozen.has(d.id) ? 0 : -6 * ((radiusOf.get(d.id) ?? NODE_RADIUS) / NODE_RADIUS) ** 2)
      : (d: { id: string }): number => (frozen.has(d.id) ? 0 : -6),
  );
  if (physics.reach !== undefined) charge.distanceMax(physics.reach);
  const simulation = forceSimulation(simulated, dimensions)
    .force(
      'link',
      forceLink(simLinks)
        .id((d: { id: string }) => d.id)
        // Edges reach surface to surface: a hub's children orbit its skin.
        .distance(
          physics.link
            ? (link: { source: { id: string }; target: { id: string } }): number =>
                (radiusOf.get(link.source.id) ?? NODE_RADIUS) + (radiusOf.get(link.target.id) ?? NODE_RADIUS) + 1.4
            : 2.2,
        ),
    )
    // Repulsion scales with cross-section: a heavy node carves its room.
    .force('charge', charge)
    .stop();
  // Centering shifts every free node by the mean of ALL nodes each tick;
  // with most of the field frozen that mean never settles and the few free
  // nodes stream away from where they were seeded. A settle with frozen
  // nodes keeps its centre where it is.
  if (frozen.size === 0) {
    simulation.force('center', dimensions === 2 ? forceCenter(0, 0) : forceCenter(0, 0, 0));
  }
  if (physics.collide) {
    simulation.force('collide', forceCollide().radius((d: { id: string }): number => (radiusOf.get(d.id) ?? NODE_RADIUS) * 1.2));
  }
  if (physics.gravity) {
    // Mass-weighted centering: the heaviest stage settles at the heart.
    const pull = (d: { id: string }): number => (((radiusOf.get(d.id) ?? NODE_RADIUS) / NODE_RADIUS) ** 2) * 0.08;
    simulation.force('gx', forceX(0).strength(pull)).force('gy', forceY(0).strength(pull));
    if (dimensions === 3) simulation.force('gz', forceZ(0).strength(pull));
  }
  const total: number = simulated.length === 0 ? 0 : (seed.size > 0 ? 90 : 150);
  let done: number = 0;
  return {
    total,
    moving: simulated.length,
    step: (ticks: number): void => {
      for (let tick: number = 0; tick < ticks && done < total; tick++, done++) simulation.tick();
    },
    place: (): PlacedNode[] => nodes.map((node: SceneNode, index: number): PlacedNode => {
      const sim = simNodes[index];
      return {
        node,
        position: new THREE.Vector3(sim?.x ?? 0, sim?.y ?? 0, sim?.z ?? 0),
        radius: radii[index] ?? NODE_RADIUS,
      };
    }),
  };
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

/** A star's smallest size on screen, in CSS pixels: no node ever vanishes. */
const STAR_FLOOR_PX: number = 2;
/** A star never swells past this many CSS pixels: near the camera a feed is spheres, not a glow. */
const STAR_CAP_PX: number = 28;
/** A star's sprite spans this many times its sphere's diameter: core plus glow. */
const STAR_GLOW: number = 1.8;
/** Threads (edges) while the scene draws stars: faint, so the light leads. */
const THREAD_OPACITY: number = 0.1;
/** A nebula's opacity at its heart; a dimmed one a third of it. */
const NEBULA_OPACITY: number = 0.2;

const STAR_VERTEX: string = `
attribute float radius;
attribute float alpha;
attribute vec3 tint;
uniform float scale;
uniform float floorPx;
uniform float capPx;
varying vec3 vTint;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = ${STAR_GLOW.toFixed(1)} * 2.0 * radius * scale / max(0.0001, -mv.z);
  gl_PointSize = min(max(px, floorPx), capPx);
  vTint = tint;
  vAlpha = alpha;
}`;

/** The glow: a bright core falling off to nothing at the sprite's edge. */
const STAR_FRAGMENT_GLOW: string = `
varying vec3 vTint;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float core = smoothstep(0.6, 0.0, d);
  float halo = pow(1.0 - d, 2.2) * 0.55;
  float a = clamp(core + halo, 0.0, 1.0) * vAlpha;
  gl_FragColor = vec4(vTint * a, a);
}`;

/** The ember: an errored star drawn solid over the glow, so red stays red. */
const STAR_FRAGMENT_EMBER: string = `
varying vec3 vTint;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float a = smoothstep(1.0, 0.35, d) * vAlpha;
  gl_FragColor = vec4(vTint, a);
}`;

/** One star as drawn: whose it is, where, how big, its hue, whether dim, whether errored. */
interface StarEntry {
  id: string;
  position: THREE.Vector3;
  radius: number;
  color: THREE.Color;
  dim: boolean;
  ember: boolean;
  /** Which layer draws it (0 glow, 1 ember) and its slot there, once drawn. */
  layer?: number;
  slot?: number;
}

/** A feed switches to solid when its largest sphere spans this many CSS pixels… */
const HANDOFF_SOLID_PX: number = 7;
/** …and back to stars below this: the gap keeps a feed at the edge from flickering. */
const HANDOFF_STAR_PX: number = 5;
/** The crossfade between a feed's stars and its spheres. */
const HANDOFF_FADE_MS: number = 300;
/** A pulse's trip along one tube; a live edge repeats it. */
const PULSE_TRIP_MS: number = 1200;
/** The rest between two replays of a finished feed's run. */
const REPLAY_REST_MS: number = 1800;
/** A replayed stage before its pulse lands: this share of its colour. */
const LAMP_DIM: number = 0.18;
/** How long a stage's glow blooms out and settles as its pulse lands. */
const LAMP_BLOOM_MS: number = 1000;
/** How far the bloom reaches, in the stage's radii. */
const LAMP_BLOOM_REACH: number = 9;
/** How long the lit stages take to dim before the run replays. */
const LAMP_FADE_MS: number = 500;
/** What a lit stage brightens toward. */
const LAMP_WHITE: THREE.Color = new THREE.Color('#ffffff');

const TUBE_VERTEX: string = `
attribute vec3 aColor;
attribute float aMode;
attribute float aStart;
varying vec3 vColor;
varying float vMode;
varying float vStart;
varying float vAlong;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vAlong = position.y + 0.5;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vColor = aColor;
  vMode = aMode;
  vStart = aStart;
  gl_Position = projectionMatrix * mv;
}`;

/**
 * A tube lit by its facing, carrying a pulse from parent (its foot) to
 * child (its head): mode 1 streams (live), mode 2 replays the run — each
 * stage at vStart into a cycle that rests and repeats — mode 0 rests.
 */
const TUBE_FRAGMENT: string = `
uniform float time;
uniform float opacity;
uniform float born;
uniform float cycle;
varying vec3 vColor;
varying float vMode;
varying float vStart;
varying float vAlong;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  vec3 base = vColor * (0.35 + 0.65 * facing);
  float pulse = 0.0;
  if (vMode > 0.5 && vMode < 1.5) {
    float head = fract(time / ${PULSE_TRIP_MS.toFixed(1)});
    pulse = smoothstep(0.14, 0.0, abs(vAlong - head));
  } else if (vMode > 1.5) {
    // A finished feed replays its run: the wave goes stage by stage in the
    // order the stages ran, rests, and goes again.
    float local = mod(time - born, cycle) - vStart;
    float head = local / ${(PULSE_TRIP_MS / 2).toFixed(1)};
    if (head > -0.1 && head < 1.2) pulse = smoothstep(0.14, 0.0, abs(vAlong - head));
  }
  gl_FragColor = vec4(base + vec3(1.0, 0.95, 0.8) * pulse * 1.3, opacity);
}`;

/** The tube every solid edge wears, stretched and turned per edge. */
let tubeGeometry: THREE.CylinderGeometry | null = null;

/** A unit tube, one high along y, centred: its foot at -0.5, its head at +0.5. */
function tubeGeometry_get(): THREE.CylinderGeometry {
  if (tubeGeometry === null) tubeGeometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  return tubeGeometry;
}

/**
 * One feed (or folded shape) in the hand-off: its stars, where it stands,
 * how far it is between stars (0) and spheres (1), and the spheres and
 * edges that exist only while it is solid.
 */
interface HandoffGroup {
  entries: StarEntry[];
  center: THREE.Vector3;
  maxRadius: number;
  mix: number;
  target: number;
  meshes: THREE.Mesh[];
  lines: THREE.Line[];
  tubes: THREE.InstancedMesh | null;
  threadSegments: number[];
}

/** A soft radial glow, shared by every nebula. */
let nebulaTexture: THREE.Texture | null = null;

/** Draws (once) the nebula's radial glow. */
function nebulaTexture_get(): THREE.Texture {
  if (nebulaTexture !== null) return nebulaTexture;
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
  if (context !== null) {
    const gradient: CanvasGradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  nebulaTexture = new THREE.CanvasTexture(canvas);
  return nebulaTexture;
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

  /** The census cloud, when drawn: instance index → group node id / local position. */
  private censusMesh: THREE.InstancedMesh | null = null;
  private censusIds: string[] = [];
  private censusPositions: THREE.Vector3[] = [];
  /** The census cloud's resting colors, the wave's return point. */
  private censusBase: Float32Array | null = null;

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
  /** Edge lines with their endpoint identities, for live re-anchoring. */
  private edges: Array<{ line: THREE.Line; fromId: string; toId: string; dashed: boolean }> = [];
  private graph: SceneGraph = { nodes: [] };
  /** Idle spin stays paused until this clock time (0 = spinning). */
  private spinIdleUntil: number = 0;
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

  /**
   * Whether the operator has moved the camera (wheel or drag) since the
   * scene last framed the graph itself. A caller repainting the same space
   * asks this before refitting: a refit under a placed camera is a reset.
   */
  private touched: boolean = false;

  /**
   * The world point the camera looks at: the pivot of the idle spin and the
   * orbit, the target of the wheel's dolly, carried by a pan. A flight to a
   * feed or a cluster moves it there, so the space turns about what the
   * operator is looking at instead of swinging it out of view.
   */
  private readonly focus: THREE.Vector3 = new THREE.Vector3();

  /** Turns the graph about an axis through the focus. */
  private turn_about(axis: THREE.Vector3, angle: number): void {
    const q: THREE.Quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    this.group.position.sub(this.focus).applyQuaternion(q).add(this.focus);
    this.group.quaternion.premultiply(q);
  }

  /** How nodes are drawn: lit spheres (every pane), or stars (the universe's choice). */
  private drawMode: DrawMode = 'spheres';
  /** The stars on stage, in draw order, for picking and flights. */
  private stars: StarEntry[] = [];
  /** Star index by node id: a node's first star (census members share one). */
  private starIndex: Map<string, number> = new Map();
  /** Nebulae on stage: a cluster's handle while the scene draws stars. */
  private nebulae: Array<{ id: string; position: THREE.Vector3; radius: number }> = [];
  /** The star materials, whose pixel scale follows the camera each frame. */
  private starMaterials: THREE.ShaderMaterial[] = [];
  /** Each star layer's alpha attribute and the alphas it was drawn with. */
  private starLayers: Array<{ alpha: THREE.BufferAttribute; base: Float32Array }> = [];
  /** The thread batch's colours and the colours it was drawn with. */
  private threadColor: { attribute: THREE.BufferAttribute; base: Float32Array } | null = null;
  /** Feeds in the hand-off, by key. */
  private handoff: Map<string, HandoffGroup> = new Map();
  /** Placed nodes by id, for the spheres a solid feed draws. */
  private placedById: Map<string, PlacedNode> = new Map();
  /** When the hand-off last stepped. */
  private handoffAt: number = 0;
  /** The tube materials on stage, whose pulses follow the clock. */
  private tubeMaterials: THREE.ShaderMaterial[] = [];
  /** Each tube batch and the edges it draws, so a pull can move them. */
  private tubeSets: Array<{ mesh: THREE.InstancedMesh; edges: Array<{ from: string; to: string; width: number }>; lamps: Map<string, number>; blinks: Set<string>; group: HandoffGroup; members: ReadonlySet<string> }> = [];
  /** A status moved under a tube: its tubes are re-read next frame. */
  private tubesStale: boolean = false;
  /** The glow each lit or blinking stage blooms with, by node. */
  private lampGlows: Map<string, THREE.Sprite> = new Map();

  /** Whether the pointer is over the field: the idle spin waits while it is. */
  private pointerInside: boolean = false;
  /** Fingers on the canvas, by pointer id, where each is now. */
  private touches: Map<number, { x: number; y: number }> = new Map();
  /** A two-finger gesture under way: the fingers' last spread and middle. */
  private pinch: { spread: number; midX: number; midY: number } | null = null;
  /** A gesture happened: the finger left behind neither orbits nor taps. */
  private gestureHeld: boolean = false;
  /** The last tap, for a double tap. */
  private lastTap: { at: number; x: number; y: number } | null = null;
  /** What the last press was made with: mouse, pen or touch. */
  private pressKind: string = 'mouse';
  /** When a double tap last entered: a browser's own dblclick after it is the same act. */
  private tapActivatedAt: number = 0;
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
  /** The ambient tumble's wandering rotation axis, reused across frames. */
  private readonly tumbleAxis: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  /** Phase driving the axis wander; seeded randomly so miniatures desync. */
  private tumblePhase: number = Math.random() * Math.PI * 2;
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
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key: THREE.DirectionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(4, 6, 8);
    this.scene.add(key);
    this.scene.add(this.group);
    container.appendChild(this.renderer.domElement);
    this.size_fit();
    if (!this.ambient) {
      // Fingers belong to the scene, not the page: without this the browser
      // takes a pinch for a page zoom and a drag for a scroll.
      this.renderer.domElement.style.touchAction = 'none';
      this.renderer.domElement.addEventListener('click', (event: MouseEvent): void => {
        // The click that ends a pull is the pull's release, not a select.
        if (this.suppressClick) {
          this.suppressClick = false;
          return;
        }
        // A finger has no double click it can count on: two taps close in
        // time and place are one, and enter as a double click does.
        if (this.pressKind === 'touch') {
          const now: number = Date.now();
          const last = this.lastTap;
          if (last !== null && now - last.at <= DOUBLE_TAP_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) <= DOUBLE_TAP_PX) {
            this.lastTap = null;
            this.tapActivatedAt = now;
            this.pick_handle(event, 'activate');
            return;
          }
          this.lastTap = { at: now, x: event.clientX, y: event.clientY };
        }
        this.pick_handle(event, 'select');
      });
      this.renderer.domElement.addEventListener('dblclick', (event: MouseEvent): void => {
        if (Date.now() - this.tapActivatedAt < 600) return;
        this.pick_handle(event, 'activate');
      });
      this.renderer.domElement.addEventListener('pointerdown', (event: PointerEvent): void => {
        this.pressKind = event.pointerType;
        if (event.pointerType === 'touch') {
          // The first finger of a new touch starts clean: a lift the browser
          // never reported (a cancelled gesture, a system swipe) must not
          // leave a phantom finger that turns every later tap into a third.
          if (event.isPrimary) {
            this.touches.clear();
            this.pinch = null;
            this.gestureHeld = false;
          }
          this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (this.touches.size === 2) {
            this.gesture_begin();
            return;
          }
          if (this.touches.size > 2 || this.gestureHeld) return;
          this.press_handle(event);
          // No hover under a finger: the press names what it landed on —
          // after the press, which clears the tip a cursor leaves behind.
          this.hover_handle(event);
          return;
        }
        this.press_handle(event);
      });
      const release = (event: PointerEvent): void => {
        if (event.pointerType === 'touch') {
          this.touches.delete(event.pointerId);
          if (this.touches.size < 2) this.pinch = null;
          if (this.touches.size === 0 && this.gestureHeld) {
            this.gestureHeld = false;
            // The lift that ends a gesture is not a tap.
            this.suppressClick = true;
            window.setTimeout((): void => { this.suppressClick = false; }, 400);
          }
        }
        this.drag_end();
      };
      this.renderer.domElement.addEventListener('pointerup', release);
      this.renderer.domElement.addEventListener('pointercancel', release);
      // Hovering names the node: a small tip follows the pointer over a
      // sphere, so identity does not cost a click.
      this.tip = document.createElement('div');
      this.tip.className = 'dag-node-tip';
      this.tip.hidden = true;
      container.appendChild(this.tip);
      this.renderer.domElement.addEventListener('pointermove', (event: PointerEvent): void => {
        if (event.pointerType === 'touch' && this.touches.has(event.pointerId)) {
          this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (this.pinch !== null) {
            this.gesture_move();
            return;
          }
          if (this.gestureHeld) return;
        }
        if (this.drag !== null) {
          this.drag_move(event);
        } else if (this.viewDrag !== null) {
          this.view_move(event);
        } else {
          this.hover_handle(event);
        }
      });
      this.renderer.domElement.addEventListener('pointerleave', (event: PointerEvent): void => {
        this.pointerInside = false;
        this.hovered = null;
        // A finger lifting leaves the canvas at once; its name stays up a
        // moment so it can be read.
        if (event.pointerType === 'touch' && this.tip !== null && !this.tip.hidden) {
          if (this.tapTipTimer !== null) window.clearTimeout(this.tapTipTimer);
          this.tapTipTimer = window.setTimeout((): void => {
            this.tapTipTimer = null;
            if (this.tip !== null && this.touches.size === 0) this.tip.hidden = true;
          }, TAP_TIP_MS);
          return;
        }
        if (this.tip) this.tip.hidden = true;
      });
      // The wheel dollies: closer to read a dense graph, back for the whole.
      this.renderer.domElement.addEventListener('wheel', (event: WheelEvent): void => {
        event.preventDefault();
        this.camera_dolly(event.deltaY);
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
          !this.pointerInside &&
          !this.holding &&
          this.flight === null &&
          this.projection === '3d'
        ) {
          this.turn_about(WORLD_UP, SPIN_INTERACTIVE);
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
        this.flight_animate();
      }
      this.starScale_update();
      this.handoff_step();
      if (this.tubeMaterials.length > 0) {
        const now: number = performance.now();
        for (const material of this.tubeMaterials) {
          const time = material.uniforms['time'];
          if (time !== undefined) time.value = now;
        }
        if (this.tubesStale) this.tubes_restatus();
        this.lamps_animate(now);
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
    const censusIndex: number = mesh === undefined ? this.censusIds.indexOf(nodeId) : -1;
    if ((mesh === undefined && censusIndex < 0) || this.flight !== null || this.holding) {
      return;
    }
    // The dive leaves the graph exactly as the operator has it — no reset
    // snap. Holding first: the spin must not move the target mid-aim.
    this.holding = true;
    this.flightHome = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
    };
    // Aim the camera at the node from its current stance, then dolly to just
    // shy of the surface — arrival reads as passing inside. World position:
    // the camera flies in world space, and the group may be rotated.
    this.group.updateMatrixWorld(true);
    const target: THREE.Vector3 =
      mesh !== undefined
        ? mesh.getWorldPosition(new THREE.Vector3())
        : this.group.localToWorld((this.censusPositions[censusIndex] ?? new THREE.Vector3()).clone());
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
    const points: THREE.Vector3[] = [];
    let radiusMax: number = 0;
    this.group.updateMatrixWorld(true);
    for (const id of this.drawnIds()) {
      if (wanted.size > 0 && !wanted.has(id)) continue;
      const drawn = this.nodeWorld_of(id);
      if (drawn === null) continue;
      points.push(drawn.position);
      radiusMax = Math.max(radiusMax, drawn.radius);
    }
    if (points.length === 0) {
      onDone();
      return;
    }
    const center: THREE.Vector3 = new THREE.Vector3();
    for (const point of points) center.add(point);
    center.divideScalar(points.length);
    const distances: number[] = points.map((point: THREE.Vector3): number => center.distanceTo(point)).sort((a: number, b: number): number => a - b);
    const kept: number = Math.max(1, Math.min(distances.length, Math.ceil(distances.length * Math.min(1, Math.max(0.1, bulk)))));
    const radius: number = Math.max(1, (distances[kept - 1] ?? 1) + radiusMax);
    const fov: number = (this.camera.fov * Math.PI) / 180;
    const fitH: number = radius / Math.tan(fov / 2);
    const fitW: number = radius / (Math.tan(fov / 2) * Math.max(0.1, this.camera.aspect));
    const distance: number = Math.max(3, Math.max(fitH, fitW) * margin);
    // Approach along the line the camera already looks down, so the flight
    // reads as a dolly and never a swing round the field.
    const heading: THREE.Vector3 = this.camera.position.clone().sub(center);
    if (heading.lengthSq() < 0.0001) heading.set(0, 0, 1);
    heading.normalize();
    const toPos: THREE.Vector3 = center.clone().add(heading.multiplyScalar(distance));
    const aim: THREE.Camera = this.camera.clone();
    aim.position.copy(toPos);
    aim.lookAt(center);
    this.focus.copy(center);
    this.camera.far = Math.max(this.camera.far, (distance + radius) * 2);
    this.camera.updateProjectionMatrix();
    this.flight = {
      fromPos: this.camera.position.clone(),
      toPos,
      fromQuat: this.camera.quaternion.clone(),
      toQuat: aim.quaternion.clone(),
      startedAt: Date.now(),
      durationMs,
      onDone,
    };
  }

  /**
   * Whether the operator has placed the camera since the scene last framed
   * the graph: a wheel or a drag. A repaint of the same space keeps a
   * placed camera; a fresh space is framed whole.
   *
   * @returns True once the operator has wheeled or dragged since the last fit.
   */
  public camera_touched(): boolean {
    return this.touched;
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
    let groupsSolid: number = 0;
    for (const group of this.handoff.values()) if (group.mix > 0) groupsSolid += 1;
    return {
      draw: this.drawMode,
      arrangement: this.arrangement,
      census: this.census,
      nodes: this.graph.nodes.length,
      meshes: this.meshes.size,
      stars: this.stars.length,
      solidMarked: solidMarked.length,
      solidDrawn,
      tubes: this.tubeMaterials.length,
      handoffGroups: this.handoff.size,
      handoffSolid: groupsSolid,
      camera: this.camera.position.distanceTo(this.focus).toFixed(1),
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
    const center: THREE.Vector3 = drawn.position;
    const heading: THREE.Vector3 = this.camera.position.clone().sub(center);
    if (heading.lengthSq() < 0.0001) heading.set(0, 0, 1);
    heading.normalize();
    const toPos: THREE.Vector3 = center.clone().add(heading.multiplyScalar(Math.max(distance, drawn.radius * 4)));
    const aim: THREE.Camera = this.camera.clone();
    aim.position.copy(toPos);
    aim.lookAt(center);
    this.focus.copy(center);
    this.flight = {
      fromPos: this.camera.position.clone(),
      toPos,
      fromQuat: this.camera.quaternion.clone(),
      toQuat: aim.quaternion.clone(),
      startedAt: Date.now(),
      durationMs,
      onDone,
    };
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
    return this.holding;
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
    if (this.census && this.censusMesh !== null && this.censusBase !== null && this.censusMesh.instanceColor) {
      // The wave rides the cloud: every member flares with its group's
      // fire time, written straight into the instance color buffer.
      const colors: Float32Array = this.censusMesh.instanceColor.array as Float32Array;
      const base: Float32Array = this.censusBase;
      const pulse: THREE.Color = this.pulseColor;
      for (let i = 0; i < this.censusIds.length; i++) {
        const fireAt: number | undefined = this.waveTimes.get(this.censusIds[i] ?? '');
        if (fireAt === undefined) continue;
        peak = Math.max(peak, fireAt);
        const dt: number = elapsed - fireAt;
        const flare: number =
          dt >= 0 && dt <= WAVE_FLARE_MS ? Math.sin((dt / WAVE_FLARE_MS) * Math.PI) : 0;
        const o: number = i * 3;
        colors[o] = base[o]! + (pulse.r - base[o]!) * flare;
        colors[o + 1] = base[o + 1]! + (pulse.g - base[o + 1]!) * flare;
        colors[o + 2] = base[o + 2]! + (pulse.b - base[o + 2]!) * flare;
      }
      this.censusMesh.instanceColor.needsUpdate = true;
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
    for (const [id, mesh] of this.meshes) {
      if (!(mesh.material instanceof THREE.MeshStandardMaterial)) continue;
      const on: boolean = id === this.selectedId;
      mesh.material.emissive.set(on ? '#ffffff' : '#000000');
      mesh.material.emissiveIntensity = on ? 0.35 : 0;
    }
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
    const mesh: THREE.Mesh | undefined = this.meshes.get(nodeId);
    if (mesh && mesh.material instanceof THREE.MeshStandardMaterial) {
      const isRoot: boolean = node.parentIds.length === 0 && node.joinParentIds.length === 0;
      mesh.material.color = nodeColor_pick(node, palette_read(), isRoot);
      delete mesh.userData['lampBase'];
    }
    // A stage that started or finished changes what its tubes carry: a
    // stream, a replay, or nothing.
    if (this.tubeSets.some((entry): boolean => entry.members.has(nodeId))) this.tubesStale = true;
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
    this.renderer.dispose();
    this.renderer.domElement.remove();
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
    // A ghost (a cluster's anchor, drawn as a halo in shape) is nobody's
    // job: it carries the feeds it gathers as a count, and a census of it
    // would draw a shell of nothing.
    let total: number = 0;
    for (const item of placed) if (item.node.ghost !== true) total += Math.max(1, item.node.count ?? 1);
    const geometry: THREE.IcosahedronGeometry = new THREE.IcosahedronGeometry(1, 1);
    const material: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.5,
      metalness: 0.1,
    });
    // Under stars the members are points of light like any star; the
    // instanced spheres are the SPHERES draw.
    const starring: boolean = this.drawMode === 'stars';
    const starred: StarEntry[] = [];
    const instanced: THREE.InstancedMesh = new THREE.InstancedMesh(geometry, material, starring ? 1 : total);
    const color: THREE.Color = new THREE.Color();
    const carrier: THREE.Object3D = new THREE.Object3D();
    const memberPositions: Map<string, THREE.Vector3[]> = new Map();
    let index: number = 0;
    let cloudRadius: number = 1;
    const center: THREE.Vector3 = new THREE.Vector3();
    for (const item of placed) center.add(item.position);
    center.divideScalar(Math.max(1, placed.length));

    for (const { node, position, radius } of placed) {
      if (node.ghost === true) continue;
      const n: number = Math.max(1, node.count ?? 1);
      const shellRadius: number = n === 1 ? 0 : radius * (1.6 + 0.55 * Math.cbrt(n));
      const memberRadius: number =
        n === 1 ? radius : Math.max(0.06, Math.min(radius * 0.5, (2.2 * shellRadius) / Math.sqrt(n)));
      const points: THREE.Vector3[] = [];
      for (let k = 0; k < n; k++) {
        const point: THREE.Vector3 =
          n === 1 ? position.clone() : fibonacciPoint_make(k, n, shellRadius).add(position);
        points.push(point);
        const isRoot: boolean = node.parentIds.length === 0 && node.joinParentIds.length === 0;
        color.set(nodeColor_pick(node, palette, isRoot));
        if (starring) {
          starred.push({
            id: node.id, position: point, radius: memberRadius, color: color.clone(), dim: node.dim === true,
            ember: (node.share !== undefined && node.share > 0) || node.status === 'finishedWithError',
          });
        } else {
          carrier.position.copy(point);
          carrier.scale.setScalar(memberRadius);
          carrier.updateMatrix();
          instanced.setMatrixAt(index, carrier.matrix);
          instanced.setColorAt(index, color);
        }
        this.censusIds.push(node.id);
        this.censusPositions.push(point);
        index += 1;
        cloudRadius = Math.max(cloudRadius, center.distanceTo(point) + memberRadius);
      }
      memberPositions.set(node.id, points);
    }
    if (starring) {
      this.stars_draw(starred);
    } else {
      if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
      this.group.add(instanced);
      this.censusMesh = instanced;
      this.censusBase = instanced.instanceColor ? Float32Array.from(instanced.instanceColor.array) : null;
    }

    const segments: number[] = [];
    for (const { node } of placed) {
      const mine: THREE.Vector3[] = memberPositions.get(node.id) ?? [];
      for (const parentId of node.parentIds) {
        const theirs: THREE.Vector3[] | undefined = memberPositions.get(parentId);
        if (!theirs || theirs.length === 0) continue;
        for (let k = 0; k < mine.length; k++) {
          const a: THREE.Vector3 | undefined = mine[k];
          const b: THREE.Vector3 | undefined =
            theirs.length === mine.length ? theirs[k] : theirs[k % theirs.length];
          if (a === undefined || b === undefined) continue;
          segments.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    if (segments.length > 0) {
      const edgeGeometry: THREE.BufferGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
      const lines: THREE.LineSegments = new THREE.LineSegments(
        edgeGeometry,
        starring
          ? new THREE.LineBasicMaterial({ color: palette.edge, transparent: true, opacity: THREAD_OPACITY, blending: THREE.AdditiveBlending, depthWrite: false })
          : new THREE.LineBasicMaterial({ color: palette.edge, transparent: true, opacity: 0.35 }),
      );
      this.group.add(lines);
    }

    // The census parks the camera only when a framing was asked for: a
    // descent redraws under a camera the flight has placed, and re-parking
    // it there was the view resetting under every click.
    if (!this.ambient && fit) {
      const fov: number = (this.camera.fov * Math.PI) / 180;
      const fitH: number = cloudRadius / Math.tan(fov / 2);
      const fitW: number = cloudRadius / (Math.tan(fov / 2) * Math.max(0.1, this.camera.aspect));
      const distance: number = Math.max(8, Math.max(fitH, fitW) * 1.15);
      this.group.position.copy(center).applyQuaternion(this.group.quaternion).negate();
      this.focus.set(0, 0, 0);
      // A census cloud grown from near-planar anchors reads edge-on from
      // the axis; open on a three-quarter orbit so the shells read as
      // volume from the first frame.
      this.camera.position.set(distance * 0.5, distance * 0.4, distance * 0.85);
      this.camera.far = Math.max(200, (distance + cloudRadius) * 2.5);
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(0, 0, 0);
    }
  }

  private camera_fit(placed: PlacedNode[]): void {
    if (placed.length === 0) return;
    this.touched = false;
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
    const fov: number = (this.camera.fov * Math.PI) / 180;
    const fitH: number = radius / Math.tan(fov / 2);
    const fitW: number = radius / (Math.tan(fov / 2) * Math.max(0.1, this.camera.aspect));
    const distance: number = Math.max(8, Math.max(fitH, fitW) * 1.15);
    this.group.position.copy(center).applyQuaternion(this.group.quaternion).negate();
    this.focus.set(0, 0, 0);
    this.camera.position.set(0, 0, distance);
    // The far plane always clears the framed graph: the fixed 200 clipped
    // sprawling molecules into black voids (and swallowed 2D whole).
    this.camera.far = Math.max(200, (distance + radius) * 2);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 0, 0);
  }

  /** Sphere geometries by radius, shared: a node's geometry is never mutated. */
  private readonly spheres: Map<number, THREE.SphereGeometry> = new Map();

  /** A sphere of a radius, shared across nodes and rebuilds. */
  private sphere_of(radius: number): THREE.SphereGeometry {
    const key: number = Math.round(radius * 1000);
    let geometry: THREE.SphereGeometry | undefined = this.spheres.get(key);
    if (geometry === undefined) {
      geometry = new THREE.SphereGeometry(key / 1000, 24, 18);
      geometry.computeBoundingSphere();
      this.spheres.set(key, geometry);
    }
    return geometry;
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
    const settle: MoleculeSettle = molecule_prepare(
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
    worker.onmessage = (event: MessageEvent<{ generation: number; type: 'progress' | 'done'; fraction?: number; positions?: HierarchyPositions }>): void => {
      const answer = event.data;
      if (answer.generation !== this.rebuildGen || this.disposed) return;
      if (answer.type === 'progress') {
        progress(Math.min(total - 1, Math.floor((answer.fraction ?? 0) * total)), total, count);
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
    this.meshes = new Map();
    this.edges = [];
    this.censusMesh = null;
    this.censusIds = [];
    this.censusPositions = [];
    this.censusBase = null;
    this.dragSim = null;
    this.dragSimNodes = [];
    this.drag = null;
    this.stars = [];
    this.starIndex = new Map();
    this.nebulae = [];
    this.starMaterials = [];
    this.starLayers = [];
    this.threadColor = null;
    this.handoff = new Map();
    this.placedById = new Map();
    this.tubeMaterials = [];
    this.tubeSets = [];
    for (const glow of this.lampGlows.values()) glow.material.dispose();
    this.lampGlows = new Map();
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
        // A cluster's handle: translucent, unlit, written last so the
        // spheres inside it show through; picked only when nothing solid is.
        const haloGeometry: THREE.SphereGeometry = new THREE.SphereGeometry(haloRadius_of(node.count ?? 1), 24, 18);
        const haloMaterial: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({
          color: palette.edge, transparent: true, opacity: node.dim === true ? HALO_OPACITY * 0.4 : HALO_OPACITY, depthWrite: false,
        });
        const halo: THREE.Mesh = new THREE.Mesh(haloGeometry, haloMaterial);
        halo.position.copy(position);
        halo.renderOrder = 1;
        halo.userData['nodeId'] = node.id;
        halo.userData['halo'] = true;
        // A dimmed halo is scenery like a dimmed sphere: it takes no pointer.
        halo.userData['dim'] = node.dim === true;
        this.group.add(halo);
        this.meshes.set(node.id, halo);
        continue;
      }
      const isRoot: boolean = node.parentIds.length === 0 && node.joinParentIds.length === 0;
      // 2D is drawn flat: discs, not lit spheres — the schematic reading
      // all the way down. Uniform normals face the camera, so the shared
      // material pipeline (status color, selection, flare) carries over.
      const geometry: THREE.BufferGeometry =
        this.projection === '2d'
          ? new THREE.CircleGeometry(radius, 36)
          : this.sphere_of(radius);
      const material: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
        color: nodeColor_pick(node, palette, isRoot),
        roughness: 0.35,
        metalness: 0.15,
        emissive: node.id === this.selectedId ? new THREE.Color('#ffffff') : new THREE.Color('#000000'),
        emissiveIntensity: node.id === this.selectedId ? 0.35 : 0,
        ...(node.dim === true ? { transparent: true, opacity: DIM_OPACITY } : {}),
      });
      const mesh: THREE.Mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.userData['nodeId'] = node.id;
      // A dimmed node is scenery: it is drawn behind the graph in hand and
      // takes no pointer, so a hover or a click through a feed's nodes
      // never lands on the field they stand in.
      mesh.userData['dim'] = node.dim === true;
      this.group.add(mesh);
      this.meshes.set(node.id, mesh);
    }

    if (starred.length > 0) this.stars_draw(starred);
    for (const item of placed) this.placedById.set(item.node.id, item);
    if (handoffKey !== undefined) this.handoff_gather(starred, handoffKey);
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
      if (key !== null) this.handoff.get(key)?.threadSegments.push(segment);
    };
    for (const item of placed) {
      const { node, position } = item;
      if (node.ghost === true) continue;
      for (const parentId of node.parentIds) {
        const parent: PlacedNode | undefined = byId.get(parentId);
        if (!parent || parent.node.ghost === true) continue;
        const dim: boolean = node.dim === true || parent.node.dim === true;
        if (solid(item) && solid(parent)) { if (!starring && dim) this.edge_add(parentId, node.id, parent.position, position, palette.edge, false, dim); }
        else thread_add(parent.position, position, palette.edge, dim, node);
      }
      for (const joinId of node.joinParentIds) {
        const parent: PlacedNode | undefined = byId.get(joinId);
        if (!parent) continue;
        const dim: boolean = node.dim === true || parent.node.dim === true;
        if (solid(item) && solid(parent)) { if (!starring && dim) this.edge_add(joinId, node.id, parent.position, position, palette.join, true, dim); }
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
        const entered: HandoffGroup = {
          entries: solidIds.map((id: string): StarEntry => ({ id, position: new THREE.Vector3(), radius: 0, color: new THREE.Color(), dim: false, ember: false })),
          center: new THREE.Vector3(), maxRadius: 0, mix: 1, target: 1, meshes: [], lines: [], tubes: null, threadSegments: [],
        };
        this.tubes_build(entered, new Set(solidIds), palette);
      }
    }
    if (threads.length > 0) {
      const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(threads, 3));
      const colors: THREE.Float32BufferAttribute = new THREE.Float32BufferAttribute(threadColors, 3);
      geometry.setAttribute('color', colors);
      this.threadColor = { attribute: colors, base: Float32Array.from(threadColors) };
      this.group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: THREAD_OPACITY, blending: THREE.AdditiveBlending, depthWrite: false,
      })));
    }

  }

  /**
   * Gathers the drawn stars into feeds for the hand-off. A dimmed star is
   * scenery and never turns solid; a star with no feed stays a star.
   */
  private handoff_gather(starred: StarEntry[], keyOf: (node: SceneNode) => string | null): void {
    const byId: Map<string, SceneNode> = new Map(this.graph.nodes.map((node: SceneNode): [string, SceneNode] => [node.id, node]));
    for (const entry of starred) {
      if (entry.dim) continue;
      const node: SceneNode | undefined = byId.get(entry.id);
      const key: string | null = node === undefined ? null : keyOf(node);
      if (key === null) continue;
      let group: HandoffGroup | undefined = this.handoff.get(key);
      if (group === undefined) {
        group = { entries: [], center: new THREE.Vector3(), maxRadius: 0, mix: 0, target: 0, meshes: [], lines: [], tubes: null, threadSegments: [] };
        this.handoff.set(key, group);
      }
      group.entries.push(entry);
      group.maxRadius = Math.max(group.maxRadius, entry.radius);
    }
    for (const group of this.handoff.values()) {
      for (const entry of group.entries) group.center.add(entry.position);
      group.center.divideScalar(Math.max(1, group.entries.length));
    }
  }

  /**
   * Steps the hand-off once a frame: a feed whose largest sphere spans
   * more than a few pixels turns solid, crossfading, its threads rising
   * to edges; one that shrinks back goes to stars and its spheres are let go.
   */
  private handoff_step(): void {
    if (this.handoff.size === 0) return;
    const now: number = performance.now();
    const dt: number = this.handoffAt === 0 ? 0 : Math.min(100, now - this.handoffAt);
    this.handoffAt = now;
    const height: number = this.renderer.domElement.clientHeight || 1;
    const perUnit: number = height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.group.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    const view: THREE.Matrix4 = new THREE.Matrix4().multiplyMatrices(this.camera.matrixWorldInverse, this.group.matrixWorld);
    const v: number[] = view.elements;
    let starsTouched: boolean = false;
    let threadsTouched: boolean = false;
    for (const group of this.handoff.values()) {
      // Its nearest sphere decides: a sprawling feed with one sphere at the
      // camera turns solid, rather than leaving that sphere a swelling star.
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
      if (group.mix > 0 && group.meshes.length === 0) this.handoffSolid_build(group);
      for (const mesh of group.meshes) {
        if (mesh.material instanceof THREE.MeshStandardMaterial) mesh.material.opacity = group.mix;
      }
      for (const line of group.lines) {
        if (line.material instanceof THREE.LineBasicMaterial) line.material.opacity = 0.75 * group.mix;
      }
      if (group.tubes !== null && group.tubes.material instanceof THREE.ShaderMaterial) {
        const opacity = group.tubes.material.uniforms['opacity'];
        if (opacity !== undefined) opacity.value = group.mix;
      }
      for (const entry of group.entries) {
        const layer = entry.layer === undefined ? undefined : this.starLayers[entry.layer];
        if (layer === undefined || entry.slot === undefined) continue;
        layer.alpha.setX(entry.slot, (layer.base[entry.slot] ?? 1) * (1 - group.mix));
        starsTouched = true;
      }
      if (this.threadColor !== null && group.threadSegments.length > 0) {
        const colors = this.threadColor.attribute.array as Float32Array;
        const base: Float32Array = this.threadColor.base;
        for (const segment of group.threadSegments) {
          for (let k = segment * 6; k < segment * 6 + 6; k++) colors[k] = (base[k] ?? 0) * (1 - group.mix);
        }
        threadsTouched = true;
      }
      if (group.mix === 0) this.handoffSolid_release(group);
    }
    if (starsTouched) for (const layer of this.starLayers) layer.alpha.needsUpdate = true;
    if (threadsTouched && this.threadColor !== null) this.threadColor.attribute.needsUpdate = true;
  }

  /** Draws a feed's spheres and edges for its time as solid. */
  private handoffSolid_build(group: HandoffGroup): void {
    const palette = palette_read();
    const members: Set<string> = new Set(group.entries.map((entry: StarEntry): string => entry.id));
    for (const entry of group.entries) {
      const placed: PlacedNode | undefined = this.placedById.get(entry.id);
      if (placed === undefined) continue;
      const node: SceneNode = placed.node;
      const isRoot: boolean = node.parentIds.length === 0 && node.joinParentIds.length === 0;
      const mesh: THREE.Mesh = new THREE.Mesh(this.sphere_of(placed.radius), new THREE.MeshStandardMaterial({
        color: nodeColor_pick(node, palette, isRoot), roughness: 0.35, metalness: 0.15, transparent: true, opacity: group.mix,
      }));
      mesh.position.copy(placed.position);
      mesh.userData['nodeId'] = node.id;
      mesh.userData['dim'] = false;
      this.group.add(mesh);
      this.meshes.set(node.id, mesh);
      group.meshes.push(mesh);
    }
    this.tubes_build(group, members, palette);
  }

  /**
   * A solid feed's edges as tubes, each carrying pulses from parent to
   * child: a tube into a running or waiting stage streams (data is moving
   * there now); a finished feed fires once as it turns solid, stage by
   * stage in the order it ran, and rests; a tube into a failed stage is
   * red, and the wave stops there as the run did.
   */
  private tubes_build(group: HandoffGroup, members: ReadonlySet<string>, palette: ReturnType<typeof palette_read>): void {
    const edges: Array<{ from: PlacedNode; to: PlacedNode; join: boolean }> = [];
    for (const entry of group.entries) {
      const child: PlacedNode | undefined = this.placedById.get(entry.id);
      if (child === undefined) continue;
      for (const parentId of child.node.parentIds) {
        const parent: PlacedNode | undefined = this.placedById.get(parentId);
        if (parent !== undefined && members.has(parentId)) edges.push({ from: parent, to: child, join: false });
      }
      for (const parentId of child.node.joinParentIds) {
        const parent: PlacedNode | undefined = this.placedById.get(parentId);
        if (parent !== undefined && members.has(parentId)) edges.push({ from: parent, to: child, join: true });
      }
    }
    if (edges.length === 0) return;
    // A stage's depth in its feed: the wave reaches it that many steps in.
    const depth: Map<string, number> = new Map();
    const depth_of = (id: string, seen: Set<string> = new Set()): number => {
      const known: number | undefined = depth.get(id);
      if (known !== undefined) return known;
      if (seen.has(id)) return 0;
      seen.add(id);
      const placed: PlacedNode | undefined = this.placedById.get(id);
      const parents: string[] = placed === undefined ? [] : [...placed.node.parentIds, ...placed.node.joinParentIds].filter((p: string): boolean => members.has(p));
      const d: number = parents.length === 0 ? 0 : 1 + Math.max(...parents.map((p: string): number => depth_of(p, seen)));
      depth.set(id, d);
      return d;
    };
    const fired = (node: SceneNode): boolean => node.status === 'finishedSuccessfully' || node.status === 'finishedWithError' || (node.share !== undefined && node.status !== undefined && !RUNNING_STATUSES.has(node.status));
    const now: number = performance.now();
    const colors: Float32Array = new Float32Array(edges.length * 3);
    const modes: Float32Array = new Float32Array(edges.length);
    const starts: Float32Array = new Float32Array(edges.length);
    const bright: THREE.Color = palette.edge.clone().lerp(new THREE.Color('#ffffff'), 0.45);
    const mesh: THREE.InstancedMesh = new THREE.InstancedMesh(tubeGeometry_get(), new THREE.ShaderMaterial({
      uniforms: { time: { value: now }, opacity: { value: group.mix }, born: { value: now }, cycle: { value: 1 } },
      vertexShader: TUBE_VERTEX,
      fragmentShader: TUBE_FRAGMENT,
      transparent: true,
    }), edges.length);
    const up: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
    const carrier: THREE.Object3D = new THREE.Object3D();
    let deepest: number = 0;
    const set: Array<{ from: string; to: string; width: number }> = [];
    // A replayed stage lights when its pulse arrives: the root at once,
    // every other stage as the first tube into it lands.
    const lamps: Map<string, number> = new Map();
    // A running stage blinks with the stream: lit each time a pulse lands,
    // dark again before the next, until it is done.
    const blinks: Set<string> = new Set();
    edges.forEach(({ from, to, join }: { from: PlacedNode; to: PlacedNode; join: boolean }, i: number): void => {
      const along: THREE.Vector3 = to.position.clone().sub(from.position);
      const length: number = along.length();
      // Thick enough to read as a tube, not a hairline, at the feed's framing.
      const width: number = Math.max(0.06, Math.min(from.radius, to.radius) * 0.34);
      carrier.position.copy(from.position).addScaledVector(along, 0.5);
      carrier.quaternion.setFromUnitVectors(up, length > 0 ? along.clone().divideScalar(length) : up);
      carrier.scale.set(width, length, width);
      carrier.updateMatrix();
      mesh.setMatrixAt(i, carrier.matrix);
      set.push({ from: from.node.id, to: to.node.id, width });
      const failed: boolean = to.node.status === 'finishedWithError' || (to.node.share !== undefined && to.node.share >= 1);
      const color: THREE.Color = failed ? palette.error : join ? palette.join : bright;
      colors.set([color.r, color.g, color.b], i * 3);
      const live: boolean = to.node.status !== undefined && RUNNING_STATUSES.has(to.node.status);
      modes[i] = live ? 1 : (fired(to.node) ? 2 : 0);
      const depth: number = depth_of(from.node.id);
      deepest = Math.max(deepest, depth);
      starts[i] = depth * WAVE_STEP_MS;
      if (modes[i] === 1) blinks.add(to.node.id);
      if (modes[i] === 2) {
        const landed: number = starts[i]! + PULSE_TRIP_MS / 2;
        lamps.set(to.node.id, Math.min(lamps.get(to.node.id) ?? Infinity, landed));
        if (depth === 0) lamps.set(from.node.id, 0);
      }
    });
    mesh.geometry = tubeGeometry_get();
    mesh.instanceMatrix.needsUpdate = true;
    // Instanced attributes ride a clone of the shared tube, so each feed's
    // tubes carry their own colours and pulses.
    const geometry: THREE.BufferGeometry = tubeGeometry_get().clone();
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    geometry.setAttribute('aMode', new THREE.InstancedBufferAttribute(modes, 1));
    geometry.setAttribute('aStart', new THREE.InstancedBufferAttribute(starts, 1));
    mesh.geometry = geometry;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    group.tubes = mesh;
    if (mesh.material instanceof THREE.ShaderMaterial) {
      this.tubeMaterials.push(mesh.material);
      const cycle = mesh.material.uniforms['cycle'];
      if (cycle !== undefined) cycle.value = (deepest + 1) * WAVE_STEP_MS + PULSE_TRIP_MS / 2 + REPLAY_REST_MS;
    }
    this.tubeSets.push({ mesh, edges: set, lamps, blinks, group, members });
  }

  /**
   * Lights a replayed feed's stages on its tubes' clock: every stage starts
   * the cycle dimmed, flares as its pulse lands and stays lit, and the lot
   * dims again as the rest runs out — then the run replays.
   *
   * @param now - This frame's time, the tubes' own.
   */
  private lamps_animate(now: number): void {
    const shown: Set<string> = new Set();
    for (const { mesh: tubes, lamps, blinks } of this.tubeSets) {
      if ((lamps.size === 0 && blinks.size === 0) || !(tubes.material instanceof THREE.ShaderMaterial)) continue;
      const born: number = Number(tubes.material.uniforms['born']?.value ?? now);
      const cycle: number = Number(tubes.material.uniforms['cycle']?.value ?? 1);
      const local: number = (((now - born) % cycle) + cycle) % cycle;
      // Out of the cycle's last stretch every lamp fades back down.
      const fade: number = Math.min(1, Math.max(0, (cycle - local) / LAMP_FADE_MS));
      for (const [id, landed] of lamps) {
        const since: number = local - landed;
        this.lamp_paint(id, since < 0 ? 0 : fade, since >= 0 && since < LAMP_BLOOM_MS ? since / LAMP_BLOOM_MS : -1, shown);
      }
      // The stream's pulse lands every trip; a running stage flares then
      // and dies back toward dark.
      const trip: number = ((now % PULSE_TRIP_MS) + PULSE_TRIP_MS) % PULSE_TRIP_MS;
      for (const id of blinks) {
        if (lamps.has(id)) continue;
        const decay: number = Math.max(0, 1 - trip / (PULSE_TRIP_MS * 0.8));
        this.lamp_paint(id, decay * decay, trip < LAMP_BLOOM_MS ? trip / LAMP_BLOOM_MS : -1, shown);
      }
    }
    for (const [id, glow] of this.lampGlows) {
      if (shown.has(id)) continue;
      glow.visible = false;
      if (!this.meshes.has(id)) {
        this.group.remove(glow);
        glow.material.dispose();
        this.lampGlows.delete(id);
      }
    }
  }

  /**
   * Paints one stage's lamp: its colour from dark to lit, and — while a
   * pulse has just landed — a flash toward white and a glow that blooms
   * out and settles.
   *
   * @param id - The stage.
   * @param lit - How lit it stands, 0 (dark) to 1.
   * @param bloom - How far through its bloom, 0..1; below 0 when none.
   * @param shown - Collects the stages whose glow shows this frame.
   */
  private lamp_paint(id: string, lit: number, bloom: number, shown: Set<string>): void {
    const sphere: THREE.Mesh | undefined = this.meshes.get(id);
    if (sphere === undefined || !(sphere.material instanceof THREE.MeshStandardMaterial)) return;
    let base: unknown = sphere.userData['lampBase'];
    if (!(base instanceof THREE.Color)) {
      base = sphere.material.color.clone();
      sphere.userData['lampBase'] = base;
    }
    const flash: number = bloom < 0 ? 0 : (1 - bloom) ** 2;
    sphere.material.color
      .copy(base as THREE.Color)
      .multiplyScalar(LAMP_DIM + (1 - LAMP_DIM) * Math.max(lit, flash))
      .lerp(LAMP_WHITE, Math.min(1, 0.22 * lit + 0.7 * flash));
    if (bloom < 0) return;
    let glow: THREE.Sprite | undefined = this.lampGlows.get(id);
    if (glow === undefined) {
      glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: nebulaTexture_get(), color: (base as THREE.Color).clone().lerp(LAMP_WHITE, 0.35),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.lampGlows.set(id, glow);
      this.group.add(glow);
    }
    const radius: number = (sphere.geometry as THREE.BufferGeometry & { parameters?: { radius?: number } }).parameters?.radius ?? NODE_RADIUS;
    // Out fast, then settle: the glow swells to its reach and fades.
    const swell: number = 1 - (1 - bloom) ** 3;
    glow.position.copy(sphere.position);
    glow.scale.setScalar(radius * (2 + LAMP_BLOOM_REACH * swell) * sphere.scale.x);
    glow.material.opacity = 0.9 * (1 - bloom) ** 1.5;
    glow.visible = true;
    shown.add(id);
  }

  /** Re-reads every tube set from the stages' statuses as they are now. */
  private tubes_restatus(): void {
    this.tubesStale = false;
    const palette = palette_read();
    const stale = this.tubeSets;
    this.tubeSets = [];
    for (const entry of stale) {
      this.group.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      if (entry.mesh.material instanceof THREE.ShaderMaterial) {
        const material: THREE.ShaderMaterial = entry.mesh.material;
        this.tubeMaterials = this.tubeMaterials.filter((m: THREE.ShaderMaterial): boolean => m !== material);
        material.dispose();
      }
      entry.group.tubes = null;
      this.tubes_build(entry.group, entry.members, palette);
    }
    this.tubes_follow();
  }

  /**
   * Brings every tube to the spheres it joins, where they stand now: a
   * pulled node drags its tubes with it.
   */
  private tubes_follow(): void {
    const up: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
    const carrier: THREE.Object3D = new THREE.Object3D();
    for (const { mesh, edges } of this.tubeSets) {
      edges.forEach(({ from, to, width }: { from: string; to: string; width: number }, i: number): void => {
        const a: THREE.Mesh | undefined = this.meshes.get(from);
        const b: THREE.Mesh | undefined = this.meshes.get(to);
        if (a === undefined || b === undefined) return;
        const along: THREE.Vector3 = b.position.clone().sub(a.position);
        const length: number = along.length();
        carrier.position.copy(a.position).addScaledVector(along, 0.5);
        carrier.quaternion.setFromUnitVectors(up, length > 0 ? along.clone().divideScalar(length) : up);
        carrier.scale.set(width, length, width);
        carrier.updateMatrix();
        mesh.setMatrixAt(i, carrier.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Lets a feed's spheres go once it is stars again. */
  private handoffSolid_release(group: HandoffGroup): void {
    for (const mesh of group.meshes) {
      this.group.remove(mesh);
      if (mesh.material instanceof THREE.Material) mesh.material.dispose();
      const id: unknown = mesh.userData['nodeId'];
      if (typeof id === 'string' && this.meshes.get(id) === mesh) this.meshes.delete(id);
    }
    for (const line of group.lines) {
      this.group.remove(line);
      line.geometry.dispose();
      if (line.material instanceof THREE.Material) line.material.dispose();
    }
    if (group.tubes !== null) {
      this.group.remove(group.tubes);
      const released: THREE.InstancedMesh = group.tubes;
      this.tubeSets = this.tubeSets.filter((entry): boolean => entry.mesh !== released);
      group.tubes.geometry.dispose();
      if (group.tubes.material instanceof THREE.ShaderMaterial) {
        const material: THREE.ShaderMaterial = group.tubes.material;
        this.tubeMaterials = this.tubeMaterials.filter((m: THREE.ShaderMaterial): boolean => m !== material);
        material.dispose();
      }
      group.tubes = null;
    }
    group.meshes = [];
    group.lines = [];
  }

  /**
   * Draws stars in two layers: the error-free ones glow additively (the
   * galaxy's light), the errored ones — embers — are drawn after them in
   * plain blending, so a red star inside a bright core stays red.
   *
   * @param entries - The stars.
   */
  private stars_draw(entries: StarEntry[]): void {
    for (const entry of entries) {
      if (!this.starIndex.has(entry.id)) this.starIndex.set(entry.id, this.stars.length);
      this.stars.push(entry);
    }
    for (const ember of [false, true]) {
      const layer: StarEntry[] = entries.filter((entry: StarEntry): boolean => entry.ember === ember);
      if (layer.length === 0) continue;
      const positions: Float32Array = new Float32Array(layer.length * 3);
      const tints: Float32Array = new Float32Array(layer.length * 3);
      const radii: Float32Array = new Float32Array(layer.length);
      const alphas: Float32Array = new Float32Array(layer.length);
      layer.forEach((entry: StarEntry, i: number): void => {
        entry.layer = this.starLayers.length;
        entry.slot = i;
        positions.set([entry.position.x, entry.position.y, entry.position.z], i * 3);
        tints.set([entry.color.r, entry.color.g, entry.color.b], i * 3);
        radii[i] = entry.radius;
        alphas[i] = entry.dim ? DIM_OPACITY * 1.5 : 1;
      });
      const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('tint', new THREE.BufferAttribute(tints, 3));
      geometry.setAttribute('radius', new THREE.BufferAttribute(radii, 1));
      const alphaAttribute: THREE.BufferAttribute = new THREE.BufferAttribute(alphas, 1);
      geometry.setAttribute('alpha', alphaAttribute);
      this.starLayers.push({ alpha: alphaAttribute, base: Float32Array.from(alphas) });
      const material: THREE.ShaderMaterial = new THREE.ShaderMaterial({
        uniforms: { scale: { value: 1 }, floorPx: { value: STAR_FLOOR_PX * window.devicePixelRatio }, capPx: { value: STAR_CAP_PX * window.devicePixelRatio } },
        vertexShader: STAR_VERTEX,
        fragmentShader: ember ? STAR_FRAGMENT_EMBER : STAR_FRAGMENT_GLOW,
        transparent: true,
        depthWrite: false,
        blending: ember ? THREE.NormalBlending : THREE.AdditiveBlending,
      });
      const points: THREE.Points = new THREE.Points(geometry, material);
      // Embers over the glow: drawn after it, whatever the sort says.
      points.renderOrder = ember ? 2 : 1;
      points.frustumCulled = false;
      this.group.add(points);
      this.starMaterials.push(material);
    }
    this.starScale_update();
  }

  /** Keeps the stars' pixel scale true to the camera and the canvas. */
  private starScale_update(): void {
    if (this.starMaterials.length === 0) return;
    const height: number = this.renderer.domElement.height;
    const scale: number = height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    for (const material of this.starMaterials) {
      const uniform = material.uniforms['scale'];
      if (uniform !== undefined) uniform.value = scale;
    }
  }

  /**
   * A cluster's handle while the scene draws stars: a soft glow at its
   * anchor, facing the camera, sized as its halo would be.
   */
  private nebula_add(node: SceneNode, position: THREE.Vector3, palette: ReturnType<typeof palette_read>): void {
    const radius: number = haloRadius_of(node.count ?? 1);
    const sprite: THREE.Sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: nebulaTexture_get(),
      color: palette.edge,
      transparent: true,
      opacity: node.dim === true ? NEBULA_OPACITY / 3 : NEBULA_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    sprite.position.copy(position);
    sprite.scale.setScalar(radius * 2);
    sprite.renderOrder = 0;
    this.group.add(sprite);
    this.nebulae.push({ id: node.id, position: position.clone(), radius });
  }

  /**
   * The node whose star — or, over no star, whose nebula — is under the
   * pointer, picked in screen space: a star is hit within its drawn size
   * (never less than a few pixels), the nearest centre wins, a dimmed star
   * is scenery and takes no pointer.
   */
  private starNode_under(event: MouseEvent): string | null {
    if (this.stars.length === 0 && this.nebulae.length === 0) return null;
    const bounds: DOMRect = this.renderer.domElement.getBoundingClientRect();
    const px: number = event.clientX - bounds.left;
    const py: number = event.clientY - bounds.top;
    this.group.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    const perUnit: number = bounds.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    // One matrix from the group's space to the screen's; one scratch
    // vector: a census can hold tens of thousands of stars, and this runs
    // on every pointer move.
    const view: THREE.Matrix4 = new THREE.Matrix4().multiplyMatrices(this.camera.matrixWorldInverse, this.group.matrixWorld);
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
    let best: string | null = null;
    let bestScore: number = Infinity;
    for (const star of this.stars) {
      if (star.dim) continue;
      const hit = screen(star.position);
      if (hit === null) continue;
      const reach: number = Math.max(this.pressKind === 'touch' ? TOUCH_REACH_PX : 4, (STAR_GLOW * star.radius * perUnit) / hit.depth);
      const distance: number = Math.hypot(hit.x - px, hit.y - py);
      if (distance > reach) continue;
      const score: number = distance / reach;
      if (score < bestScore) { bestScore = score; best = star.id; }
    }
    if (best !== null) return best;
    for (const nebula of this.nebulae) {
      const hit = screen(nebula.position);
      if (hit === null) continue;
      if (Math.hypot(hit.x - px, hit.y - py) <= (nebula.radius * perUnit) / hit.depth) return nebula.id;
    }
    return null;
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
    const index: number | undefined = this.starIndex.get(id);
    const star: StarEntry | undefined = index === undefined ? undefined : this.stars[index];
    if (star !== undefined) return { position: this.group.localToWorld(star.position.clone()), radius: star.radius };
    return null;
  }

  /** Every drawn node's id: spheres and stars. */
  private drawnIds(): string[] {
    return [...this.meshes.keys(), ...this.starIndex.keys()];
  }

  /** Adds one edge line; joins are dashed. Endpoint ids allow live re-anchoring. */
  private edge_add(
    fromId: string,
    toId: string,
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: THREE.Color,
    dashed: boolean,
    dim: boolean = false,
  ): void {
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    let line: THREE.Line;
    if (dashed) {
      const material: THREE.LineDashedMaterial = new THREE.LineDashedMaterial({
        color, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: dim ? DIM_OPACITY : 0.9,
      });
      line = new THREE.Line(geometry, material);
      line.computeLineDistances();
    } else {
      const material: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
        color, transparent: true, opacity: dim ? DIM_OPACITY : 0.75,
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
      // Where a pulled node comes to rest is where it stands: a later
      // redraw starts from here instead of snapping it back.
      this.lastPositions.set(simNode.id, new THREE.Vector3(simNode.x, simNode.y, simNode.z));
    }
    if (this.tubeSets.length > 0) this.tubes_follow();
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
    this.spinIdleUntil = Date.now() + SPIN_RESUME_MS;
    if (
      !this.drag.moved &&
      Math.abs(event.clientX - this.drag.startX) + Math.abs(event.clientY - this.drag.startY) >
        DRAG_THRESHOLD_PX
    ) {
      this.drag.moved = true;
      if (!this.drag.solo) this.dragSim_begin(this.drag.nodeId);
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

  /**
   * Moves the camera nearer or farther, as a wheel turn of `deltaY` does:
   * toward the focus, or — in census, which is a place — along the eye ray,
   * untethered, through the core and out the other side.
   *
   * @param deltaY - A wheel's delta: positive draws back, negative closes in.
   */
  private camera_dolly(deltaY: number): void {
    this.spinIdleUntil = Date.now() + SPIN_RESUME_MS;
    this.touched = true;
    // Dolly along the eye ray, not the z axis: census parks the camera
    // off-axis (and far beyond the old 3..40 clamp), where a z-only
    // dolly slid the whole cloud diagonally off screen.
    if (this.census) {
      const heading: THREE.Vector3 = this.camera.getWorldDirection(new THREE.Vector3());
      const speed: number = Math.max(4, this.camera.position.length()) * 0.0012;
      this.camera.position.addScaledVector(heading, -deltaY * speed);
      return;
    }
    // Toward the focus, not the world's origin: after a flight to a feed
    // the camera looks at the feed, and a dolly must close on it.
    const offset: THREE.Vector3 = this.camera.position.clone().sub(this.focus);
    const eye: number = offset.length();
    const next: number = Math.min(Math.max(eye * Math.exp(deltaY * 0.001), 1.5), Math.max(40, this.camera.far * 0.45));
    this.camera.position.copy(this.focus).addScaledVector(offset, next / Math.max(0.0001, eye));
  }

  /**
   * Slides the camera in its own plane by a screen distance; the focus
   * rides along, so the next turn pivots on what is now in the middle.
   *
   * @param dx - Screen pixels across.
   * @param dy - Screen pixels down.
   */
  private camera_pan(dx: number, dy: number): void {
    const factor: number = this.camera.position.distanceTo(this.focus) * 0.0016;
    const shift: THREE.Vector3 = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(-dx * factor)
      .add(new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).multiplyScalar(dy * factor));
    this.camera.position.add(shift);
    this.focus.add(shift);
  }

  /** The two fingers down: their spread and their middle. */
  private fingers_read(): { spread: number; midX: number; midY: number } | null {
    const [a, b] = [...this.touches.values()];
    if (a === undefined || b === undefined) return null;
    return { spread: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
  }

  /**
   * A second finger lands: whatever the first began — a pull, an orbit —
   * lets go, and the two steer the camera together until they lift.
   */
  private gesture_begin(): void {
    this.drag_end();
    this.viewDrag = null;
    this.gestureHeld = true;
    this.pinch = this.fingers_read();
    this.spinIdleUntil = Date.now() + SPIN_RESUME_MS;
    if (this.tip) this.tip.hidden = true;
  }

  /**
   * Two fingers move: spreading closes in and pinching draws back, as the
   * wheel does, and the pair moving together pans.
   */
  private gesture_move(): void {
    const now = this.fingers_read();
    if (now === null || this.pinch === null) return;
    if (now.spread > 0 && this.pinch.spread > 0) {
      // The spread's ratio is the zoom: in the wheel's own units, so a pinch
      // and a wheel travel the same.
      this.camera_dolly(Math.log(this.pinch.spread / now.spread) / 0.001);
    }
    if (this.projection === '2d' || !this.census) this.camera_pan(now.midX - this.pinch.midX, now.midY - this.pinch.midY);
    this.pinch = now;
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
      this.touched = true;
    }
    if (!this.viewDrag.moved) return;
    if (this.viewDrag.pan || this.projection === '2d') {
      // Screen-proportional pan: the graph follows the pointer.
      // Screen-proportional pan in the camera's own plane; the focus rides
      // along, so the next turn pivots on what is now in the middle.
      this.camera_pan(dx, dy);
    } else {
      // Orbit about the focus: across turns about the world's up, along
      // turns about the camera's right — the pivot is what is looked at.
      this.turn_about(WORLD_UP, dx * 0.005);
      this.turn_about(new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize(), dy * 0.005);
    }
  }

  /** Nodes easing home after a ranked peek: mesh, from, to, start time. */
  private dragReturns: Array<{ mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; startedAt: number }> = [];

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
    const hits: THREE.Intersection[] = this.raycaster
      .intersectObjects([...this.meshes.values()])
      .filter((hit: THREE.Intersection): boolean => hit.object.userData['dim'] !== true);
    // A halo wraps its cluster, so its surface is hit before the spheres
    // inside it: a solid hit anywhere along the ray wins, the halo only
    // when the pointer is over nothing solid.
    const solid: THREE.Intersection | undefined = hits.find((hit: THREE.Intersection): boolean => hit.object.userData['halo'] !== true);
    const object: THREE.Object3D | undefined = (solid ?? hits[0])?.object;
    return object instanceof THREE.Mesh ? object : null;
  }

  /**
   * The node under the pointer, however it is drawn: a census member (its
   * group), a solid sphere, or a star (or nebula) when nothing solid is.
   */
  private node_under(event: MouseEvent): string | null {
    // A solid sphere wins: the entered feed stands in the census as spheres.
    const solid: string | null = this.meshNode_under(event);
    if (solid !== null) return solid;
    if (this.census && this.censusMesh !== null) return this.censusNode_under(event);
    return this.starNode_under(event);
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
      const mesh: THREE.Mesh = new THREE.Mesh(this.sphere_of(item.radius), new THREE.MeshStandardMaterial({
        color: nodeColor_pick(item.node, palette, isRoot), roughness: 0.35, metalness: 0.15,
      }));
      mesh.position.copy(item.position);
      mesh.userData['nodeId'] = item.node.id;
      mesh.userData['dim'] = false;
      this.group.add(mesh);
      this.meshes.set(item.node.id, mesh);
    }
    const ids: string[] = solidOnes.map((item: PlacedNode): string => item.node.id);
    const entered: HandoffGroup = {
      entries: ids.map((id: string): StarEntry => ({ id, position: new THREE.Vector3(), radius: 0, color: new THREE.Color(), dim: false, ember: false })),
      center: new THREE.Vector3(), maxRadius: 0, mix: 1, target: 1, meshes: [], lines: [], tubes: null, threadSegments: [],
    };
    this.tubes_build(entered, new Set(ids), palette);
  }

  /** The node id behind a shape-mode mesh under the pointer. */
  private meshNode_under(event: MouseEvent): string | null {
    const nodeId: unknown = this.mesh_under(event)?.userData['nodeId'];
    return typeof nodeId === 'string' ? nodeId : null;
  }

  /**
   * The group node id behind the census member under the pointer. A
   * member is entered through its group's representative — the census is
   * a place, not just a diorama. The touched member lights up.
   */
  private censusNode_under(event: MouseEvent): string | null {
    if (this.censusMesh === null) return null;
    const bounds: DOMRect = this.renderer.domElement.getBoundingClientRect();
    const pointer: THREE.Vector2 = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.group.updateMatrixWorld(true);
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit: THREE.Intersection | undefined = this.raycaster.intersectObject(this.censusMesh)[0];
    if (hit === undefined || hit.instanceId === undefined) return null;
    this.censusMesh.setColorAt(hit.instanceId, new THREE.Color('#ffffff'));
    if (this.censusMesh.instanceColor) this.censusMesh.instanceColor.needsUpdate = true;
    return this.censusIds[hit.instanceId] ?? null;
  }

  /** Names the node under the pointer in the hover tip, or hides it. */
  private hover_handle(event: PointerEvent): void {
    // The space holds still while the pointer is over it: a target that
    // turns under the cursor is a click on a neighbour.
    this.pointerInside = true;
    if (this.tip === null) return;
    // In census the spheres are members of one instanced mesh: the group
    // under the pointer is what the tip names, as a click would pick.
    const nodeId: unknown = this.node_under(event);
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
      : this.node_under(event);
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
