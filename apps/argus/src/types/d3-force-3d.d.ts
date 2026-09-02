/**
 * @file Minimal typings for d3-force-3d (the package ships none): exactly
 * the surface the molecule layout uses.
 */
declare module 'd3-force-3d' {
  export interface SimulationNode {
    id?: string;
    x?: number;
    y?: number;
    z?: number;
    /** Fixed-position anchors: a non-null value pins that axis. */
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }
  export interface Simulation {
    force(name: string, force: unknown): Simulation;
    stop(): Simulation;
    tick(): Simulation;
    alpha(): number;
    alpha(value: number): Simulation;
    alphaTarget(value: number): Simulation;
  }
  /** A link after resolution: endpoints are the node objects themselves. */
  export interface ResolvedLink {
    source: { id: string };
    target: { id: string };
  }
  export interface LinkForce {
    id(accessor: (d: { id: string }) => string): LinkForce;
    distance(value: number | ((link: ResolvedLink) => number)): LinkForce;
  }
  export interface ManyBodyForce {
    strength(value: number | ((d: { id: string }) => number)): ManyBodyForce;
  }
  export interface CollideForce {
    radius(value: number | ((d: { id: string }) => number)): CollideForce;
  }
  export function forceSimulation(nodes: SimulationNode[], dimensions?: number): Simulation;
  export function forceLink(links: Array<{ source: string; target: string }>): LinkForce;
  export function forceManyBody(): ManyBodyForce;
  export function forceCollide(): CollideForce;
  export interface AxisForce {
    strength(value: number | ((d: { id: string }) => number)): AxisForce;
  }
  export function forceX(x: number): AxisForce;
  export function forceY(y: number): AxisForce;
  export function forceZ(z: number): AxisForce;
  export function forceCenter(x: number, y: number, z?: number): unknown;
}
