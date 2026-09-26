/**
 * @file Accretion: a space grown in the order it was made.
 *
 * Feeds arrive one at a time, oldest first. The first stands at the centre;
 * each after it is launched from a sphere round what has grown so far and
 * wanders — a random walk with a gentle drift toward the feed most like it
 * — until it touches a feed already placed. It sticks there with a chance
 * equal to how alike the two are, else it steps away and wanders on; a
 * feed that runs out of steps sticks to its closest kin, starting a branch.
 * So the space grows as a coral: like feeds on like, a stranger on a limb
 * of its own, the oldest work at the heart.
 *
 * Likeness is what the feeds ran, weighted as constellations weigh it: a
 * plugin in every feed says nothing, a rare one says much. The walk is
 * seeded from each feed's own key, so the same lab grows the same coral.
 * A feed is one particle — a ball the size of its molecule — and its
 * molecule unfolds in place once it has stuck; nothing already placed
 * moves.
 *
 * Pure: nodes in, positions and arrival order out, run in the worker.
 *
 * @module
 */
import { pluginWeights_of } from './constellations.js';
import { randomFor_key } from './seeded.js';
import { NODE_RADIUS, type LayoutNode, type PhysicsTerms, type Positions, type Vec3 } from './types.js';

/** The gap left between two stuck balls. */
const STICK_GAP: number = 0.4;
/** Steps a walker takes before it sticks to its closest kin regardless. */
export const STEP_BUDGET: number = 400;
/**
 * How hard a walker drifts toward its most similar placed feed, against its
 * random step. Tuned on synthetic labs of three pipeline families (eight
 * labs of sixty feeds): 0.2-0.35 grew a feed next to its own family about
 * three times in four, stronger drift less often — a walker pulled straight
 * at its kin meets the strangers in the way.
 */
const DRIFT: number = 0.35;
/**
 * The least chance a touch sticks, so strangers do meet. Kept small: at 0.01
 * a feed grew next to its own family four times in five, at 0.1 two in three.
 * A walker out of steps sticks to its kin anyway.
 */
const STICK_FLOOR: number = 0.01;
/** How far past the grown space a walker is launched, in its own radii. */
const LAUNCH_MARGIN: number = 3;

/** One feed as a particle. */
interface Particle {
  key: string;
  nodes: LayoutNode[];
  plugins: Set<string>;
  created: number;
  /** Each node's place within its molecule, centred on the molecule. */
  local: Map<string, Vec3>;
  radius: number;
  /** Held where it stands: every node frozen at its seed (a feed already grown). */
  held: boolean;
  /** Where a held feed stands. */
  centre?: Vec3;
}

/** A particle that has stuck. */
interface Placed {
  particle: Particle;
  centre: Vec3;
}

/**
 * How alike two feeds are by what they ran: the weight of the plugins both
 * ran over the weight of the plugins either ran.
 *
 * @param a - One feed's plugins.
 * @param b - The other's.
 * @param weights - How much each plugin says.
 * @returns 0..1.
 */
export function feedLikeness_of(a: ReadonlySet<string>, b: ReadonlySet<string>, weights: ReadonlyMap<string, number>): number {
  let both: number = 0;
  let either: number = 0;
  for (const plugin of new Set([...a, ...b])) {
    const weight: number = weights.get(plugin) ?? 0;
    either += weight;
    if (a.has(plugin) && b.has(plugin)) both += weight;
  }
  return either === 0 ? 0 : both / either;
}

/** How far a child stands past its parent's and its own radii: the universe's own edge length. */
const EDGE_GAP: number = 1.4;
/** How widely a node's children fan round its own heading, in radians. */
const FAN: number = Math.PI / 3;

/**
 * A feed's molecule unfolded alone, centred, with the ball that holds it: a
 * root at the heart, each child one edge past its parent, fanned round its
 * parent's heading so a chain reaches out and a fan opens. Compact at the
 * universe's own edge lengths — a force settle sized for the DAG pane unfolded
 * a feed of four stages fourteen units wide and the space into spokes.
 */
function molecule_of(nodes: ReadonlyArray<LayoutNode>, random: () => number): { local: Map<string, Vec3>; radius: number } {
  const local: Map<string, Vec3> = new Map();
  const byId: Map<string, LayoutNode> = new Map(nodes.map((node: LayoutNode): [string, LayoutNode] => [node.id, node]));
  const children: Map<string, LayoutNode[]> = new Map();
  const roots: LayoutNode[] = [];
  for (const node of nodes) {
    const parent: string | undefined = node.parents.find((id: string): boolean => byId.has(id));
    if (parent === undefined) roots.push(node);
    else children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const heading: Map<string, Vec3> = new Map();
  const queue: LayoutNode[] = [];
  roots.forEach((root: LayoutNode, index: number): void => {
    const d: Vec3 = direction_of(random);
    const reach: number = index === 0 ? 0 : root.radius * 2 + EDGE_GAP;
    local.set(root.id, [d[0] * reach, d[1] * reach, d[2] * reach]);
    heading.set(root.id, d);
    queue.push(root);
  });
  for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
    const at: Vec3 = local.get(node.id) as Vec3;
    const ahead: Vec3 = heading.get(node.id) as Vec3;
    for (const child of children.get(node.id) ?? []) {
      if (local.has(child.id)) continue;
      // A heading within the fan round the parent's: tilted off it, turned about it.
      const tilt: number = random() * FAN;
      const side: Vec3 = perpendicular_of(ahead, random);
      const d: Vec3 = normalised([
        ahead[0] * Math.cos(tilt) + side[0] * Math.sin(tilt),
        ahead[1] * Math.cos(tilt) + side[1] * Math.sin(tilt),
        ahead[2] * Math.cos(tilt) + side[2] * Math.sin(tilt),
      ]);
      const length: number = node.radius + child.radius + EDGE_GAP;
      local.set(child.id, [at[0] + d[0] * length, at[1] + d[1] * length, at[2] + d[2] * length]);
      heading.set(child.id, d);
      queue.push(child);
    }
  }
  // A node the walk never reached (a cycle) stands at the heart.
  for (const node of nodes) if (!local.has(node.id)) local.set(node.id, [0, 0, 0]);
  const centre: Vec3 = [0, 0, 0];
  for (const at of local.values()) { centre[0] += at[0] / local.size; centre[1] += at[1] / local.size; centre[2] += at[2] / local.size; }
  let radius: number = NODE_RADIUS;
  for (const node of nodes) {
    const at: Vec3 = local.get(node.id) as Vec3;
    const moved: Vec3 = [at[0] - centre[0], at[1] - centre[1], at[2] - centre[2]];
    local.set(node.id, moved);
    radius = Math.max(radius, Math.hypot(moved[0], moved[1], moved[2]) + node.radius);
  }
  return { local, radius };
}

/** A unit vector along `v`. */
function normalised(v: Vec3): Vec3 {
  const length: number = Math.max(1e-9, Math.hypot(v[0], v[1], v[2]));
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** A unit vector at right angles to `v`, turned at random about it. */
function perpendicular_of(v: Vec3, random: () => number): Vec3 {
  const other: Vec3 = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const a: Vec3 = normalised([v[1] * other[2] - v[2] * other[1], v[2] * other[0] - v[0] * other[2], v[0] * other[1] - v[1] * other[0]]);
  const b: Vec3 = [v[1] * a[2] - v[2] * a[1], v[2] * a[0] - v[0] * a[2], v[0] * a[1] - v[1] * a[0]];
  const turn: number = random() * Math.PI * 2;
  return [a[0] * Math.cos(turn) + b[0] * Math.sin(turn), a[1] * Math.cos(turn) + b[1] * Math.sin(turn), a[2] * Math.cos(turn) + b[2] * Math.sin(turn)];
}

/** A point on the unit sphere, from the walker's own chance. */
function direction_of(random: () => number): Vec3 {
  const z: number = random() * 2 - 1;
  const angle: number = random() * Math.PI * 2;
  const ring: number = Math.sqrt(1 - z * z);
  return [ring * Math.cos(angle), ring * Math.sin(angle), z];
}

/** The placed balls, bucketed by place so a walker asks only its neighbours whether it touches. */
class Grid {
  private cells: Map<string, Placed[]> = new Map();

  constructor(private readonly size: number) {}

  private key(at: Vec3): string {
    return `${Math.floor(at[0] / this.size)},${Math.floor(at[1] / this.size)},${Math.floor(at[2] / this.size)}`;
  }

  add(placed: Placed): void {
    const key: string = this.key(placed.centre);
    this.cells.set(key, [...(this.cells.get(key) ?? []), placed]);
  }

  /** Every placed ball a ball of `radius` at `at` touches. */
  touching(at: Vec3, radius: number): Placed[] {
    const out: Placed[] = [];
    const [cx, cy, cz] = [Math.floor(at[0] / this.size), Math.floor(at[1] / this.size), Math.floor(at[2] / this.size)];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const placed of this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        const reach: number = radius + placed.particle.radius + STICK_GAP;
        const d: number = Math.hypot(at[0] - placed.centre[0], at[1] - placed.centre[1], at[2] - placed.centre[2]);
        if (d < reach) out.push(placed);
      }
    }
    return out;
  }
}

/** Where a ball of `radius` rests touching `other`, on the side `from` lies. */
function restingAgainst(other: Placed, from: Vec3, radius: number, random: () => number): Vec3 {
  let away: Vec3 = [from[0] - other.centre[0], from[1] - other.centre[1], from[2] - other.centre[2]];
  const length: number = Math.hypot(away[0], away[1], away[2]);
  away = length < 1e-9 ? direction_of(random) : [away[0] / length, away[1] / length, away[2] / length];
  const reach: number = radius + other.particle.radius + STICK_GAP;
  return [other.centre[0] + away[0] * reach, other.centre[1] + away[1] * reach, other.centre[2] + away[2] * reach];
}

/**
 * Grows a space by accretion.
 *
 * Nodes of one `group` are one feed; a feed's time is the least
 * `attrs.createdAt` among its nodes (feeds without one come after, by key),
 * and its plugins are its nodes' `attrs.plugin`. A node with no group (an
 * anchor) stands at the centre. When every node is held at its seed, the
 * seeds are the answer.
 *
 * @param nodes - Every node.
 * @param _physics - The terms of the settle; a coral has none (nothing settles once stuck).
 * @param onProgress - Told how far it has come, 0..1.
 * @returns Every node's position, and each node's arrival (its feed's place in the order).
 */
export function accretion_layout(
  nodes: ReadonlyArray<LayoutNode>,
  _physics: PhysicsTerms,
  onProgress: (fraction: number) => void = (): void => {},
): { positions: Positions; arrival: Record<string, number> } {
  const positions: Positions = {};
  const arrival: Record<string, number> = {};
  if (nodes.length > 0 && nodes.every((node: LayoutNode): boolean => node.frozen === true && node.seed !== undefined)) {
    for (const node of nodes) positions[node.id] = node.seed as Vec3;
    onProgress(1);
    return { positions, arrival };
  }

  const byGroup: Map<string, LayoutNode[]> = new Map();
  for (const node of nodes) {
    if (node.group === null) { positions[node.id] = [0, 0, 0]; continue; }
    byGroup.set(node.group, [...(byGroup.get(node.group) ?? []), node]);
  }
  const particles: Particle[] = [...byGroup].map(([key, members]): Particle => {
    const plugins: Set<string> = new Set();
    let created: number = Number.POSITIVE_INFINITY;
    for (const node of members) {
      const plugin: unknown = node.attrs?.['plugin'];
      if (typeof plugin === 'string') plugins.add(plugin);
      const at: unknown = node.attrs?.['createdAt'];
      if (typeof at === 'number' && at < created) created = at;
    }
    if (members.every((node: LayoutNode): boolean => node.frozen === true && node.seed !== undefined)) {
      // Already grown: it stays exactly where it stands, a ball round its own centre.
      const seeds: Vec3[] = members.map((node: LayoutNode): Vec3 => node.seed as Vec3);
      const centre: Vec3 = [0, 1, 2].map((axis: number): number => seeds.reduce((sum: number, at: Vec3): number => sum + (at[axis] as number), 0) / seeds.length) as Vec3;
      const local: Map<string, Vec3> = new Map();
      let radius: number = NODE_RADIUS;
      for (const node of members) {
        const at: Vec3 = node.seed as Vec3;
        const moved: Vec3 = [at[0] - centre[0], at[1] - centre[1], at[2] - centre[2]];
        local.set(node.id, moved);
        radius = Math.max(radius, Math.hypot(moved[0], moved[1], moved[2]) + node.radius);
      }
      return { key, nodes: members, plugins, created, local, radius, held: true, centre };
    }
    // Unfolded by its own key, so feeds alike do not stand as clones.
    const { local, radius } = molecule_of(members, randomFor_key(`turn:${key}`));
    return { key, nodes: members, plugins, created, local, radius, held: false };
  });
  // Oldest first; a feed with no time after every timed one, by key.
  particles.sort((a: Particle, b: Particle): number => a.created - b.created || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const feedsUsing: Map<string, number> = new Map();
  for (const particle of particles) for (const plugin of particle.plugins) feedsUsing.set(plugin, (feedsUsing.get(plugin) ?? 0) + 1);
  const weights: Map<string, number> = pluginWeights_of(feedsUsing, particles.length);

  const biggest: number = Math.max(NODE_RADIUS, ...particles.map((particle: Particle): number => particle.radius));
  const grid: Grid = new Grid(2 * biggest + STICK_GAP);
  const placed: Placed[] = [];
  let extent: number = 0;

  const settle = (particle: Particle, index: number, centre: Vec3): void => {
    const holder: Placed = { particle, centre };
    placed.push(holder);
    grid.add(holder);
    extent = Math.max(extent, Math.hypot(centre[0], centre[1], centre[2]) + particle.radius);
    for (const node of particle.nodes) {
      const local: Vec3 = particle.local.get(node.id) ?? [0, 0, 0];
      // A held node stands exactly at its seed, to the last bit.
      positions[node.id] = particle.held && node.seed !== undefined ? node.seed : [centre[0] + local[0], centre[1] + local[1], centre[2] + local[2]];
      arrival[node.id] = index;
    }
  };
  // What has grown stays: held feeds stand first, and only newcomers walk.
  particles.forEach((particle: Particle, index: number): void => {
    if (particle.held && particle.centre !== undefined) settle(particle, index, particle.centre);
  });
  particles.forEach((particle: Particle, index: number): void => {
    if (particle.held) return;
    const random: () => number = randomFor_key(`accrete:${particle.key}`);
    let centre: Vec3;
    if (placed.length === 0) {
      centre = [0, 0, 0];
    } else {
      // Its closest kin: the most alike, the newest among equals.
      let kin: Placed = placed[placed.length - 1] as Placed;
      let kinLikeness: number = -1;
      for (const other of placed) {
        const likeness: number = feedLikeness_of(particle.plugins, other.particle.plugins, weights);
        if (likeness >= kinLikeness) { kin = other; kinLikeness = likeness; }
      }
      const launch: number = extent + LAUNCH_MARGIN * particle.radius + biggest;
      const step: number = Math.max(0.5, particle.radius * 0.5);
      const start: Vec3 = direction_of(random);
      let at: Vec3 = [start[0] * launch, start[1] * launch, start[2] * launch];
      let stuck: Vec3 | null = null;
      for (let taken = 0; taken < STEP_BUDGET && stuck === null; taken++) {
        const wander: Vec3 = direction_of(random);
        const toward: Vec3 = [kin.centre[0] - at[0], kin.centre[1] - at[1], kin.centre[2] - at[2]];
        const distance: number = Math.max(1e-9, Math.hypot(toward[0], toward[1], toward[2]));
        const heading: Vec3 = [
          wander[0] * (1 - DRIFT) + (toward[0] / distance) * DRIFT,
          wander[1] * (1 - DRIFT) + (toward[1] / distance) * DRIFT,
          wander[2] * (1 - DRIFT) + (toward[2] / distance) * DRIFT,
        ];
        const next: Vec3 = [at[0] + heading[0] * step, at[1] + heading[1] * step, at[2] + heading[2] * step];
        const touched: Placed[] = grid.touching(next, particle.radius);
        if (touched.length === 0) {
          // Strayed too far: launched again from the sphere.
          if (Math.hypot(next[0], next[1], next[2]) > launch * 2) {
            const again: Vec3 = direction_of(random);
            at = [again[0] * launch, again[1] * launch, again[2] * launch];
          } else {
            at = next;
          }
          continue;
        }
        // A touch: it sticks as the likeness says, to the most alike it touched.
        let best: Placed = touched[0] as Placed;
        let bestLikeness: number = -1;
        for (const other of touched) {
          const likeness: number = feedLikeness_of(particle.plugins, other.particle.plugins, weights);
          if (likeness > bestLikeness) { best = other; bestLikeness = likeness; }
        }
        if (random() < Math.max(STICK_FLOOR, bestLikeness)) {
          stuck = restingAgainst(best, at, particle.radius, random);
          if (grid.touching(stuck, particle.radius - 1e-6).some((other: Placed): boolean => other !== best && overlaps(stuck as Vec3, particle.radius, other))) stuck = null;
        }
        // Not this time: it is pushed off what it touched and wanders on,
        // round the stranger toward its kin.
        if (stuck === null) {
          const off: Vec3 = restingAgainst(best, at, particle.radius, random);
          const push: Vec3 = [off[0] - best.centre[0], off[1] - best.centre[1], off[2] - best.centre[2]];
          const length: number = Math.max(1e-9, Math.hypot(push[0], push[1], push[2]));
          at = [off[0] + (push[0] / length) * step, off[1] + (push[1] / length) * step, off[2] + (push[2] / length) * step];
        }
      }
      // Out of steps: it sticks to its kin, a branch of its own.
      centre = stuck ?? freeSpot_near(kin, particle.radius, grid, random);
    }
    settle(particle, index, centre);
    if (index % 8 === 0) onProgress(index / Math.max(1, particles.length));
  });
  onProgress(1);
  return { positions, arrival };
}

/** Whether a ball at `at` overlaps a placed one (touching is not overlapping). */
function overlaps(at: Vec3, radius: number, other: Placed): boolean {
  return Math.hypot(at[0] - other.centre[0], at[1] - other.centre[1], at[2] - other.centre[2]) < radius + other.particle.radius + STICK_GAP * 0.5;
}

/** A place touching `kin` where nothing else stands: tried round it, then further out. */
function freeSpot_near(kin: Placed, radius: number, grid: Grid, random: () => number): Vec3 {
  for (let ring = 0; ring < 8; ring++) {
    for (let tries = 0; tries < 24; tries++) {
      const d: Vec3 = direction_of(random);
      const reach: number = radius + kin.particle.radius + STICK_GAP + ring * radius;
      const at: Vec3 = [kin.centre[0] + d[0] * reach, kin.centre[1] + d[1] * reach, kin.centre[2] + d[2] * reach];
      if (!grid.touching(at, radius).some((other: Placed): boolean => overlaps(at, radius, other))) return at;
    }
  }
  const d: Vec3 = direction_of(random);
  const reach: number = radius + kin.particle.radius + STICK_GAP + 8 * radius;
  return [kin.centre[0] + d[0] * reach, kin.centre[1] + d[1] * reach, kin.centre[2] + d[2] * reach];
}
