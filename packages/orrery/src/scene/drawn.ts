/**
 * @file Where the drawn nodes stand: a sphere, a star or a census member
 * alike, in the world, for flights and framing; and the census's reading of
 * a placement.
 *
 * Pure over the fields; the scene composes it.
 */
import * as THREE from 'three';
import { NODE_RADIUS } from '../layout/index.js';
import { paint_resolve, type CensusField, type CensusNode, type Palette, type StarEntry, type StarField } from '../draw/index.js';
import type { WorldReach } from '../controls/index.js';
import type { SpaceNode } from './node.js';
import type { PlacedNode } from './settle.js';

/** What the lookups read of the scene. */
export interface DrawnPorts {
  meshes: () => ReadonlyMap<string, THREE.Mesh>;
  stars: StarField;
  census: CensusField;
  /** The group every body stands in; a local place is turned into the world through it. */
  group: THREE.Object3D;
}

/** The scene's drawn nodes, looked up by id. */
export class DrawnNodes {
  /**
   * @param ports - What the lookups read of the scene.
   */
  constructor(private readonly ports: DrawnPorts) {}

  /** @returns Every drawn node's id: spheres and stars. */
  public ids(): string[] {
    return [...this.ports.meshes().keys(), ...this.ports.stars.ids()];
  }

  /**
   * Where a drawn node stands in the world and how big it is — a sphere or
   * a star — for flights and framing.
   *
   * @param id - The node.
   * @returns Its world position and radius, or null when it is not drawn.
   */
  public world_of(id: string): WorldReach | null {
    const mesh: THREE.Mesh | undefined = this.ports.meshes().get(id);
    if (mesh !== undefined) {
      const sphere: THREE.BufferGeometry = mesh.geometry;
      if (sphere.boundingSphere === null) sphere.computeBoundingSphere();
      return { position: mesh.getWorldPosition(new THREE.Vector3()), radius: sphere.boundingSphere?.radius ?? NODE_RADIUS };
    }
    const star: StarEntry | undefined = this.ports.stars.entry(id);
    if (star !== undefined) return { position: this.ports.group.localToWorld(star.position.clone()), radius: star.radius };
    return null;
  }

  /**
   * Where a node's sphere or census member stands in the world, for a dive
   * into it; null when it is drawn as neither.
   *
   * @param id - The node.
   * @returns The world position, or null.
   */
  public diveTarget_of(id: string): THREE.Vector3 | null {
    const mesh: THREE.Mesh | undefined = this.ports.meshes().get(id);
    // In census there is no mesh per node: fly to the group's first member.
    const censusIndex: number = mesh === undefined ? this.ports.census.ids().indexOf(id) : -1;
    if (mesh === undefined && censusIndex < 0) return null;
    // World position: the camera flies in world space, and the group may be rotated.
    this.ports.group.updateMatrixWorld(true);
    return mesh !== undefined
      ? mesh.getWorldPosition(new THREE.Vector3())
      : this.ports.group.localToWorld((this.ports.census.positions()[censusIndex] ?? new THREE.Vector3()).clone());
  }

  /**
   * The world reaches of the drawn nodes asked for.
   *
   * @param ids - The nodes; every drawn node when empty.
   * @returns Each drawn one's world position and radius.
   */
  public reaches_of(ids: ReadonlyArray<string>): WorldReach[] {
    const wanted: Set<string> = new Set(ids);
    const reaches: WorldReach[] = [];
    this.ports.group.updateMatrixWorld(true);
    for (const id of this.ids()) {
      if (wanted.size > 0 && !wanted.has(id)) continue;
      const drawn: WorldReach | null = this.world_of(id);
      if (drawn !== null) reaches.push(drawn);
    }
    return reaches;
  }
}

/**
 * A placement as the census reads it. A ghost (a cluster's anchor) is
 * nobody's job; it still counts in the cloud's centre and in how deep a
 * stage lies.
 *
 * @param placed - The nodes to shell.
 * @param palette - The colours.
 * @returns One census node per placed node.
 */
export function censusNodes_of(placed: ReadonlyArray<PlacedNode>, palette: Palette): CensusNode[] {
  return placed.map((item: PlacedNode): CensusNode => {
    const node: SpaceNode = item.node;
    return {
      id: node.id,
      position: item.position,
      radius: item.radius,
      count: Math.max(1, node.count ?? 1),
      color: paint_resolve(node.look.paint, palette),
      dim: node.dim === true,
      ember: node.look.ember,
      state: node.look.state,
      parents: node.parentIds,
      ghost: node.ghost === true,
    };
  });
}
