/**
 * @file Where a model goes: the frame's one table of routes from a result's
 * model kind to the pane that shows it, filled by the session's composition.
 *
 * The frame knows its own panes (files, listings, the console); everything a
 * backend adds (ChRIS: RUNS, the universe, PACS, DICOM images and tags)
 * registers here, so the frame never names a backend's pane.
 *
 * @module
 */
import type { WireEnvelope, WatchState } from '@fnndsc/menu';
import type { PaneKind } from '../app/panes.js';

/** Which stream a model arrived on: a command's result, or the daemon's ambient refresh. */
export type ModelChannel = 'console' | 'ambient';

/** A route: does something with the envelope; true when it took it and the frame should do no more with it. */
export type ModelRoute = (envelope: WireEnvelope) => boolean;

/** How a claimed empty pane becomes a composition's pane, seeded with the envelopes that claimed it. */
export type PaneClaim = (emptyId: string, envelopes: WireEnvelope[]) => void;

/** The routes the session's composition installs. */
export class ModelRouter {
  private readonly routes: Map<ModelChannel, Map<string, ModelRoute[]>> = new Map([['console', new Map()], ['ambient', new Map()]]);
  private readonly observers: Map<ModelChannel, ModelRoute[]> = new Map([['console', []], ['ambient', []]]);
  private readonly claims: Map<string, PaneKind> = new Map();
  private readonly claimers: Map<PaneKind, PaneClaim> = new Map();
  private readonly watchers: Array<(subject: string, state: WatchState) => void> = [];

  /**
   * Routes these model kinds on a channel.
   *
   * @param channel - The stream.
   * @param kinds - The model kinds.
   * @param route - What takes them.
   */
  route_add(channel: ModelChannel, kinds: ReadonlyArray<string>, route: ModelRoute): void {
    const byKind: Map<string, ModelRoute[]> = this.routes.get(channel) as Map<string, ModelRoute[]>;
    for (const kind of kinds) byKind.set(kind, [...(byKind.get(kind) ?? []), route]);
  }

  /**
   * Sees every envelope on a channel the routes left to the frame.
   *
   * @param channel - The stream.
   * @param observer - What looks.
   */
  observer_add(channel: ModelChannel, observer: (envelope: WireEnvelope) => void): void {
    (this.observers.get(channel) as ModelRoute[]).push((envelope: WireEnvelope): boolean => { observer(envelope); return false; });
  }

  /**
   * Hands an envelope to the routes for its kind.
   *
   * @param channel - The stream.
   * @param envelope - The envelope.
   * @returns True when a route took it.
   */
  route(channel: ModelChannel, envelope: WireEnvelope): boolean {
    const kind: string | undefined = envelope.model?.kind;
    if (kind === undefined) return false;
    let taken: boolean = false;
    for (const route of (this.routes.get(channel) as Map<string, ModelRoute[]>).get(kind) ?? []) taken = route(envelope) || taken;
    return taken;
  }

  /**
   * Lets the observers see an envelope the frame kept.
   *
   * @param channel - The stream.
   * @param envelope - The envelope.
   */
  observe(channel: ModelChannel, envelope: WireEnvelope): void {
    for (const observer of this.observers.get(channel) as ModelRoute[]) observer(envelope);
  }

  /**
   * A model kind an empty pane's answer claims it as: the pane kind it becomes.
   *
   * @param modelKind - The model kind.
   * @param paneKind - The pane kind.
   * @param claim - How the pane is made, unless the frame makes that kind itself.
   */
  claim_add(modelKind: string, paneKind: PaneKind, claim?: PaneClaim): void {
    this.claims.set(modelKind, paneKind);
    if (claim !== undefined) this.claimers.set(paneKind, claim);
  }

  /**
   * The pane kind a model claims an empty pane as.
   *
   * @param modelKind - The model kind.
   * @returns The pane kind, or undefined when it claims nothing.
   */
  claimKind_of(modelKind: string): PaneKind | undefined {
    return this.claims.get(modelKind);
  }

  /**
   * How the composition makes a claimed pane of this kind.
   *
   * @param paneKind - The pane kind.
   * @returns Its claim, or undefined when the frame makes it.
   */
  claimer_get(paneKind: PaneKind): PaneClaim | undefined {
    return this.claimers.get(paneKind);
  }

  /**
   * Hears every watched subject's state.
   *
   * @param watcher - What hears it.
   */
  watcher_add(watcher: (subject: string, state: WatchState) => void): void {
    this.watchers.push(watcher);
  }

  /**
   * Tells the watchers a subject's state.
   *
   * @param subject - The subject.
   * @param state - Its state.
   */
  watched(subject: string, state: WatchState): void {
    for (const watcher of this.watchers) watcher(subject, state);
  }
}
