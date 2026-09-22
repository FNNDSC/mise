/**
 * @file The UNIVERSE pane: the space of everything run here.
 *
 * Every feed the index holds, drawn as its own small molecule — a sphere
 * per plugin group, sized by jobs and hued by status — and pulled toward
 * the feeds that share its pipeline shape, so the field reads as what this
 * lab runs, how much of each, and where the red is. Its own pane kind
 * (docs/aegis.adoc: a session's universe is its own pane), so RUNS-02
 * stays a feed viewer and this keeps its camera and its memory.
 *
 * It breathes. While the index warms, each landing the prompt reports adds
 * or reshapes a molecule. Once the index is whole it keeps moving with the
 * lab: a feed arriving through the roster delta drifts in, a status change
 * recolours, a feed gone from the roster leaves. And it remembers: where
 * the molecules settled is kept per identity, so a reopened pane finds them
 * where they were.
 *
 * @module
 */
import type { PromptContext, WireEnvelope } from '@fnndsc/menu';
import { PROC_UNIVERSE_MODEL_KIND, procUniverseModelSchema, type ProcUniverseModel } from '@fnndsc/menu';
import { DagScene, type SceneNode } from '../../scene/dagScene.js';
import { LandedFeeds, universeGraph_build, universeTip_of, universeStoreKey_of, storedPositions_parse, type LandedFeed } from '../dag/universe.js';
import type { KeyStore } from '../../app/dormant.js';

/** What the pane asks of its host. */
export interface UniversePanelHandlers {
  /** Runs a session command whose envelopes come back through `envelope_observe`. */
  command_run: (line: string) => void;
}

/** The pane's mount points inside its template. */
export interface UniversePanelMount {
  canvas: HTMLElement;
  title: HTMLElement;
  state: HTMLElement | null;
  empty: HTMLElement;
  projectionPill: HTMLElement | null;
  refreshPill: HTMLElement | null;
}

/** How far a sphere's repulsion reaches while the space is small: a molecule hugs itself at this bound. */
const UNIVERSE_REACH: number = 12;

/**
 * Spheres beyond which the reach is unbounded again. The bound is for the
 * first landings — six spheres that would otherwise scatter as dots — and
 * a crowd under it packs into one ball with its clusters lost; a crowd
 * spreads on its own charge and reads as the field it is.
 */
const UNIVERSE_HUG_NODES: number = 240;

/** The least time between two repaints from landings. */
const REPAINT_MS: number = 1000;

/** The least time between two whole re-asks while the lab moves. */
const REASK_MS: number = 5000;

/** The least time between two writes of remembered positions. */
const REMEMBER_MS: number = 3000;

export class UniversePanel {
  private readonly scene: DagScene;
  private readonly landed: LandedFeeds = new LandedFeeds();
  private readonly canvas: HTMLElement;
  private readonly title: HTMLElement;
  private readonly state: HTMLElement | null;
  private readonly empty: HTMLElement;
  private readonly handlers: UniversePanelHandlers;
  private readonly store: KeyStore | undefined;
  /** Whether the index was whole when the space last arrived. */
  private whole: boolean = false;
  /** Whether a space has arrived at all. */
  private shown: boolean = false;
  private warming: string = '';
  private repaintTimer: number | null = null;
  private lastReask: number = 0;
  private rememberTimer: number | null = null;
  private storeKey: string | null = null;
  private arrivalsKey: string = '';
  private feedsCount: number | null = null;
  private disposed: boolean = false;
  /** The reach the scene was last given; undefined until the first paint. */
  private reach: number | undefined | null = null;

  constructor(mount: UniversePanelMount, handlers: UniversePanelHandlers, store?: KeyStore) {
    this.canvas = mount.canvas;
    this.title = mount.title;
    this.state = mount.state;
    this.empty = mount.empty;
    this.handlers = handlers;
    this.store = store;
    this.scene = new DagScene(mount.canvas, {
      // A sphere is a plugin group inside a feed; the tip says both.
      tip: (node: SceneNode): string | null => universeTip_of(node.id, this.landed),
    });
    // A taxonomy is a molecule, not a rank order: gravity pulls the
    // clusters into a crown, and a bounded reach lets a lone molecule hug
    // itself rather than spread across the field as dots.
    this.scene.strategy_set('molecule');
    this.scene.physics_set({ gravity: true });
    mount.projectionPill?.addEventListener('click', (): void => {
      const next: '3d' | '2d' = this.scene.projection_get() === '3d' ? '2d' : '3d';
      this.scene.projection_set(next);
      if (mount.projectionPill !== null) mount.projectionPill.textContent = next.toUpperCase();
    });
    mount.refreshPill?.addEventListener('click', (): void => this.request());
    this.canvas.style.display = 'none';
    this.title_paint();
  }

  /**
   * Asks for the space: every feed the index holds, as it landed.
   * Cache-resident, answered at once whole or not.
   */
  public request(): void {
    this.handlers.command_run('proc universe');
  }

  /**
   * Takes the space when it arrives.
   *
   * @param envelope - Any envelope answering this pane.
   */
  public envelope_observe(envelope: WireEnvelope): void {
    if (envelope.model?.kind !== PROC_UNIVERSE_MODEL_KIND) return;
    const universe = procUniverseModelSchema.safeParse(envelope.model.data);
    if (universe.success) this.space_show(universe.data);
  }

  /**
   * Follows the session: landings while the index warms and after, the
   * warming figure for the title, and the identity the memory is kept
   * under. Once the index is whole, a feed arriving or the feed count
   * moving re-asks for the space so a new molecule drifts in and a gone
   * one leaves.
   *
   * @param context - The pushed prompt context.
   */
  public promptContext_observe(context: PromptContext): void {
    if (this.disposed) return;
    this.identity_note(context.user, context.uri);
    const landings: LandedFeed[] = context.procWarmup?.landed ?? [];
    if (landings.length > 0 && this.shown) this.landings_take(landings);
    const warm = context.procWarmup;
    if (warm?.total !== undefined && warm.total > 0 && warm.sweeping !== false && !this.whole) {
      const percent: number = Math.floor((warm.loaded / warm.total) * 100);
      const warming: string = `INDEX WARMING ${warm.loaded.toLocaleString()}/${warm.total.toLocaleString()} (${percent}%)`;
      if (warming !== this.warming) {
        this.warming = warming;
        this.title_paint();
      }
    } else if (this.shown && !this.whole && (warm === undefined || warm.sweeping === false || warm.state === 'cached')) {
      // The sweep ended under an open pane: ask once for the whole space.
      this.warming = '';
      this.request();
    }
    if (this.shown && this.whole) {
      const arrivalsKey: string = (warm?.arrived ?? []).join(',');
      const feeds: number | null = context.procIndex?.feeds ?? null;
      const moved: boolean =
        (arrivalsKey.length > 0 && arrivalsKey !== this.arrivalsKey) ||
        (feeds !== null && this.feedsCount !== null && feeds !== this.feedsCount);
      this.arrivalsKey = arrivalsKey;
      if (feeds !== null) this.feedsCount = feeds;
      if (moved && Date.now() - this.lastReask > REASK_MS) {
        this.lastReask = Date.now();
        this.request();
      }
    }
  }

  /** Fits the scene to its mount. */
  public size_fit(): void {
    this.scene.size_fit();
  }

  /** Releases the scene. */
  public dispose(): void {
    this.disposed = true;
    if (this.repaintTimer !== null) window.clearTimeout(this.repaintTimer);
    if (this.rememberTimer !== null) window.clearTimeout(this.rememberTimer);
    this.remember_now();
    this.scene.dispose();
  }

  /**
   * Puts the space on the canvas. A whole space replaces what was drawn,
   * so a feed gone from the index leaves; a warming one is what has landed
   * so far and grows from here.
   */
  private space_show(model: ProcUniverseModel): void {
    this.whole = model.whole;
    if (!this.shown) {
      this.shown = true;
      this.seed_recall();
    }
    this.landed.clear();
    this.landed.take(model.feeds);
    if (this.whole) this.warming = '';
    this.empty.style.display = 'none';
    this.canvas.style.display = 'block';
    this.paint();
  }

  /** Takes landings into the space, repainting at most once a second. */
  private landings_take(landed: ReadonlyArray<LandedFeed>): void {
    if (!this.landed.take(landed) || this.repaintTimer !== null) return;
    this.repaintTimer = window.setTimeout((): void => {
      this.repaintTimer = null;
      if (!this.disposed) this.paint();
    }, REPAINT_MS);
  }

  private paint(): void {
    const graph = universeGraph_build(this.landed.all());
    // Hug while small, spread when a crowd: the bound that keeps a lone
    // molecule together would pack seven hundred feeds into one ball.
    // Set only when it changes: physics_set settles the old graph again.
    const reach: number | undefined = graph.nodes.length <= UNIVERSE_HUG_NODES ? UNIVERSE_REACH : undefined;
    if (reach !== this.reach) {
      this.reach = reach;
      this.scene.physics_set({ reach });
    }
    this.scene.graph_set(graph, { wave: false });
    this.title_paint();
    this.remember_later();
  }

  /** Titles the space with what it holds and, while warming, how far the index is. */
  private title_paint(): void {
    const figure: string = `${this.landed.size()} FEEDS · ${this.landed.shapes()} SHAPES`;
    this.title.textContent = this.whole
      ? `UNIVERSE — ${figure}`
      : `UNIVERSE — ${figure}${this.warming.length > 0 ? ` · ${this.warming}` : ' · INDEX WARMING'}`;
    if (this.state !== null) {
      this.state.classList.remove('state-live', 'state-settled', 'state-stale', 'state-wait');
      this.state.classList.add(this.whole ? 'state-settled' : 'state-wait');
      this.state.textContent = this.whole ? 'WHOLE' : 'LANDING';
    }
  }

  /** Learns whose universe this is, once, and seeds it if a space is already up. */
  private identity_note(user: string, uri: string): void {
    const key: string = universeStoreKey_of(user, uri);
    if (key === this.storeKey) return;
    this.storeKey = key;
    if (this.shown) this.seed_recall();
  }

  /** Seeds the next settle from the remembered positions, if any. */
  private seed_recall(): void {
    if (this.store === undefined || this.storeKey === null) return;
    const positions = storedPositions_parse(this.store.getItem(this.storeKey));
    if (Object.keys(positions).length > 0) this.scene.positions_seed(positions);
  }

  private remember_later(): void {
    if (this.rememberTimer !== null) return;
    this.rememberTimer = window.setTimeout((): void => {
      this.rememberTimer = null;
      this.remember_now();
    }, REMEMBER_MS);
  }

  /** Writes where the molecules stand, for the next visit. */
  private remember_now(): void {
    if (this.store === undefined || this.storeKey === null || !this.shown) return;
    try {
      this.store.setItem(this.storeKey, JSON.stringify(this.scene.positions_get()));
    } catch {
      // A full or refused store forgets; the space still draws.
    }
  }
}
