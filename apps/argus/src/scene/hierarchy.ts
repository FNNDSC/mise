/**
 * @file A space of many molecules laid out as a hierarchy.
 *
 * The universe is thousands of feeds, and no feed links to another: each
 * molecule hangs from its shape's anchor. Settling every sphere against
 * every other (26,402 of them for one identity, 150 ticks) took two and a
 * half minutes. It does not have to: a molecule's shape is its own
 * business, and the space only needs to place molecules.
 *
 *   1. Each group (a feed) is laid out alone, around its own centre: a few
 *      to a few dozen spheres, nearly free.
 *   2. Each group becomes one body, as wide as its molecule, and the bodies
 *      and the ungrouped nodes (the anchors) are laid out together: a
 *      tenth of the nodes and none of the inner pushing.
 *   3. Every sphere stands at its body's place plus its offset in the group.
 *
 * Pure: no DOM, no three.js, so it runs in a worker and under jest alike.
 *
 * @module
 */
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY, forceZ } from 'd3-force-3d';

/**
 * How molecules sit around their anchor: packed as bodies (CLUMPS), or
 * each turned so its root faces the anchor and its chain points outward —
 * the hub and its spokes, the starburst a flat settle used to make.
 */
export type HierarchyArrangement = 'clumps' | 'spokes' | 'galaxy';

/** The physics a hierarchy honours; the scene's own terms. */
export interface HierarchyPhysics {
  charge: boolean;
  link: boolean;
  collide: boolean;
  gravity: boolean;
  reach?: number;
}

/**
 * One node to place.
 *
 * @property id - Its id.
 * @property parents - Its parents' ids (joins included).
 * @property radius - Its sphere's radius.
 * @property group - The molecule it belongs to, or null for a node that
 *   stands alone at the top (an anchor).
 * @property seed - Where it stood last, if anywhere.
 * @property frozen - Holds still at its seed.
 */
export interface HierarchyNode {
  id: string;
  parents: string[];
  radius: number;
  group: string | null;
  seed?: [number, number, number];
  frozen?: boolean;
}

/** Where every node stands. */
export type HierarchyPositions = Record<string, [number, number, number]>;

/** The smallest room a body takes, so a lone sphere is not a point. */
const BODY_MIN_RADIUS: number = 0.55;
/** A molecule hugs itself: its charge reaches no further than this. */
const GROUP_REACH: number = 12;
/** Ticks for one molecule on its own. */
const GROUP_TICKS: number = 60;
/** Ticks for the bodies when they start near their anchors (unseeded), or where they stood. */
const TOP_TICKS: number = 60;

/**
 * A molecule's shape as a key: each member's parent position within the
 * group and its radius. Feeds of one pipeline share it, and a shape laid
 * out once serves them all.
 */
function moleculeSignature_of(members: ReadonlyArray<HierarchyNode>): string {
  const index: Map<string, number> = new Map(members.map((member: HierarchyNode, i: number): [string, number] => [member.id, i]));
  return members.map((member: HierarchyNode): string => {
    const parents: string = member.parents.map((parent: string): number => index.get(parent) ?? -1).join('.');
    return `${parents}:${member.radius.toFixed(2)}`;
  }).join('|');
}

/** Turns an offset by a rotation (yaw, then pitch). */
function offset_turn(offset: [number, number, number], yaw: number, pitch: number): [number, number, number] {
  const [x, y, z] = offset;
  const x1: number = x * Math.cos(yaw) + z * Math.sin(yaw);
  const z1: number = -x * Math.sin(yaw) + z * Math.cos(yaw);
  const y2: number = y * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2: number = y * Math.sin(pitch) + z1 * Math.cos(pitch);
  return [x1, y2, z2];
}

/**
 * Turns a vector by the rotation that carries one direction onto another
 * (Rodrigues' formula); a degenerate direction leaves it as it was.
 */
function vector_turnOnto(v: [number, number, number], from: [number, number, number], to: [number, number, number]): [number, number, number] {
  const norm = (a: [number, number, number]): number => Math.hypot(a[0], a[1], a[2]);
  const fn: number = norm(from);
  const tn: number = norm(to);
  if (fn < 1e-9 || tn < 1e-9) return v;
  const a: [number, number, number] = [from[0] / fn, from[1] / fn, from[2] / fn];
  const b: [number, number, number] = [to[0] / tn, to[1] / tn, to[2] / tn];
  const k: [number, number, number] = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sin: number = norm(k);
  const cos: number = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (sin < 1e-9) return cos > 0 ? v : [-v[0], -v[1], -v[2]];
  const u: [number, number, number] = [k[0] / sin, k[1] / sin, k[2] / sin];
  const dot: number = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cross: [number, number, number] = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return [
    v[0] * cos + cross[0] * sin + u[0] * dot * (1 - cos),
    v[1] * cos + cross[1] * sin + u[1] * dot * (1 - cos),
    v[2] * cos + cross[2] * sin + u[2] * dot * (1 - cos),
  ];
}

/**
 * How far a hub's spokes reach: enough shell for every feed hanging from
 * it, so the spokes grow with the crowd as they did when feeds pushed each
 * other outward.
 */
function spokeShell_of(hubRadius: number, spokes: ReadonlyArray<{ id: string }>, bodyRadius: ReadonlyMap<string, number>): number {
  if (spokes.length === 0) return hubRadius;
  let mean: number = 0;
  for (const spoke of spokes) mean += bodyRadius.get(spoke.id.slice('group:'.length)) ?? BODY_MIN_RADIUS;
  mean /= spokes.length;
  return Math.max(hubRadius + 2, Math.sqrt(spokes.length) * mean * 1.6);
}

/** The k-th of n points spread evenly on a sphere of a radius. */
function shell_point(k: number, n: number, radius: number): [number, number, number] {
  const y: number = n <= 1 ? 0 : 1 - (2 * (k + 0.5)) / n;
  const ring: number = Math.sqrt(Math.max(0, 1 - y * y));
  const theta: number = k * Math.PI * (3 - Math.sqrt(5));
  return [Math.cos(theta) * ring * radius, y * radius, Math.sin(theta) * ring * radius];
}

type SimNode = { id: string; x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number; r: number };

/**
 * Lays out a space as a hierarchy.
 *
 * @param nodes - Every node.
 * @param physics - The terms.
 * @param onProgress - Told how far it has come, 0..1.
 * @returns Every node's position.
 */
export function hierarchy_layout(
  nodes: ReadonlyArray<HierarchyNode>,
  physics: HierarchyPhysics,
  onProgress: (fraction: number) => void = (): void => {},
  arrangement: HierarchyArrangement = 'clumps',
): HierarchyPositions {
  const byId: Map<string, HierarchyNode> = new Map(nodes.map((node: HierarchyNode): [string, HierarchyNode] => [node.id, node]));
  const groups: Map<string, HierarchyNode[]> = new Map();
  const top: HierarchyNode[] = [];
  for (const node of nodes) {
    if (node.group === null) top.push(node);
    else groups.set(node.group, [...(groups.get(node.group) ?? []), node]);
  }

  // 1. Each molecule on its own.
  const offsets: Map<string, [number, number, number]> = new Map();
  const bodyRadius: Map<string, number> = new Map();
  const bodySeed: Map<string, [number, number, number]> = new Map();
  const bodyFrozen: Set<string> = new Set();
  let done: number = 0;
  const groupCount: number = Math.max(1, groups.size);
  // Molecules of one shape are laid out once; each copy is turned at
  // random so a galaxy of one pipeline does not show a thousand identical
  // orientations.
  const shapes: Map<string, Array<[number, number, number]>> = new Map();
  for (const [key, members] of groups) {
    const seeded: HierarchyNode[] = members.filter((member: HierarchyNode): boolean => member.seed !== undefined);
    const mean: [number, number, number] = [0, 0, 0];
    for (const member of seeded) {
      mean[0] += member.seed![0]; mean[1] += member.seed![1]; mean[2] += member.seed![2];
    }
    if (seeded.length > 0) {
      mean[0] /= seeded.length; mean[1] /= seeded.length; mean[2] /= seeded.length;
      bodySeed.set(key, mean);
    }
    if (members.every((member: HierarchyNode): boolean => member.frozen === true && member.seed !== undefined)) bodyFrozen.add(key);
    const local: Map<string, [number, number, number]> = new Map();
    const signature: string | null = seeded.length === 0 ? moleculeSignature_of(members) : null;
    const known: Array<[number, number, number]> | undefined = signature === null ? undefined : shapes.get(signature);
    if (seeded.length === members.length) {
      // Every sphere stood somewhere: the molecule keeps its shape.
      for (const member of members) local.set(member.id, [member.seed![0] - mean[0], member.seed![1] - mean[1], member.seed![2] - mean[2]]);
    } else if (known !== undefined) {
      const yaw: number = Math.random() * Math.PI * 2;
      const pitch: number = (Math.random() - 0.5) * Math.PI;
      members.forEach((member: HierarchyNode, i: number): void => { local.set(member.id, offset_turn(known[i] ?? [0, 0, 0], yaw, pitch)); });
    } else {
      const sim: SimNode[] = members.map((member: HierarchyNode): SimNode => {
        const at: SimNode = { id: member.id, r: member.radius };
        if (member.seed !== undefined) {
          at.x = member.seed[0] - mean[0]; at.y = member.seed[1] - mean[1]; at.z = member.seed[2] - mean[2];
          if (member.frozen === true) { at.fx = at.x; at.fy = at.y; at.fz = at.z; }
        }
        return at;
      });
      const inGroup: Set<string> = new Set(members.map((member: HierarchyNode): string => member.id));
      const links: Array<{ source: string; target: string }> = [];
      for (const member of members) {
        for (const parent of member.parents) if (inGroup.has(parent)) links.push({ source: parent, target: member.id });
      }
      const radiusOf: Map<string, number> = new Map(members.map((member: HierarchyNode): [string, number] => [member.id, member.radius]));
      const simulation = forceSimulation(sim, 3)
        .force('link', forceLink(links).id((d: { id: string }) => d.id).distance(
          physics.link
            ? (link: { source: { id: string }; target: { id: string } }): number => (radiusOf.get(link.source.id) ?? BODY_MIN_RADIUS) + (radiusOf.get(link.target.id) ?? BODY_MIN_RADIUS) + 1.4
            : 2.2,
        ))
        .force('charge', forceManyBody().strength((d: { id: string }): number => (physics.charge ? -6 * ((d as SimNode).r / BODY_MIN_RADIUS) ** 2 : -6)).distanceMax(GROUP_REACH))
        .force('center', forceCenter(0, 0, 0))
        .stop();
      if (physics.collide) simulation.force('collide', forceCollide().radius((d: { id: string }): number => (d as SimNode).r * 1.2));
      for (let tick: number = 0; tick < GROUP_TICKS; tick++) simulation.tick();
      const centre: [number, number, number] = [0, 0, 0];
      for (const at of sim) { centre[0] += at.x ?? 0; centre[1] += at.y ?? 0; centre[2] += at.z ?? 0; }
      centre[0] /= sim.length; centre[1] /= sim.length; centre[2] /= sim.length;
      for (const at of sim) local.set(at.id, [(at.x ?? 0) - centre[0], (at.y ?? 0) - centre[1], (at.z ?? 0) - centre[2]]);
      if (signature !== null) shapes.set(signature, members.map((member: HierarchyNode): [number, number, number] => local.get(member.id) ?? [0, 0, 0]));
    }
    let radius: number = BODY_MIN_RADIUS;
    for (const member of members) {
      const offset: [number, number, number] = local.get(member.id) ?? [0, 0, 0];
      offsets.set(member.id, offset);
      radius = Math.max(radius, Math.hypot(offset[0], offset[1], offset[2]) + member.radius);
    }
    bodyRadius.set(key, radius);
    done += 1;
    if (done % 50 === 0) onProgress(0.3 * (done / groupCount));
  }
  onProgress(0.3);

  // 2. The molecules as bodies, with the anchors.
  const bodyOf = (id: string): string => {
    const node: HierarchyNode | undefined = byId.get(id);
    return node !== undefined && node.group !== null ? `group:${node.group}` : id;
  };
  const bodies: SimNode[] = [];
  const radii: Map<string, number> = new Map();
  let anyFrozen: boolean = false;
  let anySeed: boolean = false;
  for (const [key] of groups) {
    const id: string = `group:${key}`;
    const radius: number = bodyRadius.get(key) ?? BODY_MIN_RADIUS;
    const body: SimNode = { id, r: radius };
    const seed: [number, number, number] | undefined = bodySeed.get(key);
    if (seed !== undefined) {
      anySeed = true;
      body.x = seed[0]; body.y = seed[1]; body.z = seed[2];
      if (bodyFrozen.has(key)) { body.fx = seed[0]; body.fy = seed[1]; body.fz = seed[2]; anyFrozen = true; }
    }
    radii.set(id, radius);
    bodies.push(body);
  }
  for (const node of top) {
    const body: SimNode = { id: node.id, r: node.radius };
    if (node.seed !== undefined) {
      anySeed = true;
      body.x = node.seed[0]; body.y = node.seed[1]; body.z = node.seed[2];
      if (node.frozen === true) { body.fx = node.seed[0]; body.fy = node.seed[1]; body.fz = node.seed[2]; anyFrozen = true; }
    }
    radii.set(node.id, node.radius);
    bodies.push(body);
  }
  const linkSeen: Set<string> = new Set();
  const links: Array<{ source: string; target: string }> = [];
  for (const node of nodes) {
    for (const parent of node.parents) {
      if (!byId.has(parent)) continue;
      const a: string = bodyOf(parent);
      const b: string = bodyOf(node.id);
      if (a === b) continue;
      const key: string = `${a}\u0000${b}`;
      if (linkSeen.has(key)) continue;
      linkSeen.add(key);
      links.push({ source: a, target: b });
    }
  }
  // Start near the answer: the anchors spread on a wide shell, each
  // unplaced body on a shell around the anchor it hangs from. A settle
  // that starts there needs a fraction of the ticks one from a heap does.
  const anchorOf: Map<string, string> = new Map();
  for (const link of links) {
    if (link.source.startsWith('group:') !== link.target.startsWith('group:')) {
      const group: string = link.source.startsWith('group:') ? link.source : link.target;
      const anchor: string = link.source.startsWith('group:') ? link.target : link.source;
      if (!anchorOf.has(group)) anchorOf.set(group, anchor);
    }
  }
  const children: Map<string, SimNode[]> = new Map();
  for (const body of bodies) {
    const anchor: string | undefined = anchorOf.get(body.id);
    if (anchor !== undefined) children.set(anchor, [...(children.get(anchor) ?? []), body]);
  }
  const area: number = bodies.reduce((sum: number, body: SimNode): number => sum + body.r * body.r, 0);
  const anchors: SimNode[] = bodies.filter((body: SimNode): boolean => !body.id.startsWith('group:'));
  anchors.forEach((anchor: SimNode, k: number): void => {
    if (anchor.x !== undefined) return;
    const [x, y, z] = shell_point(k, anchors.length, Math.sqrt(area) * 1.2 + 10);
    anchor.x = x; anchor.y = y; anchor.z = z;
  });
  for (const [anchorId, around] of children) {
    const anchor: SimNode | undefined = bodies.find((body: SimNode): boolean => body.id === anchorId);
    const room: number = Math.sqrt(around.reduce((sum: number, body: SimNode): number => sum + body.r * body.r, 0)) * 1.4 + 2;
    around.forEach((body: SimNode, k: number): void => {
      if (body.x !== undefined) return;
      const [x, y, z] = shell_point(k, around.length, room);
      body.x = (anchor?.x ?? 0) + x; body.y = (anchor?.y ?? 0) + y; body.z = (anchor?.z ?? 0) + z;
    });
  }
  // Spokes: only the hubs are settled — each as wide as its longest spoke
  // — and every feed hanging from a hub is placed round it, its root just
  // outside the hub and its chain pointing out, the directions spread over
  // a sphere. The feeds may cross near the hub, as spokes do.
  const anchored: Set<string> = new Set();
  if (arrangement === 'spokes') {
    const rootOf = (key: string): [number, number, number] => {
      const members: HierarchyNode[] = groups.get(key) ?? [];
      const inGroup: Set<string> = new Set(members.map((member: HierarchyNode): string => member.id));
      const root: HierarchyNode | undefined = members.find((member: HierarchyNode): boolean => member.parents.some((parent: string): boolean => !inGroup.has(parent))) ?? members[0];
      return root === undefined ? [0, 0, 0] : (offsets.get(root.id) ?? [0, 0, 0]);
    };
    const hubs: SimNode[] = [];
    for (const body of bodies) {
      if (body.id.startsWith('group:') && anchorOf.has(body.id)) { anchored.add(body.id); continue; }
      if (!body.id.startsWith('group:')) {
        const spokes: SimNode[] = children.get(body.id) ?? [];
        let reach: number = body.r;
        const shell: number = spokeShell_of(body.r, spokes, bodyRadius);
        for (const spoke of spokes) {
          const key: string = spoke.id.slice('group:'.length);
          const root: [number, number, number] = rootOf(key);
          reach = Math.max(reach, shell + Math.hypot(root[0], root[1], root[2]) + 2 * (bodyRadius.get(key) ?? BODY_MIN_RADIUS));
        }
        hubs.push({ id: body.id, r: reach, x: body.x, y: body.y, z: body.z, ...(body.fx !== undefined ? { fx: body.fx, fy: body.fy, fz: body.fz } : {}) });
      } else {
        hubs.push(body);
      }
    }
    if (!hubs.every((hub: SimNode): boolean => hub.fx !== undefined)) {
      const simulation = forceSimulation(hubs, 3)
        .force('charge', forceManyBody().strength((d: { id: string }): number => -1.5 * (d as SimNode).r))
        .force('collide', forceCollide().radius((d: { id: string }): number => (d as SimNode).r * 0.9))
        .stop();
      if (!anyFrozen) simulation.force('center', forceCenter(0, 0, 0));
      for (let tick: number = 0; tick < TOP_TICKS; tick++) {
        simulation.tick();
        if (tick % 5 === 0) onProgress(0.3 + 0.7 * (tick / TOP_TICKS));
      }
    }
    for (const hub of hubs) {
      const body: SimNode | undefined = bodies.find((b: SimNode): boolean => b.id === hub.id);
      if (body !== undefined && body !== hub) { body.x = hub.x; body.y = hub.y; body.z = hub.z; }
    }
    for (const body of bodies) {
      if (body.id.startsWith('group:') || !children.has(body.id)) continue;
      const spokes: SimNode[] = children.get(body.id) ?? [];
      const shell: number = spokeShell_of(body.r, spokes, bodyRadius);
      spokes.forEach((spoke: SimNode, k: number): void => {
        if (spoke.fx !== undefined || bodySeed.has(spoke.id.slice('group:'.length))) return;
        const root: [number, number, number] = rootOf(spoke.id.slice('group:'.length));
        const out: [number, number, number] = shell_point(k, spokes.length, 1);
        // Staggered along the spoke by the golden ratio, so a crowded hub
        // fans out in depth instead of forming one hollow shell.
        const stagger: number = 0.35 + 0.65 * ((k * 0.6180339887) % 1);
        const distance: number = body.r + 1.4 + shell * stagger + Math.hypot(root[0], root[1], root[2]);
        spoke.x = (body.x ?? 0) + out[0] * distance;
        spoke.y = (body.y ?? 0) + out[1] * distance;
        spoke.z = (body.z ?? 0) + out[2] * distance;
      });
    }
  }
  const allFrozen: boolean = bodies.every((body: SimNode): boolean => body.fx !== undefined);
  if (!allFrozen && arrangement !== 'spokes') {
    const simulation = forceSimulation(bodies, 3)
      .force('link', forceLink(links).id((d: { id: string }) => d.id).distance(
        physics.link
          ? (link: { source: { id: string }; target: { id: string } }): number => (radii.get(link.source.id) ?? BODY_MIN_RADIUS) + (radii.get(link.target.id) ?? BODY_MIN_RADIUS) + 1.4
          : 2.2,
      ))
      .stop();
    const charge = forceManyBody().strength((d: { id: string }): number => (physics.charge ? -6 * ((d as SimNode).r / BODY_MIN_RADIUS) ** 2 : -6));
    if (physics.reach !== undefined) charge.distanceMax(physics.reach);
    simulation.force('charge', charge);
    if (!anyFrozen) simulation.force('center', forceCenter(0, 0, 0));
    if (physics.collide) simulation.force('collide', forceCollide().radius((d: { id: string }): number => (d as SimNode).r * 1.05));
    if (physics.gravity) {
      const pull = (d: { id: string }): number => Math.min(1, (((d as SimNode).r / BODY_MIN_RADIUS) ** 2) * 0.08);
      simulation.force('gx', forceX(0).strength(pull)).force('gy', forceY(0).strength(pull)).force('gz', forceZ(0).strength(pull));
    }
    const ticks: number = TOP_TICKS;
    void anySeed;
    for (let tick: number = 0; tick < ticks; tick++) {
      simulation.tick();
      if (tick % 5 === 0) onProgress(0.3 + 0.7 * (tick / ticks));
    }
  }
  const at: Map<string, SimNode> = new Map(bodies.map((body: SimNode): [string, SimNode] => [body.id, body]));

  // Spokes: each molecule turned so its root faces the anchor it hangs
  // from and the rest of it points away — radial, as a hub's spokes.
  if (arrangement === 'spokes') {
    for (const [key, members] of groups) {
      if (members.some((member: HierarchyNode): boolean => member.seed !== undefined)) continue;
      const bodyId: string = `group:${key}`;
      const body: SimNode | undefined = at.get(bodyId);
      const anchorId: string | undefined = anchorOf.get(bodyId);
      const anchor: SimNode | undefined = anchorId === undefined ? undefined : at.get(anchorId);
      if (body === undefined || anchor === undefined) continue;
      const out: [number, number, number] = [(body.x ?? 0) - (anchor.x ?? 0), (body.y ?? 0) - (anchor.y ?? 0), (body.z ?? 0) - (anchor.z ?? 0)];
      const inGroup: Set<string> = new Set(members.map((member: HierarchyNode): string => member.id));
      const root: HierarchyNode = members.find((member: HierarchyNode): boolean => member.parents.some((parent: string): boolean => !inGroup.has(parent))) ?? members[0]!;
      const rootAt: [number, number, number] = offsets.get(root.id) ?? [0, 0, 0];
      // The molecule's axis: from its root to its centre.
      const axis: [number, number, number] = [-rootAt[0], -rootAt[1], -rootAt[2]];
      for (const member of members) {
        const offset: [number, number, number] = offsets.get(member.id) ?? [0, 0, 0];
        offsets.set(member.id, vector_turnOnto(offset, axis, out));
      }
    }
  }

  // 3. Every sphere at its body plus its offset.
  const positions: HierarchyPositions = {};
  for (const node of nodes) {
    const body: SimNode | undefined = at.get(bodyOf(node.id));
    const base: [number, number, number] = [body?.x ?? 0, body?.y ?? 0, body?.z ?? 0];
    const offset: [number, number, number] = node.group === null ? [0, 0, 0] : (offsets.get(node.id) ?? [0, 0, 0]);
    positions[node.id] = [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]];
  }
  onProgress(1);
  return positions;
}
