/**
 * @file One draw's bodies and edges: captions, nebulae, stars gathered for
 * a batch, halos and spheres; then the lines between solid nodes and the
 * threads touching a star.
 *
 * Pure over the placed nodes and the fields they are drawn into; the scene
 * (`Orrery.draw`) calls the two passes in order and batches what they
 * return.
 */
import * as THREE from 'three';
import {
  PULSE_TRIP_MS,
  REPLAY_REST_MS,
  WAVE_STEP_MS,
  haloRadius_of,
  paint_resolve,
  tubeMode_of,
  type HandoffField,
  type LabelField,
  type Palette,
  type SphereField,
  type StarEntry,
  type StarField,
} from '../draw/index.js';
import type { SpaceNode } from './node.js';
import type { PlacedNode } from './settle.js';

/** The fields a draw paints into, and what it reads of the scene. */
export interface DrawPorts {
  spheres: SphereField;
  labels: LabelField;
  stars: StarField;
  handoff: HandoffField;
  /** The selected node, lit as drawn. */
  selected: string | null;
  /** 2D is drawn flat: discs, not lit spheres. */
  flat: boolean;
  /** Stars: every node but a solid one is a point of light, a halo a nebula. */
  starring: boolean;
  /** The feed a node belongs to, when the hand-off is on; undefined when off. */
  handoffKey: ((node: SpaceNode) => string | null) | undefined;
}

/** The bodies one draw placed: its stars, and its nodes by id. */
export interface DrawnBodies {
  starred: StarEntry[];
  byId: Map<string, PlacedNode>;
}

/**
 * Draws the bodies: captions, nebulae, stars (gathered for one batch),
 * halos and spheres.
 *
 * @returns The stars to batch, and the placed nodes by id.
 */
export function bodies_draw(placed: ReadonlyArray<PlacedNode>, palette: Palette, ports: DrawPorts): DrawnBodies {
  const byId: Map<string, PlacedNode> = new Map(placed.map((p: PlacedNode) => [p.node.id, p]));
  const childrenOf: Map<string, PlacedNode[]> = new Map();
  for (const item of placed) {
    for (const parentId of item.node.parentIds) childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), item]);
  }
  const heldCentre_of = (id: string): THREE.Vector3 | null => {
    const children: PlacedNode[] = childrenOf.get(id) ?? [];
    if (children.length === 0) return null;
    const centre: THREE.Vector3 = new THREE.Vector3();
    for (const child of children) centre.add(child.position);
    return centre.divideScalar(children.length);
  };
  const starred: StarEntry[] = [];
  for (const { node, position, radius } of placed) {
    if (node.caption !== undefined) {
      // A ghost's words stand over what it holds: the layout parks the
      // anchor itself wherever its pulls cancel, often between clouds.
      const held: THREE.Vector3 | null = node.ghost === true ? heldCentre_of(node.id) : null;
      const reach: number = held !== null ? 0 : node.halo === true ? haloRadius_of(node.count ?? 1) : radius;
      ports.labels.caption_add(node.id, node.caption, held ?? position, reach, palette.done, node.dim === true, node.count ?? 1);
    }
    if (node.ghost === true && node.halo !== true) continue;
    if (ports.starring && node.solid !== true) {
      if (node.halo === true) {
        // A cluster's handle while the scene draws stars: a soft glow at its
        // anchor, facing the camera, sized as its halo would be.
        ports.stars.nebula_add(node.id, position, haloRadius_of(node.count ?? 1), palette.edge, node.dim === true);
        continue;
      }
      starred.push({
        id: node.id,
        position: position.clone(),
        radius,
        color: paint_resolve(node.look.paint, palette).clone(),
        dim: node.dim === true,
        ember: node.look.ember,
        ...(node.ring === true ? { ring: true } : {}),
      });
      continue;
    }
    if (node.halo === true) {
      ports.spheres.halo_add(node.id, position, haloRadius_of(node.count ?? 1), palette.edge, node.dim === true);
      continue;
    }
    // 2D is drawn flat: discs, not lit spheres — the schematic reading
    // all the way down; status colour, selection and flare carry over.
    ports.spheres.sphere_add(node.id, position, radius, {
      color: paint_resolve(node.look.paint, palette),
      dim: node.dim === true,
      selected: node.id === ports.selected,
      flat: ports.flat,
    });
  }
  return { starred, byId };
}

/**
 * Draws the edges: an edge between two solid nodes is a line as ever; an
 * edge touching a star is a thread, all of them one batch.
 */
export function edges_draw(placed: ReadonlyArray<PlacedNode>, byId: ReadonlyMap<string, PlacedNode>, palette: Palette, ports: DrawPorts): void {
  const threads: number[] = [];
  const threadColors: number[] = [];
  const solid = (item: PlacedNode): boolean => !ports.starring || item.node.solid === true;
  const threadEnds: string[] = [];
  // Every thread carries the wave a tube would: streaming into a live
  // stage, replaying a finished run stage by stage. Faint scenery rests.
  const threadModes: number[] = [];
  const threadStarts: number[] = [];
  let deepest: number = 0;
  const depth: Map<string, number> = new Map();
  const depth_of = (id: string, seen: Set<string> = new Set()): number => {
    const known: number | undefined = depth.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    const node: SpaceNode | undefined = byId.get(id)?.node;
    const parents: string[] = node === undefined ? [] : [...node.parentIds, ...node.joinParentIds].filter((p: string): boolean => byId.get(p)?.node.ghost !== true && byId.has(p));
    const d: number = parents.length === 0 ? 0 : 1 + Math.max(...parents.map((p: string): number => depth_of(p, seen)));
    depth.set(id, d);
    return d;
  };
  const thread_add = (from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, dim: boolean, owner: SpaceNode, fromId: string): void => {
    const k: number = dim ? 0.35 : 1;
    const segment: number = threads.length / 6;
    threads.push(from.x, from.y, from.z, to.x, to.y, to.z);
    threadEnds.push(fromId, owner.id);
    threadColors.push(color.r * k, color.g * k, color.b * k, color.r * k, color.g * k, color.b * k);
    const mode: number = dim ? 0 : tubeMode_of(owner.look.state);
    const d: number = mode === 0 ? 0 : depth_of(fromId);
    deepest = Math.max(deepest, d);
    threadModes.push(mode);
    threadStarts.push(d * WAVE_STEP_MS);
    const key: string | null = dim || ports.handoffKey === undefined ? null : ports.handoffKey(owner);
    if (key !== null) ports.handoff.thread_note(key, segment);
  };
  for (const item of placed) {
    const { node, position } = item;
    if (node.ghost === true) continue;
    for (const parentId of node.parentIds) {
      const parent: PlacedNode | undefined = byId.get(parentId);
      if (!parent || parent.node.ghost === true) continue;
      const dim: boolean = node.dim === true || parent.node.dim === true;
      if (solid(item) && solid(parent)) { if (!ports.starring && dim) ports.spheres.edge_add(parentId, node.id, parent.position, position, palette.edge, false, dim); }
      else thread_add(parent.position, position, palette.edge, dim, node, parentId);
    }
    for (const joinId of node.joinParentIds) {
      const parent: PlacedNode | undefined = byId.get(joinId);
      if (!parent) continue;
      if (node.joinFaint === true) {
        thread_add(parent.position, position, palette.join, true, node, joinId);
        continue;
      }
      const dim: boolean = node.dim === true || parent.node.dim === true;
      if (solid(item) && solid(parent)) { if (!ports.starring && dim) ports.spheres.edge_add(joinId, node.id, parent.position, position, palette.join, true, dim); }
      else thread_add(parent.position, position, palette.join, dim, node, joinId);
    }
  }
  ports.stars.threads_draw(threads, threadColors, threadEnds, {
    modes: threadModes,
    starts: threadStarts,
    cycle: (deepest + 1) * WAVE_STEP_MS + PULSE_TRIP_MS / 2 + REPLAY_REST_MS,
  });
}
