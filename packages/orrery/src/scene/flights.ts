/**
 * @file The flights: the choreographies a surface asks of the scene as one
 * word each — frame these nodes; unfold this graph from where those stood;
 * light this graph where it stands and frame it; descend: approach, ask,
 * unfold, frame. The scene says whether one is under way.
 *
 * A surface used to spell each of these as five scene calls round a flag
 * of its own; the steps and the flag are the scene's now. Composed by the
 * scene through small ports.
 */
import type { PhysicsTerms } from '../layout/index.js';
import type { SpaceNode } from './node.js';

/** Where every node stands, by id. */
export type Places = Record<string, [number, number, number]>;

/** The graph a flight draws: the scene's own shape, typed by the surface's node. */
export interface FlightGraph<N extends SpaceNode> {
  nodes: N[];
}

/** How far a node unfolding from a centre starts from it, in scene units each way. */
export const UNFOLD_SCATTER: number = 0.5;

/**
 * An unfold: a new graph in which some nodes settle out from where others
 * stood, the rest of the space holding still.
 */
export interface UnfoldPlan<N extends SpaceNode> {
  /** The space to draw. */
  graph: FlightGraph<N>;
  /** The nodes that settle; every other node is held where it stands. */
  unfolding: ReadonlyArray<string>;
  /**
   * Where the unfolding nodes start: the centre of the first tier of ids
   * that has a place (a feed's spheres; failing them, its shape's fold).
   */
  from: ReadonlyArray<ReadonlyArray<string>>;
  /** Physics for this settle alone (no gravity: the feed opens where it stood). */
  physics?: Partial<PhysicsTerms>;
  /** The nodes the camera frames once drawn. */
  frame: ReadonlyArray<string>;
  durationMs: number;
  /** The share of the framed nodes the frame must hold; see the rig's flyToFit. */
  bulk?: number;
  margin?: number;
  /** The graph is drawn, before the camera flies: a surface notes what it is now inside. */
  drawn?: () => void;
}

/** How a descent approaches a feed before its graph is asked for. */
export type Approach =
  | { toward: string; distance: number; durationMs: number }
  | { fit: ReadonlyArray<string>; durationMs: number };

/** What the flights move of the scene. */
export interface FlightPorts<N extends SpaceNode> {
  positions_get: () => Places;
  positions_seed: (places: Places) => void;
  graph_set: (graph: FlightGraph<N>, options: { wave: false; fit: false; frozen: ReadonlyArray<string>; physics?: Partial<PhysicsTerms> }) => void;
  flyToFit: (ids: ReadonlyArray<string>, durationMs: number, onDone: () => void, bulk?: number, margin?: number) => void;
  flyToward: (id: string, distance: number, durationMs: number, onDone: () => void) => void;
  /** Whether the scene still stands (a descent's ask may outlive it). */
  alive: () => boolean;
  /** Scatter about a centre, -0.5..0.5 (a test hands in its own). */
  random?: () => number;
}

/** The scene's flights. */
export class Flights<N extends SpaceNode> {
  private busy: boolean = false;

  /**
   * @param ports - What the flights move of the scene.
   */
  constructor(private readonly ports: FlightPorts<N>) {}

  /** @returns Whether a flight is under way (a frame, an unfold, a descent). */
  public moving(): boolean {
    return this.busy;
  }

  /**
   * Frames nodes: the camera flies to hold them, and the scene is moving
   * until it arrives.
   *
   * @param ids - The nodes; every drawn node when empty.
   * @param durationMs - The flight's length.
   * @param onDone - Called on arrival.
   * @param bulk - The share of the nodes the frame must hold.
   * @param margin - Room around.
   */
  public frame(ids: ReadonlyArray<string>, durationMs: number, onDone: () => void, bulk?: number, margin?: number): void {
    this.busy = true;
    this.ports.flyToFit(ids, durationMs, (): void => {
      this.busy = false;
      onDone();
    }, bulk, margin);
  }

  /**
   * Lights a graph where everything stands — nothing settles — and frames
   * part of it.
   *
   * @param graph - The space to draw, every node held where it is.
   * @param frame - The nodes to frame.
   * @param durationMs - The flight's length.
   * @param onDone - Called on arrival.
   * @param drawn - The graph is drawn, before the camera flies.
   */
  public relight(graph: FlightGraph<N>, frame: ReadonlyArray<string>, durationMs: number, onDone: () => void, drawn?: () => void): void {
    this.busy = true;
    this.ports.graph_set(graph, { wave: false, fit: false, frozen: graph.nodes.map((node: N): string => node.id) });
    drawn?.();
    this.ports.flyToFit(frame, durationMs, (): void => {
      this.busy = false;
      onDone();
    });
  }

  /**
   * Unfolds a graph: the unfolding nodes start scattered about the centre
   * of where the `from` nodes stood and settle out from it, the rest of
   * the space frozen; then the camera frames what was asked.
   *
   * @param plan - The unfold.
   * @param onDone - Called on arrival.
   */
  public unfold(plan: UnfoldPlan<N>, onDone: () => void): void {
    this.busy = true;
    const places: Places = this.ports.positions_get();
    const centre: [number, number, number] = centre_of(places, plan.from);
    const random: () => number = this.ports.random ?? ((): number => Math.random() - 0.5);
    for (const id of plan.unfolding) {
      places[id] = [centre[0] + random() * UNFOLD_SCATTER, centre[1] + random() * UNFOLD_SCATTER, centre[2] + random() * UNFOLD_SCATTER];
    }
    this.ports.positions_seed(places);
    const unfolding: Set<string> = new Set(plan.unfolding);
    const frozen: string[] = plan.graph.nodes.filter((node: N): boolean => !unfolding.has(node.id)).map((node: N): string => node.id);
    this.ports.graph_set(plan.graph, { wave: false, fit: false, frozen, ...(plan.physics !== undefined ? { physics: plan.physics } : {}) });
    plan.drawn?.();
    this.ports.flyToFit(plan.frame, plan.durationMs, (): void => {
      this.busy = false;
      onDone();
    }, plan.bulk, plan.margin);
  }

  /**
   * Descends: the camera approaches, the surface is asked for what to
   * unfold (seconds, on a large feed; it may answer nothing), and the
   * answer unfolds and is framed. The scene is moving from the first
   * frame to the last, or until the ask comes back empty.
   *
   * @param approach - How the camera approaches first.
   * @param ask - What to unfold once there; null when nothing can be had.
   * @param onDone - Called on arrival.
   * @param onRefused - Called when the ask answered nothing.
   */
  public descent(approach: Approach, ask: () => Promise<UnfoldPlan<N> | null>, onDone: () => void, onRefused: () => void): void {
    this.busy = true;
    const arrived = (): void => {
      void ask().then((plan: UnfoldPlan<N> | null): void => {
        if (!this.ports.alive()) return;
        if (plan === null) {
          this.busy = false;
          onRefused();
          return;
        }
        this.unfold(plan, onDone);
      });
    };
    if ('toward' in approach) this.ports.flyToward(approach.toward, approach.distance, approach.durationMs, arrived);
    else this.ports.flyToFit(approach.fit, approach.durationMs, arrived);
  }
}

/**
 * The centre of the first tier of nodes that has a place.
 *
 * @param places - Where every node stands.
 * @param tiers - Ids to try, tier by tier.
 * @returns The centre; the origin when no tier has a place.
 */
export function centre_of(places: Places, tiers: ReadonlyArray<ReadonlyArray<string>>): [number, number, number] {
  for (const tier of tiers) {
    const centre: [number, number, number] = [0, 0, 0];
    let counted: number = 0;
    for (const id of tier) {
      const at: [number, number, number] | undefined = places[id];
      if (at === undefined) continue;
      centre[0] += at[0]; centre[1] += at[1]; centre[2] += at[2]; counted += 1;
    }
    if (counted > 0) return [centre[0] / counted, centre[1] / counted, centre[2] / counted];
  }
  return [0, 0, 0];
}
