/**
 * @file The galaxy: a space whose shape emerges.
 *
 * Every sphere a charged ball repelling every other, springs along each
 * feed's edges and from each feed's root to its shape's hub, no two balls
 * overlapping, and the whole let go to find its own rest. Nobody places a
 * feed: a lab that runs two pipelines most shows two galaxies because the
 * forces make them, not because a layout drew them.
 *
 * That emergence costs every sphere against every other. It starts here
 * from the spokes arrangement (a fraction of a second) rather than from a
 * heap at the centre, so the forces refine a picture already near its
 * rest instead of unfolding one from nothing — the same forces, fewer
 * ticks. Pure, so it runs in the worker.
 *
 * @module
 */
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY, forceZ } from 'd3-force-3d';
import { hierarchy_layout, type HierarchyNode, type HierarchyPhysics, type HierarchyPositions } from './hierarchy.js';
import { randomFor_key } from './seeded.js';
import { NODE_RADIUS } from './types.js';

/** Ticks of the free settle, from the spokes start. */
const GALAXY_TICKS: number = 80;

type SimNode = { id: string; x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number; r: number };

/**
 * Lays out a space as a galaxy.
 *
 * @param nodes - Every node (group and seed as for the hierarchy).
 * @param physics - The terms: the molecule settle's own.
 * @param onProgress - Told how far it has come, 0..1.
 * @param randomFor - Where a reused molecule's turn comes from, by its key;
 *   seeded by the key unless a caller asks otherwise.
 * @returns Every node's position.
 */
export function galaxy_layout(
  nodes: ReadonlyArray<HierarchyNode>,
  physics: HierarchyPhysics,
  onProgress: (fraction: number) => void = (): void => {},
  randomFor: (key: string) => () => number = randomFor_key,
): HierarchyPositions {
  // Where to start: where each sphere stood, or — for a space not seen
  // before — the spokes arrangement.
  const unseeded: boolean = nodes.some((node: HierarchyNode): boolean => node.seed === undefined);
  const start: HierarchyPositions = unseeded
    ? hierarchy_layout(nodes, physics, (fraction: number): void => onProgress(0.05 * fraction), 'spokes', randomFor)
    : {};
  onProgress(0.05);
  const sim: SimNode[] = nodes.map((node: HierarchyNode): SimNode => {
    const at: [number, number, number] | undefined = node.seed ?? start[node.id];
    const body: SimNode = { id: node.id, r: node.radius };
    if (at !== undefined) {
      body.x = at[0]; body.y = at[1]; body.z = at[2];
      if (node.frozen === true && node.seed !== undefined) { body.fx = at[0]; body.fy = at[1]; body.fz = at[2]; }
    }
    return body;
  });
  const present: Set<string> = new Set(nodes.map((node: HierarchyNode): string => node.id));
  const links: Array<{ source: string; target: string }> = [];
  for (const node of nodes) for (const parent of node.parents) if (present.has(parent)) links.push({ source: parent, target: node.id });
  const radiusOf: Map<string, number> = new Map(nodes.map((node: HierarchyNode): [string, number] => [node.id, node.radius]));
  const anyFrozen: boolean = sim.some((body: SimNode): boolean => body.fx !== undefined);
  if (!sim.every((body: SimNode): boolean => body.fx !== undefined)) {
    const simulation = forceSimulation(sim, 3)
      .force('link', forceLink(links).id((d: { id: string }) => d.id).distance(
        physics.link
          ? (link: { source: { id: string }; target: { id: string } }): number => (radiusOf.get(link.source.id) ?? NODE_RADIUS) + (radiusOf.get(link.target.id) ?? NODE_RADIUS) + 1.4
          : 2.2,
      ))
      .stop();
    const charge = forceManyBody().strength((d: { id: string }): number => (physics.charge ? -6 * (((d as SimNode).r / NODE_RADIUS) ** 2) : -6));
    if (physics.reach !== undefined) charge.distanceMax(physics.reach);
    simulation.force('charge', charge);
    if (!anyFrozen) simulation.force('center', forceCenter(0, 0, 0));
    if (physics.collide) simulation.force('collide', forceCollide().radius((d: { id: string }): number => (d as SimNode).r * 1.2));
    if (physics.gravity) {
      const pull = (d: { id: string }): number => (((d as SimNode).r / NODE_RADIUS) ** 2) * 0.08;
      simulation.force('gx', forceX(0).strength(pull)).force('gy', forceY(0).strength(pull)).force('gz', forceZ(0).strength(pull));
    }
    // From a start near rest the settle needs less heat: it refines, it
    // does not unfold.
    if (unseeded) simulation.alpha(0.6);
    for (let tick: number = 0; tick < GALAXY_TICKS; tick++) {
      simulation.tick();
      if (tick % 2 === 0) onProgress(0.05 + 0.95 * (tick / GALAXY_TICKS));
    }
  }
  const positions: HierarchyPositions = {};
  for (const body of sim) positions[body.id] = [body.x ?? 0, body.y ?? 0, body.z ?? 0];
  onProgress(1);
  return positions;
}
