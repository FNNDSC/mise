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
  }
  export interface Simulation {
    force(name: string, force: unknown): Simulation;
    stop(): Simulation;
    tick(): Simulation;
  }
  export interface LinkForce {
    id(accessor: (d: { id: string }) => string): LinkForce;
    distance(value: number): LinkForce;
  }
  export function forceSimulation(nodes: SimulationNode[], dimensions?: number): Simulation;
  export function forceLink(links: Array<{ source: string; target: string }>): LinkForce;
  export function forceManyBody(): { strength(value: number): unknown };
  export function forceCenter(x: number, y: number, z: number): unknown;
}
