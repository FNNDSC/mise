/**
 * @file The layout engines a surface can offer, by name.
 *
 * Every engine keeps the same contract (`LayoutEngine`): a pure function of
 * nodes and physics, answering positions. A LAYOUT block lists what is
 * registered; an engine whose `needs` the surface cannot meet is offered
 * greyed with the reason, never run on missing data.
 *
 * @module
 */
import { constellations_layout } from './constellations.js';
import { galaxy_layout } from './galaxy.js';
import { hierarchy_layout, type HierarchyNode } from './hierarchy.js';
import { molecule_layout, type MoleculeNode } from './molecule.js';
import { ranked_layout, type RankedSceneNode } from './ranked.js';
import type { LayoutEngine, LayoutInput, LayoutNode, LayoutResult, Positions, Vec3 } from './types.js';

/** A layout node as the hierarchy engines read it. */
function hierarchyNode_of(node: LayoutNode): HierarchyNode {
  const out: HierarchyNode = { id: node.id, parents: node.parents, radius: node.radius, group: node.group };
  if (node.seed !== undefined) out.seed = node.seed;
  if (node.frozen !== undefined) out.frozen = node.frozen;
  return out;
}

/** A node's metric, when the surface supplied one. */
function metric_of(node: LayoutNode): number | undefined {
  const metric: unknown = node.attrs?.['metric'];
  return typeof metric === 'number' ? metric : undefined;
}

/** Positions from a list of places. */
function positions_of(places: ReadonlyArray<{ id: string; position: Vec3 }>): Positions {
  const out: Positions = {};
  for (const place of places) out[place.id] = place.position;
  return out;
}

/** The galaxy: the whole space finds its own rest, from the spokes arrangement. */
const galaxyEngine: LayoutEngine = {
  id: 'galaxy',
  label: 'GALAXY',
  needs: [],
  run: (input: LayoutInput, progress: (fraction: number) => void): LayoutResult =>
    ({ positions: galaxy_layout(input.nodes.map(hierarchyNode_of), input.physics, progress) }),
};

/** Spokes: every molecule a spoke from its anchor, its chain pointing out. */
const spokesEngine: LayoutEngine = {
  id: 'spokes',
  label: 'SPOKES',
  needs: [],
  run: (input: LayoutInput, progress: (fraction: number) => void): LayoutResult =>
    ({ positions: hierarchy_layout(input.nodes.map(hierarchyNode_of), input.physics, progress, 'spokes') }),
};

/** Clumps: the molecules packed round their anchor. */
const clumpsEngine: LayoutEngine = {
  id: 'clumps',
  label: 'CLUMPS',
  needs: [],
  run: (input: LayoutInput, progress: (fraction: number) => void): LayoutResult =>
    ({ positions: hierarchy_layout(input.nodes.map(hierarchyNode_of), input.physics, progress, 'clumps') }),
};

/** Ranked: tiers down the screen, the tree as a schematic. */
const rankedEngine: LayoutEngine = {
  id: 'ranked',
  label: 'RANKED',
  needs: [],
  run: (input: LayoutInput, progress: (fraction: number) => void): LayoutResult => {
    const nodes: RankedSceneNode[] = input.nodes.map((node: LayoutNode): RankedSceneNode => {
      const out: RankedSceneNode = { id: node.id, parentIds: node.parents };
      const metric: number | undefined = metric_of(node);
      if (metric !== undefined) out.metric = metric;
      return out;
    });
    const positions: Positions = positions_of(ranked_layout(nodes));
    progress(1);
    return { positions };
  },
};

/** Molecule: one graph finding its own shape, sized by its metric. */
const moleculeEngine: LayoutEngine = {
  id: 'molecule',
  label: 'MOLECULE',
  needs: [],
  run: (input: LayoutInput, progress: (fraction: number) => void): LayoutResult => {
    const nodes: MoleculeNode[] = input.nodes.map((node: LayoutNode): MoleculeNode => {
      const out: MoleculeNode = { id: node.id, parents: node.parents };
      const metric: number | undefined = metric_of(node);
      if (metric !== undefined) out.metric = metric;
      return out;
    });
    const seed: Map<string, Vec3> = new Map();
    const frozen: Set<string> = new Set();
    for (const node of input.nodes) {
      if (node.seed !== undefined) seed.set(node.id, node.seed);
      if (node.frozen === true) frozen.add(node.id);
    }
    const positions: Positions = positions_of(molecule_layout(nodes, 3, seed, input.physics, frozen));
    progress(1);
    return { positions };
  },
};

/**
 * Constellations: every plugin a star placed by what runs with what, every
 * feed's stages pulled to their plugins' stars. Needs each stage's plugin.
 */
const constellationsEngine: LayoutEngine = {
  id: 'constellations',
  label: 'CONSTELLATIONS',
  needs: ['plugin'],
  run: (input: LayoutInput, progress: (fraction: number) => void): LayoutResult =>
    ({ positions: constellations_layout(input.nodes, input.physics, progress) }),
};

/**
 * Hubs: the galaxy's forces on a space hung from a tree of hubs the surface
 * names (a hub under a hub, feeds under the deepest). The same settle as
 * the galaxy, kept under its own name so a surface remembers each apart.
 */
const hubsEngine: LayoutEngine = {
  id: 'hubs',
  label: 'HUBS',
  needs: [],
  run: (input: LayoutInput, progress: (fraction: number) => void): LayoutResult =>
    ({ positions: galaxy_layout(input.nodes.map(hierarchyNode_of), input.physics, progress) }),
};

/** Every engine, in the order a LAYOUT block offers them. */
const ENGINES: ReadonlyArray<LayoutEngine> = [galaxyEngine, spokesEngine, clumpsEngine, constellationsEngine, hubsEngine, rankedEngine, moleculeEngine];

/**
 * Every registered engine.
 *
 * @returns The engines, in offering order.
 */
export function layoutEngines_list(): ReadonlyArray<LayoutEngine> {
  return ENGINES;
}

/**
 * One engine by name.
 *
 * @param id - The engine's id.
 * @returns The engine, or undefined when none is registered by that name.
 */
export function layoutEngine_get(id: string): LayoutEngine | undefined {
  return ENGINES.find((engine: LayoutEngine): boolean => engine.id === id);
}

/**
 * What an engine needs that the nodes do not carry: an attribute is missing
 * when no node supplies it.
 *
 * @param engine - The engine.
 * @param nodes - The nodes it would run on.
 * @returns The missing attribute names; empty when the engine can run.
 */
export function layoutNeeds_missing(engine: LayoutEngine, nodes: ReadonlyArray<LayoutNode>): string[] {
  return engine.needs.filter((need: string): boolean => !nodes.some((node: LayoutNode): boolean => node.attrs?.[need] !== undefined));
}
