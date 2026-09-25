/**
 * @file The pull: one node grabbed and dragged, its molecule reacting.
 *
 * A pull moves the grabbed node's own molecule — the nodes joined to it by
 * edges, never across a cluster's halo, never through a dimmed node — and
 * leaves the rest of the field where it stands: pulling one feed in a
 * universe of seven hundred re-settled all of them under physics that were
 * not the universe's own.
 *
 * The molecule reacts with the forces the layout settled under — the same
 * link lengths, charge by size within the hug's reach, no overlap — so a tug
 * moves it rather than blowing it apart; generic forces disagreed with the
 * rest the layout had found, and every node fled. Links and charge only, no
 * centring force, or the pull would fight a recentring spring.
 *
 * Pure: positions in, positions out; no renderer.
 *
 * @module
 */
import { forceSimulation, forceLink, forceManyBody, forceCollide, type Simulation } from 'd3-force-3d';
import type { Vec3 } from '../types/space.js';

/** Below this heat a released pull has come to rest. */
const PULL_REST_ALPHA: number = 0.02;

/**
 * A drawn node as the pull needs it.
 *
 * @property id - The node.
 * @property position - Where it stands, in the space the pull runs in.
 * @property radius - Its room: link lengths, charge and overlap follow it.
 * @property dim - Scenery: the molecule does not reach through it.
 * @property halo - A cluster's wrap: no edge to or from it is followed.
 */
export interface PullNode {
  id: string;
  position: Vec3;
  radius: number;
  dim: boolean;
  halo: boolean;
}

/**
 * What a pull begins from.
 *
 * @property grabbed - The node taken hold of.
 * @property nodes - Every drawn node that could move.
 * @property edges - The graph's edges, parent to child; those between nodes
 *   not drawn are passed over.
 * @property dimensions - 2 for a flat view, 3 otherwise.
 * @property baseRadius - The radius at which a node's charge is the base charge.
 */
export interface PullInput {
  grabbed: string;
  nodes: ReadonlyArray<PullNode>;
  edges: ReadonlyArray<{ from: string; to: string }>;
  dimensions: 2 | 3;
  baseRadius: number;
}

/** A simulated node: where it is, and whether it is pinned. */
interface SimNode {
  id: string;
  x: number;
  y: number;
  z: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
}

/**
 * The nodes a pull on one node moves: its molecule, reached along edges
 * between drawn nodes, never through a halo or a dimmed node.
 *
 * @param input - What the pull begins from.
 * @returns The molecule's ids (the grabbed node always among them) and the
 *   edges inside it.
 */
export function pullMolecule_of(input: Pick<PullInput, 'grabbed' | 'nodes' | 'edges'>): { ids: Set<string>; links: Array<{ source: string; target: string }> } {
  const drawn: Map<string, PullNode> = new Map(input.nodes.map((node: PullNode): [string, PullNode] => [node.id, node]));
  const all: Array<{ source: string; target: string }> = [];
  const around: Map<string, string[]> = new Map();
  for (const edge of input.edges) {
    const from: PullNode | undefined = drawn.get(edge.from);
    const to: PullNode | undefined = drawn.get(edge.to);
    if (from === undefined || to === undefined || from.halo || to.halo) continue;
    all.push({ source: edge.from, target: edge.to });
    around.set(edge.from, [...(around.get(edge.from) ?? []), edge.to]);
    around.set(edge.to, [...(around.get(edge.to) ?? []), edge.from]);
  }
  const ids: Set<string> = new Set([input.grabbed]);
  const queue: string[] = [input.grabbed];
  while (queue.length > 0) {
    const at: string = queue.pop() as string;
    for (const next of around.get(at) ?? []) {
      if (ids.has(next) || drawn.get(next)?.dim === true) continue;
      ids.add(next);
      queue.push(next);
    }
  }
  const links = all.filter((link): boolean => ids.has(link.source) && ids.has(link.target));
  return { ids, links };
}

/**
 * A pull under way: begun hot, following a pinned node while held, cooling
 * to rest once released.
 */
export class PullSimulation {
  private readonly nodes: SimNode[];
  private readonly grabbed: SimNode | undefined;
  private readonly sim: Simulation;

  /**
   * Builds the reaction from where the nodes stand, the grabbed one pinned
   * there. Begin it on the first real movement, not on the press: a heated
   * simulation on a mere press shifts nodes out from under a click.
   *
   * @param input - What the pull begins from.
   */
  constructor(input: PullInput) {
    const { ids, links } = pullMolecule_of(input);
    const radius: Map<string, number> = new Map(input.nodes.map((node: PullNode): [string, number] => [node.id, node.radius]));
    const radiusOf = (id: string): number => radius.get(id) ?? input.baseRadius;
    const position: Map<string, Vec3> = new Map(input.nodes.map((node: PullNode): [string, Vec3] => [node.id, node.position]));
    this.nodes = [...ids].filter((id: string): boolean => position.has(id)).map((id: string): SimNode => {
      const [x, y, z] = position.get(id) as Vec3;
      return { id, x, y, z };
    });
    this.sim = forceSimulation(this.nodes, input.dimensions)
      .force('link', forceLink(links).id((d: { id: string }): string => d.id).distance(
        (link: { source: { id: string }; target: { id: string } }): number => radiusOf(link.source.id) + radiusOf(link.target.id) + 1.4,
      ))
      .force('charge', forceManyBody().strength((d: { id: string }): number => -6 * (radiusOf(d.id) / input.baseRadius) ** 2).distanceMax(12))
      .force('collide', forceCollide().radius((d: { id: string }): number => radiusOf(d.id) * 1.2))
      .alpha(0.25)
      .alphaTarget(0.08)
      .stop();
    this.grabbed = this.nodes.find((node: SimNode): boolean => node.id === input.grabbed);
    if (this.grabbed !== undefined) {
      this.grabbed.fx = this.grabbed.x;
      this.grabbed.fy = this.grabbed.y;
      this.grabbed.fz = this.grabbed.z;
    }
  }

  /**
   * Holds the grabbed node at a point: the pointer's, in the pull's space.
   *
   * @param point - Where it is held.
   */
  public pin(point: Vec3): void {
    if (this.grabbed === undefined) return;
    [this.grabbed.fx, this.grabbed.fy, this.grabbed.fz] = point;
  }

  /** Lets go: the grabbed node is free and the molecule cools to rest. */
  public release(): void {
    if (this.grabbed !== undefined) {
      this.grabbed.fx = null;
      this.grabbed.fy = null;
      this.grabbed.fz = null;
    }
    this.sim.alphaTarget(0);
  }

  /**
   * One frame of the reaction: runs while held, or while still warm after
   * the release.
   *
   * @param held - Whether the node is still held.
   * @returns False once the pull has come to rest (and did not move).
   */
  public step(held: boolean): boolean {
    if (!held && this.sim.alpha() <= PULL_REST_ALPHA) return false;
    this.sim.tick();
    return true;
  }

  /**
   * Where the molecule's nodes stand now.
   *
   * @returns Each moving node and its position.
   */
  public positions(): Array<{ id: string; position: Vec3 }> {
    return this.nodes.map((node: SimNode): { id: string; position: Vec3 } => ({ id: node.id, position: [node.x, node.y, node.z] }));
  }
}
