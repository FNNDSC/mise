/**
 * @file Constellations: a space arranged by what it ran.
 *
 * Every plugin is a star, placed first and alone: two plugins that many
 * feeds ran together draw close, so the sky itself is a map of which tools
 * go with which. Then the stars hold still and every feed settles against
 * them, each stage pulled to its own plugin's star — a feed stretches
 * between the stars it used, and feeds alike lie alike.
 *
 * A pull is weighted by how much a plugin SAYS about a feed: a plugin in
 * every feed says nothing (IDF, log of feeds over feeds using it), so its
 * pull is small, and a plugin in nearly all of them (a landmark, over nine
 * in ten) pulls not at all; a feed's pull is shared across its distinct
 * plugins, so a long pipeline is not dragged harder than a short one.
 * Stars stand where their co-occurrence puts them, run to run — the start
 * is seeded from the space itself.
 *
 * Pure: nodes in, positions out, run in the worker.
 *
 * @module
 */
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceCenter } from 'd3-force-3d';
import { randomFor_key } from './seeded.js';
import { NODE_RADIUS, type LayoutNode, type PhysicsTerms, type Positions, type Vec3 } from './types.js';

/** Ticks of the stars' own settle. */
const STAR_TICKS: number = 160;
/** Ticks of the feeds' settle against the held stars. */
const FEED_TICKS: number = 120;
/** A plugin in more than this share of feeds is a landmark: no pull. */
export const LANDMARK_SHARE: number = 0.9;

/** A settling body. */
type Body = { id: string; x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number; r: number };

/**
 * How much each plugin says about a feed: the log of feeds over feeds that
 * ran it, zero for a landmark.
 *
 * @param feedsUsing - How many feeds ran each plugin.
 * @param feeds - How many feeds there are.
 * @returns Each plugin's weight.
 */
export function pluginWeights_of(feedsUsing: ReadonlyMap<string, number>, feeds: number): Map<string, number> {
  const out: Map<string, number> = new Map();
  for (const [plugin, count] of feedsUsing) {
    out.set(plugin, feeds === 0 || count / feeds > LANDMARK_SHARE ? 0 : Math.log(feeds / Math.max(1, count)));
  }
  return out;
}

/**
 * Lays out a space as constellations.
 *
 * Nodes with `attrs.kind === 'star'` and `attrs.plugin` are the plugin
 * stars; every other node with `attrs.plugin` is a stage of its `group`
 * (the feed); anything else settles by its edges alone.
 *
 * @param nodes - Every node.
 * @param physics - The terms of the settle.
 * @param onProgress - Told how far it has come, 0..1.
 * @returns Every node's position.
 */
export function constellations_layout(
  nodes: ReadonlyArray<LayoutNode>,
  physics: PhysicsTerms,
  onProgress: (fraction: number) => void = (): void => {},
): Positions {
  const pluginOf = (node: LayoutNode): string | null => (typeof node.attrs?.['plugin'] === 'string' ? node.attrs['plugin'] : null);
  const isStar = (node: LayoutNode): boolean => node.attrs?.['kind'] === 'star' && pluginOf(node) !== null;
  const stars: LayoutNode[] = nodes.filter(isStar);
  const starOf: Map<string, LayoutNode> = new Map(stars.map((star: LayoutNode): [string, LayoutNode] => [pluginOf(star) as string, star]));
  const stages: LayoutNode[] = nodes.filter((node: LayoutNode): boolean => !isStar(node));

  // Which plugins each feed ran, and how many feeds ran each plugin.
  const feedPlugins: Map<string, Set<string>> = new Map();
  for (const node of stages) {
    const plugin: string | null = pluginOf(node);
    if (node.group === null || plugin === null || !starOf.has(plugin)) continue;
    feedPlugins.set(node.group, (feedPlugins.get(node.group) ?? new Set()).add(plugin));
  }
  const feedsUsing: Map<string, number> = new Map();
  for (const plugins of feedPlugins.values()) for (const plugin of plugins) feedsUsing.set(plugin, (feedsUsing.get(plugin) ?? 0) + 1);
  const weights: Map<string, number> = pluginWeights_of(feedsUsing, feedPlugins.size);

  // Phase 1: the stars alone, drawn together by how often they ran together.
  const together: Map<string, number> = new Map();
  for (const plugins of feedPlugins.values()) {
    const list: string[] = [...plugins].sort();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const key: string = `${list[i]}\u0000${list[j]}`;
      together.set(key, (together.get(key) ?? 0) + 1);
    }
  }
  const skyRadius: number = Math.max(6, Math.sqrt(stars.length) * 4);
  const starBodies: Body[] = stars.map((star: LayoutNode): Body => body_of(star, skyRadius, randomFor_key(`star:${star.id}`)));
  const starLinks: Array<{ source: string; target: string; share: number }> = [];
  for (const [key, count] of together) {
    const [a, b] = key.split('\u0000') as [string, string];
    const smaller: number = Math.min(feedsUsing.get(a) ?? 1, feedsUsing.get(b) ?? 1);
    starLinks.push({ source: (starOf.get(a) as LayoutNode).id, target: (starOf.get(b) as LayoutNode).id, share: count / Math.max(1, smaller) });
  }
  if (starBodies.length > 0 && starBodies.some((body: Body): boolean => body.fx === undefined)) {
    const sky = forceSimulation(starBodies, 3)
      .force('link', forceLink(starLinks).id((d: { id: string }): string => d.id)
        .distance((link): number => skyRadius * (1.1 - Number(link['share'])))
        .strength((link): number => 0.05 + 0.6 * Number(link['share'])))
      .force('charge', forceManyBody().strength(-30).distanceMax(skyRadius * 3))
      .force('collide', forceCollide().radius((d: { id: string }): number => (d as Body).r * 3))
      .force('center', forceCenter(0, 0, 0))
      .stop();
    for (let tick = 0; tick < STAR_TICKS; tick++) {
      sky.tick();
      if (tick % 4 === 0) onProgress(0.4 * (tick / STAR_TICKS));
    }
  }
  const starAt: Map<string, Vec3> = new Map(starBodies.map((body: Body): [string, Vec3] => [body.id, [body.x ?? 0, body.y ?? 0, body.z ?? 0]]));
  onProgress(0.4);

  // Phase 2: the stars held; every stage pulled to its plugin's star.
  const all: Body[] = [
    ...starBodies.map((body: Body): Body => ({ ...body, fx: body.x ?? 0, fy: body.y ?? 0, fz: body.z ?? 0 })),
    ...stages.map((node: LayoutNode): Body => {
      const plugin: string | null = pluginOf(node);
      const star: LayoutNode | undefined = plugin === null ? undefined : starOf.get(plugin);
      const near: Vec3 | undefined = star === undefined ? undefined : starAt.get(star.id);
      return body_of(node, 2, randomFor_key(`stage:${node.id}`), near);
    }),
  ];
  const present: Set<string> = new Set(nodes.map((node: LayoutNode): string => node.id));
  const radiusOf: Map<string, number> = new Map(nodes.map((node: LayoutNode): [string, number] => [node.id, node.radius]));
  const links: Array<{ source: string; target: string; strength: number; length: number }> = [];
  for (const node of stages) {
    for (const parent of node.parents) {
      if (!present.has(parent)) continue;
      links.push({ source: parent, target: node.id, strength: 1, length: (radiusOf.get(parent) ?? NODE_RADIUS) + node.radius + 1.4 });
    }
    const plugin: string | null = pluginOf(node);
    const star: LayoutNode | undefined = plugin === null ? undefined : starOf.get(plugin);
    const weight: number = plugin === null ? 0 : weights.get(plugin) ?? 0;
    const shared: number = node.group === null ? 1 : Math.max(1, feedPlugins.get(node.group)?.size ?? 1);
    if (star !== undefined && weight > 0) {
      links.push({ source: star.id, target: node.id, strength: Math.min(1, 0.25 * weight / shared), length: star.radius + node.radius + 2 });
    }
  }
  const sim = forceSimulation(all, 3)
    .force('link', forceLink(links).id((d: { id: string }): string => d.id)
      .distance((link): number => Number(link['length']))
      .strength((link): number => Number(link['strength'])))
    .stop();
  if (physics.charge) {
    const charge = forceManyBody().strength((d: { id: string }): number => -6 * (((d as Body).r / NODE_RADIUS) ** 2));
    if (physics.reach !== undefined) charge.distanceMax(physics.reach);
    sim.force('charge', charge);
  }
  if (physics.collide) sim.force('collide', forceCollide().radius((d: { id: string }): number => (d as Body).r * 1.2));
  for (let tick = 0; tick < FEED_TICKS; tick++) {
    sim.tick();
    if (tick % 4 === 0) onProgress(0.4 + 0.6 * (tick / FEED_TICKS));
  }
  const positions: Positions = {};
  for (const body of all) positions[body.id] = [body.x ?? 0, body.y ?? 0, body.z ?? 0];
  onProgress(1);
  return positions;
}

/**
 * A node's body at its start: where it stood, or a seeded place near a
 * centre (the origin, or the star it belongs to). A frozen node holds its seed.
 */
function body_of(node: LayoutNode, spread: number, random: () => number, near: Vec3 = [0, 0, 0]): Body {
  const body: Body = { id: node.id, r: node.radius };
  const at: Vec3 = node.seed ?? [
    near[0] + (random() - 0.5) * 2 * spread,
    near[1] + (random() - 0.5) * 2 * spread,
    near[2] + (random() - 0.5) * 2 * spread,
  ];
  body.x = at[0]; body.y = at[1]; body.z = at[2];
  if (node.frozen === true && node.seed !== undefined) { body.fx = at[0]; body.fy = at[1]; body.fz = at[2]; }
  return body;
}
