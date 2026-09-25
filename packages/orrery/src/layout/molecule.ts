/**
 * @file The molecule: a graph that finds its own shape.
 *
 * A d3-force-3d settle with each node's room scaled by its metric (its
 * degree when no metric arrived): edges hold their ends surface to surface,
 * heavier nodes repel harder, nothing overlaps. The settle can run in
 * slices, so a caller with a frame budget steps it as it has time, and it
 * can hold nodes still at a seed while the rest settles around them — a
 * descent settles one feed while three thousand spheres stand.
 *
 * @module
 */
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY, forceZ } from 'd3-force-3d';
import { NODE_RADIUS, PHYSICS_DEFAULT, type PhysicsTerms, type Vec3 } from './types.js';

/**
 * One node of a molecule.
 *
 * @property id - Its id.
 * @property parents - Its parents' ids, joins included.
 * @property metric - What sizes it; its degree when absent.
 */
export interface MoleculeNode {
  id: string;
  parents: ReadonlyArray<string>;
  metric?: number;
}

/** A node where the settle left it, with the room it took. */
export interface MoleculePlace {
  id: string;
  position: Vec3;
  radius: number;
}

/**
 * A molecule settle that can be run in slices.
 *
 * @property total - The ticks this settle runs; zero when nothing moves.
 * @property moving - How many nodes the simulation moves: pinned ones cost nothing.
 * @property step - Runs up to `ticks` more ticks.
 * @property place - Where every node stands now, in the input's order.
 */
export interface MoleculeSettle {
  total: number;
  moving: number;
  step: (ticks: number) => void;
  place: () => MoleculePlace[];
}

/**
 * Each node's metric: its own, or its degree when none arrived.
 *
 * @param nodes - The molecule's nodes.
 * @returns The metrics, in the nodes' order.
 */
function metrics_of(nodes: ReadonlyArray<MoleculeNode>): number[] {
  const degree: Map<string, number> = new Map();
  for (const node of nodes) {
    for (const parentId of node.parents) {
      degree.set(parentId, (degree.get(parentId) ?? 0) + 1);
      degree.set(node.id, (degree.get(node.id) ?? 0) + 1);
    }
  }
  return nodes.map((n: MoleculeNode): number => n.metric ?? degree.get(n.id) ?? 1);
}

/**
 * Each node's radius, as the settle sizes it: its metric against the
 * molecule's peak.
 *
 * @param nodes - The molecule's nodes.
 * @returns Radius by id.
 */
export function moleculeRadii_of(nodes: ReadonlyArray<MoleculeNode>): Map<string, number> {
  const metrics: number[] = metrics_of(nodes);
  const peak: number = Math.max(...metrics, 1);
  return new Map(nodes.map((n: MoleculeNode, i: number): [string, number] => [n.id, NODE_RADIUS * (0.5 + ((metrics[i] ?? 1) / peak) * 1.2)]));
}

/**
 * Builds a molecule settle without running it.
 *
 * @param nodes - The molecule's nodes.
 * @param dimensions - 2 or 3; in 2D the simulation itself is flat, since a
 *   3D settle flattened afterwards piles nodes that resolved in depth.
 * @param seed - Where nodes stood last; a seeded node starts there.
 * @param physics - The terms of this settle.
 * @param frozen - Nodes that stand where their seed put them.
 * @returns The settle, ready to step.
 */
export function molecule_prepare(
  nodes: ReadonlyArray<MoleculeNode>,
  dimensions: 2 | 3 = 3,
  seed: ReadonlyMap<string, Vec3> = new Map(),
  physics: PhysicsTerms = PHYSICS_DEFAULT,
  frozen: ReadonlySet<string> = new Set(),
): MoleculeSettle {
  const links: Array<{ source: string; target: string }> = [];
  for (const node of nodes) {
    for (const parentId of node.parents) links.push({ source: parentId, target: node.id });
  }
  const metrics: number[] = metrics_of(nodes);
  const metricPeak: number = Math.max(...metrics, 1);
  // Radius is physics, not paint: the metric sets each node's room in the
  // settle, so what is measured reshapes the molecule, not just its size.
  const radii: number[] = metrics.map((metric: number): number => NODE_RADIUS * (0.5 + (metric / metricPeak) * 1.2));
  const radiusOf: Map<string, number> = new Map(nodes.map((n: MoleculeNode, i: number): [string, number] => [n.id, radii[i] ?? NODE_RADIUS]));

  // Warm start: a re-projection morphs from where the graph stands instead
  // of re-rolling a new equilibrium. A frozen node stands where its seed
  // put it and pushes on nothing.
  const simNodes: Array<{ id: string; x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number }> = nodes.map(
    (n: MoleculeNode) => {
      const from: Vec3 | undefined = seed.get(n.id);
      if (from === undefined) return { id: n.id };
      if (frozen.has(n.id)) return { id: n.id, x: from[0], y: from[1], z: from[2], fx: from[0], fy: from[1], fz: from[2] };
      return { id: n.id, x: from[0], y: from[1], z: from[2] };
    },
  );
  // Only what moves is simulated: the free nodes and whatever they link to.
  // A whole-field settle with most of it frozen held the page for seconds.
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
  // Centering moves every free node by the mean of ALL nodes each tick; with
  // most of the field frozen that mean never settles and the free few
  // stream away. A settle with frozen nodes keeps its centre where it is.
  if (frozen.size === 0) {
    simulation.force('center', dimensions === 2 ? forceCenter(0, 0) : forceCenter(0, 0, 0));
  }
  if (physics.collide) {
    simulation.force('collide', forceCollide().radius((d: { id: string }): number => (radiusOf.get(d.id) ?? NODE_RADIUS) * 1.2));
  }
  if (physics.gravity) {
    // Mass-weighted centering: the heaviest node settles at the heart.
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
    place: (): MoleculePlace[] => nodes.map((node: MoleculeNode, index: number): MoleculePlace => {
      const sim = simNodes[index];
      return { id: node.id, position: [sim?.x ?? 0, sim?.y ?? 0, sim?.z ?? 0], radius: radii[index] ?? NODE_RADIUS };
    }),
  };
}

/**
 * Lays out a molecule in one go — {@link molecule_prepare} run to its end.
 *
 * @param nodes - The molecule's nodes.
 * @param dimensions - 2 or 3.
 * @param seed - Where nodes stood last.
 * @param physics - The terms of this settle.
 * @param frozen - Nodes that stand where their seed put them.
 * @returns Every node placed, in the input's order.
 */
export function molecule_layout(
  nodes: ReadonlyArray<MoleculeNode>,
  dimensions: 2 | 3 = 3,
  seed: ReadonlyMap<string, Vec3> = new Map(),
  physics: PhysicsTerms = PHYSICS_DEFAULT,
  frozen: ReadonlySet<string> = new Set(),
): MoleculePlace[] {
  const settle: MoleculeSettle = molecule_prepare(nodes, dimensions, seed, physics, frozen);
  settle.step(settle.total);
  return settle.place();
}
