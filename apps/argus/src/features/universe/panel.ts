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
import type { FeedDagModel, FeedDagNode, PromptContext, WireEnvelope } from '@fnndsc/menu';
import { PROC_UNIVERSE_MODEL_KIND, procUniverseModelSchema, type ProcUniverseModel } from '@fnndsc/menu';
import { DagScene, PHYSICS_DEFAULT, type PhysicsTerms, type SceneGraph, type SceneNode } from '../../scene/dagScene.js';
import {
  LandedFeeds, universeGraph_build, universeTip_of, universeStoreKey_of, storedPositions_parse,
  enteredFeed_build, descendedGraph_build, sphereIds_of, clusterTip_of, clusterGraph_build, clusterIds_of, shapeWords_of, shapeWords_brief, shape_of,
  foldedGraph_build, foldTip_of, foldShape_of, foldIds_of, unfoldedGraph_build,
  type LandedFeed, type UniverseScale, type EnteredFeed,
} from '../dag/universe.js';
import type { KeyStore } from '../../app/dormant.js';

/** What the pane asks of its host. */
export interface UniversePanelHandlers {
  /** Runs a session command whose envelopes come back through `envelope_observe`. */
  command_run: (line: string) => void;
  /** The kernel's graph of one feed (`feed diagram`), or null when it cannot be had. */
  feed_dag?: (feedId: number) => Promise<FeedDagModel | null>;
  /** The operator enters a node's data: the session's cwd moves there. */
  node_enter?: (vfsPath: string) => void;
  /** PROCESS on a node: a catalogue bound to its data. */
  node_process?: (node: { vfsPath: string; instanceId: number; label: string }) => void;
  /** OPEN: the feed in a RUNS pane of its own. */
  feed_open?: (feedId: number) => void;
}

/** One feed entered: what was asked for, and what came. */
interface EnteredState {
  feedId: number;
  title: string;
  entered: EnteredFeed;
  ids: Set<string>;
}

/** The pane's mount points inside its template. */
export interface UniversePanelMount {
  canvas: HTMLElement;
  title: HTMLElement;
  state: HTMLElement | null;
  empty: HTMLElement;
  projectionPill: HTMLElement | null;
  refreshPill: HTMLElement | null;
  scalePill: HTMLElement | null;
  /** VIEW: every feed its own molecule, or the shapes folded. */
  viewPill: HTMLElement | null;
  /** GRAVITY: the mass-weighted centring that gathers the clusters; a knob for play. */
  gravityPill: HTMLElement | null;
  /** The facts overlay on the field: the selected node's payload and verbs. */
  facts: HTMLElement | null;
  /** BACK, on the frame while a feed is entered. */
  backPill: HTMLElement | null;
  /** OPEN FEED, on the frame while a feed is entered. */
  openPill: HTMLElement | null;
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

/** How long the camera takes to reach a molecule, and to frame its feed. */
const DESCENT_MS: number = 650;

/** How long the climb back out takes. */
const ASCENT_MS: number = 650;

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
  /** What sizes a sphere: its jobs (log) or nothing. */
  private scale: UniverseScale = 'jobs';
  /**
   * What the top of the universe shows: every feed as its own molecule
   * (the whole compute structure, the default), or the shapes folded, one
   * molecule per pipeline for when a thousand runs of one are in the way.
   */
  private view: 'feeds' | 'shapes' = 'feeds';
  /** The feed entered, while one is. */
  private inside: EnteredState | null = null;
  /** The cluster in view, while one is: a shape and its spheres. */
  private cluster: { shape: string; ids: string[] } | null = null;
  /** A descent or an ascent in flight: clicks wait. */
  private flying: boolean = false;
  private readonly facts: HTMLElement | null;
  private viewPill: HTMLElement | null = null;
  private gravityPill: HTMLElement | null = null;
  /** The settle's terms as the operator has them; gravity on by default here. */
  private physics: PhysicsTerms = { ...PHYSICS_DEFAULT, gravity: true };
  private readonly backPill: HTMLElement | null;
  private readonly openPill: HTMLElement | null;
  private readonly pane: HTMLElement | null;
  private readonly escape_listen: (event: KeyboardEvent) => void;
  /** The reach the scene was last given; undefined until the first paint. */
  private reach: number | undefined | null = null;

  constructor(mount: UniversePanelMount, handlers: UniversePanelHandlers, store?: KeyStore) {
    this.canvas = mount.canvas;
    this.title = mount.title;
    this.state = mount.state;
    this.empty = mount.empty;
    this.handlers = handlers;
    this.store = store;
    this.facts = mount.facts;
    this.backPill = mount.backPill;
    this.openPill = mount.openPill;
    this.pane = mount.canvas.closest<HTMLElement>('.workspace-pane');
    this.scene = new DagScene(mount.canvas, {
      // A sphere is a plugin group inside a feed; the tip says both. Inside
      // a feed the nodes are its own and carry their labels.
      tip: (node: SceneNode): string | null => (this.inside === null ? (foldTip_of(node.id, this.landed) ?? universeTip_of(node.id, this.landed) ?? clusterTip_of(node.id, this.landed)) : null),
      // Outside: a click on a sphere descends into its feed. Inside: a
      // click on one of the feed's nodes shows its facts and its verbs.
      select: (node: SceneNode): void => this.node_select(node),
      deselect: (): void => this.facts_clear(),
    });
    mount.backPill?.addEventListener('click', (): void => this.ascend());
    mount.openPill?.addEventListener('click', (): void => {
      if (this.inside !== null) this.handlers.feed_open?.(this.inside.feedId);
    });
    // Esc climbs out, one press, one level — the same key that leaves a
    // node overlay in the DAG pane.
    this.escape_listen = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || (this.inside === null && this.cluster === null) || this.flying) return;
      if (this.pane !== null && this.pane.offsetParent === null) return;
      this.ascend();
    };
    window.addEventListener('keydown', this.escape_listen);
    // A taxonomy is a molecule, not a rank order: gravity pulls the
    // clusters into a crown, and a bounded reach lets a lone molecule hug
    // itself rather than spread across the field as dots.
    this.scene.strategy_set('molecule');
    this.scene.physics_set(this.physics);
    mount.projectionPill?.addEventListener('click', (): void => {
      const next: '3d' | '2d' = this.scene.projection_get() === '3d' ? '2d' : '3d';
      this.scene.projection_set(next);
      if (mount.projectionPill !== null) mount.projectionPill.textContent = next.toUpperCase();
    });
    mount.refreshPill?.addEventListener('click', (): void => this.request());
    mount.scalePill?.addEventListener('click', (): void => {
      this.scale = this.scale === 'jobs' ? 'feeds' : 'jobs';
      if (mount.scalePill !== null) mount.scalePill.textContent = this.scale === 'jobs' ? 'JOBS' : 'ALIKE';
      if (this.shown) this.paint();
    });
    mount.viewPill?.addEventListener('click', (): void => this.view_set(this.view === 'feeds' ? 'shapes' : 'feeds'));
    this.viewPill = mount.viewPill;
    this.gravityPill = mount.gravityPill;
    mount.gravityPill?.addEventListener('click', (): void => { this.physics_set('gravity', !this.physics.gravity); });
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

  /**
   * The console's verbs on this pane: `universe enter <feed>`, `universe
   * back`, `universe open`. A surface can be asked what it can be pressed.
   *
   * @param verb - The verb.
   * @param args - Its words.
   * @returns What happened, for the console.
   */
  public control(verb: string, args: string[]): string {
    if (verb === 'enter') {
      const feedId: number = parseInt(args[0] ?? '', 10);
      if (!Number.isFinite(feedId)) return 'universe enter <feed id>';
      if (this.landed.get(feedId) === undefined) return `universe enter: feed ${feedId} has not landed here`;
      if (this.inside !== null) return `universe enter: already inside feed ${this.inside.feedId}; universe back first`;
      this.descend(feedId);
      return `entering feed ${feedId}`;
    }
    if (verb === 'physics') {
      const term: string = (args[0] ?? '').toLowerCase();
      if (term === 'reset') return this.physics_reset();
      if (!['charge', 'link', 'collide', 'gravity'].includes(term)) return 'universe physics charge|link|collide|gravity [on|off] | reset';
      const on: boolean = (args[1] ?? 'on').toLowerCase() !== 'off';
      return this.physics_set(term as keyof PhysicsTerms, on);
    }
    if (verb === 'view') {
      const wanted: string = (args[0] ?? '').toLowerCase();
      if (wanted !== 'feeds' && wanted !== 'shapes') return 'universe view feeds|shapes';
      if (this.inside !== null || this.cluster !== null) return 'universe view: climb out first (universe back)';
      this.view_set(wanted);
      return wanted === 'feeds' ? 'every feed its own molecule' : 'the shapes folded, one molecule each';
    }
    if (this.flying && (verb === 'enter' || verb === 'cluster' || verb === 'back')) return 'universe: still moving; ask again';
    if (verb === 'cluster') {
      const feedId: number = parseInt(args[0] ?? '', 10);
      const feed: LandedFeed | undefined = Number.isFinite(feedId) ? this.landed.get(feedId) : undefined;
      if (feed === undefined) return 'universe cluster <feed id>: the cluster of a feed that landed here';
      if (this.inside !== null) return `universe cluster: inside feed ${this.inside.feedId}; universe back first`;
      this.cluster_enter(shape_of(feed));
      return `viewing the cluster of feed ${feedId}: ${shapeWords_of(shape_of(feed))}`;
    }
    if (verb === 'back') {
      if (this.inside === null && this.cluster === null) return 'universe back: not inside a feed or a cluster';
      this.ascend();
      return 'climbing out';
    }
    if (verb === 'open') {
      if (this.inside === null) return 'universe open: not inside a feed';
      this.handlers.feed_open?.(this.inside.feedId);
      return `opening feed ${this.inside.feedId}`;
    }
    return 'universe enter <feed>|cluster <feed>|view feeds|shapes|physics <term> on|off|reset|back|open';
  }

  /**
   * Sets one physics term of the settle and re-settles the top of the
   * universe. Refused while inside a feed or a cluster: their settle is
   * the descent's own.
   *
   * @param term - The term.
   * @param on - Its new state.
   * @returns What happened, for the console.
   */
  private physics_set(term: keyof PhysicsTerms, on: boolean): string {
    if (this.inside !== null || this.cluster !== null) return 'universe physics: climb out first (universe back)';
    if (term === 'reach') return 'universe physics: reach is the pane\'s own';
    this.physics = { ...this.physics, [term]: on };
    this.physics_apply();
    return `physics ${term} ${on ? 'on' : 'off'}`;
  }

  /** Puts every term back as the universe wants them. */
  private physics_reset(): string {
    if (this.inside !== null || this.cluster !== null) return 'universe physics: climb out first (universe back)';
    this.physics = { ...PHYSICS_DEFAULT, gravity: true };
    this.physics_apply();
    return 'physics reset';
  }

  private physics_apply(): void {
    if (this.gravityPill !== null) this.gravityPill.textContent = this.physics.gravity ? 'GRAVITY ON' : 'GRAVITY OFF';
    // The reach rides on top of the operator's terms, chosen per paint.
    this.scene.physics_set({ ...this.physics, reach: this.reach ?? undefined });
    this.title_paint();
  }

  /** Switches the top of the universe between every feed and the folded shapes. */
  private view_set(view: 'feeds' | 'shapes'): void {
    this.view = view;
    if (this.viewPill !== null) this.viewPill.textContent = view.toUpperCase();
    if (this.shown && this.inside === null && this.cluster === null) this.paint();
  }

  /** Whether a feed is entered, for a host that asks. */
  public inside_get(): number | null {
    return this.inside?.feedId ?? null;
  }

  /** Whether a space has arrived, for a host deciding whether to ask. */
  public shown_get(): boolean {
    return this.shown;
  }

  /** Releases the scene. */
  public dispose(): void {
    this.disposed = true;
    window.removeEventListener('keydown', this.escape_listen);
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
    // A space arriving while a feed is entered is taken, not drawn: the
    // descent stands until the climb, which paints what has landed since.
    if (this.inside === null && this.cluster === null) this.paint();
    else this.title_paint();
  }

  /** Takes landings into the space, repainting at most once a second. */
  private landings_take(landed: ReadonlyArray<LandedFeed>): void {
    if (!this.landed.take(landed) || this.repaintTimer !== null || this.inside !== null || this.cluster !== null) return;
    this.repaintTimer = window.setTimeout((): void => {
      this.repaintTimer = null;
      if (!this.disposed) this.paint();
    }, REPAINT_MS);
  }

  private paint(fit: boolean = true): void {
    // The top of the universe: every feed (the structure itself), or the
    // shapes folded when the operator asks for it.
    const graph = this.view === 'shapes' ? foldedGraph_build(this.landed.all(), this.scale) : universeGraph_build(this.landed.all(), this.scale);
    // Hug while small, spread when a crowd: the bound that keeps a lone
    // molecule together would pack seven hundred feeds into one ball.
    // Set only when it changes: physics_set settles the old graph again.
    const reach: number | undefined = graph.nodes.length <= UNIVERSE_HUG_NODES ? UNIVERSE_REACH : undefined;
    if (reach !== this.reach) {
      this.reach = reach;
      this.scene.physics_set({ reach });
    }
    this.scene.graph_set(graph, { wave: false, fit });
    this.title_paint();
    this.remember_later();
  }

  /**
   * Descends into one feed: the camera flies to its molecule, the kernel's
   * graph of the feed is asked for, the molecule unfolds into it in place
   * while the rest of the space dims, and the camera frames the feed.
   *
   * @param feedId - The feed.
   */
  private descend(feedId: number): void {
    const feed: LandedFeed | undefined = this.landed.get(feedId);
    const ask = this.handlers.feed_dag;
    if (feed === undefined || ask === undefined || this.flying || this.inside !== null) return;
    this.flying = true;
    this.facts_clear();
    const spheres: string[] = sphereIds_of(feedId, feed);
    this.scene.camera_flyToFit(spheres, DESCENT_MS, (): void => {
      void ask(feedId).then((model: FeedDagModel | null): void => {
        if (this.disposed) return;
        if (model === null) {
          this.flying = false;
          return;
        }
        const entered: EnteredFeed = enteredFeed_build(model);
        // The feed unfolds from where its molecule stood — or, entered by
        // word from the folded top, from where its shape's fold stands:
        // every new node starts at that centre and settles out from it.
        const positions = this.scene.positions_get();
        const centre: [number, number, number] = [0, 0, 0];
        let counted: number = 0;
        for (const id of [...spheres, ...foldIds_of(shape_of(feed), this.landed)]) {
          const at = positions[id];
          if (at === undefined) continue;
          centre[0] += at[0]; centre[1] += at[1]; centre[2] += at[2]; counted += 1;
          if (counted === spheres.length && spheres.some((sphere: string): boolean => positions[sphere] !== undefined)) break;
        }
        if (counted > 0) { centre[0] /= counted; centre[1] /= counted; centre[2] /= counted; }
        for (const node of entered.nodes) {
          positions[node.id] = [centre[0] + (Math.random() - 0.5) * 0.5, centre[1] + (Math.random() - 0.5) * 0.5, centre[2] + (Math.random() - 0.5) * 0.5];
        }
        this.scene.positions_seed(positions);
        // The base is what stands behind the feed: every feed, or its own
        // shape unfolded with the rest still folded; the feed's molecule
        // replaced by its graph, everything but the graph dimmed.
        const prefix: string = `feed:${feedId}:`;
        const graph: SceneGraph = this.view === 'feeds'
          ? descendedGraph_build(this.landed.all(), feedId, entered, this.scale)
          : {
              nodes: [
                ...unfoldedGraph_build(this.landed.all(), shape_of(feed), this.scale).graph.nodes
                  .filter((node: SceneNode): boolean => !node.id.startsWith(prefix))
                  .map((node: SceneNode): SceneNode => ({ ...node, dim: true })),
                ...entered.nodes,
              ],
            };
        // Only the feed settles: the rest of the space holds still and
        // pushes on nothing, and the feed hugs itself where the molecule
        // stood rather than exploding into a crowd's charge.
        const enteredIds: Set<string> = new Set(entered.nodes.map((node: SceneNode): string => node.id));
        const frozen: string[] = graph.nodes.filter((node: SceneNode): boolean => !enteredIds.has(node.id)).map((node: SceneNode): string => node.id);
        this.scene.graph_set(graph, { wave: false, fit: false, frozen, physics: { reach: UNIVERSE_REACH, gravity: false } });
        this.inside = { feedId, title: model.feedName, entered, ids: new Set(entered.nodes.map((node: SceneNode): string => node.id)) };
        this.pane?.classList.add('universe-inside');
        this.title_paint();
        this.scene.camera_flyToFit([...this.inside.ids], DESCENT_MS, (): void => { this.flying = false; });
      });
    });
  }

  /**
   * Climbs back out one level: from a feed to the cluster it was entered
   * from (or the whole space), from a cluster to the whole space, framed.
   */
  private ascend(): void {
    if (this.flying) return;
    if (this.inside !== null) {
      this.inside = null;
      this.facts_clear();
      this.pane?.classList.remove('universe-inside');
      if (this.cluster !== null) {
        this.cluster_show(this.cluster.shape);
        return;
      }
    } else if (this.cluster === null) {
      return;
    } else {
      this.cluster = null;
      this.pane?.classList.remove('universe-cluster');
    }
    this.flying = true;
    this.paint(false);
    this.scene.camera_flyToFit([], ASCENT_MS, (): void => { this.flying = false; });
  }

  /**
   * Brings one cluster into view: every feed of the shape lit, the rest
   * dimmed where they stand, the camera flown to frame the cluster. The
   * fsv reading one level up from a feed: a directory of feeds alike.
   *
   * @param shape - The shape.
   */
  private cluster_enter(shape: string): void {
    if (this.flying || this.inside !== null) return;
    this.cluster_show(shape);
  }

  private cluster_show(shape: string): void {
    if (this.view === 'feeds') {
      // Every feed is already drawn: the cluster is lit where it stands,
      // the rest dimmed, nothing moved, the camera flown to frame it.
      const ids: string[] = clusterIds_of(shape, this.landed);
      if (ids.length === 0) return;
      this.flying = true;
      this.cluster = { shape, ids };
      this.pane?.classList.add('universe-cluster');
      const lit: SceneGraph = clusterGraph_build(this.landed.all(), shape, this.scale);
      this.scene.graph_set(lit, { wave: false, fit: false, frozen: lit.nodes.map((node: SceneNode): string => node.id) });
      this.title_paint();
      this.scene.camera_flyToFit(ids, DESCENT_MS, (): void => { this.flying = false; });
      return;
    }
    const { graph, memberIds } = unfoldedGraph_build(this.landed.all(), shape, this.scale);
    if (memberIds.length === 0) return;
    this.flying = true;
    this.cluster = { shape, ids: memberIds };
    this.pane?.classList.add('universe-cluster');
    // The members unfold from where the folded molecule stood: each starts
    // at its centre and settles out, the rest of the field frozen, no
    // gravity to the origin, no centering — the feed descent's settle.
    const positions = this.scene.positions_get();
    const foldIds: string[] = foldIds_of(shape, this.landed);
    const centre: [number, number, number] = [0, 0, 0];
    let counted: number = 0;
    for (const id of foldIds) {
      const at = positions[id];
      if (at === undefined) continue;
      centre[0] += at[0]; centre[1] += at[1]; centre[2] += at[2]; counted += 1;
    }
    if (counted > 0) { centre[0] /= counted; centre[1] /= counted; centre[2] /= counted; }
    const memberSet: Set<string> = new Set(memberIds);
    for (const node of graph.nodes) {
      if (memberSet.has(node.id) || node.ghost === true) {
        positions[node.id] = [centre[0] + (Math.random() - 0.5) * 0.5, centre[1] + (Math.random() - 0.5) * 0.5, centre[2] + (Math.random() - 0.5) * 0.5];
      }
    }
    this.scene.positions_seed(positions);
    const frozen: string[] = graph.nodes.filter((node: SceneNode): boolean => !memberSet.has(node.id) && node.ghost !== true).map((node: SceneNode): string => node.id);
    this.scene.graph_set(graph, { wave: false, fit: false, frozen, physics: { reach: UNIVERSE_REACH, gravity: false } });
    this.title_paint();
    this.scene.camera_flyToFit(memberIds, DESCENT_MS, (): void => { this.flying = false; });
  }

  /** A click: descend from a sphere outside, show facts on a node inside. */
  private node_select(node: SceneNode): void {
    if (this.flying) return;
    if (this.inside === null) {
      const match: RegExpMatchArray | null = node.id.match(/^feed:(\d+):\d+$/);
      const folded: string | null = foldShape_of(node.id);
      if (match !== null) this.descend(Number(match[1]));
      else if (folded !== null) this.cluster_enter(folded);
      else if (node.id.startsWith('shape:')) this.cluster_enter(node.id.slice('shape:'.length));
      return;
    }
    const payload: FeedDagNode | undefined = this.inside.entered.payloads.get(node.id);
    if (payload !== undefined) this.facts_show(node, payload);
  }

  /** The selected node's facts and verbs, on the field's overlay. */
  private facts_show(node: SceneNode, payload: FeedDagNode): void {
    if (this.facts === null) return;
    this.facts.replaceChildren();
    const tally = payload.tally;
    const rows: Array<[string, string]> = [
      ['PLUGIN', payload.pluginName],
      [tally ? 'REP. INSTANCE' : 'INSTANCE', String(payload.instanceId)],
      ['STATUS', payload.status],
      ...(tally ? ([['COUNT', `×${tally.count} — ${tally.done} done, ${tally.error} err, ${tally.running} live`]] as Array<[string, string]>) : []),
      ['DATA', payload.vfsPath],
    ];
    for (const [label, value] of rows) {
      const row: HTMLDivElement = document.createElement('div');
      row.className = 'telemetry-row';
      const name: HTMLSpanElement = document.createElement('span');
      name.className = 'telemetry-label';
      name.textContent = label;
      const figure: HTMLSpanElement = document.createElement('span');
      figure.className = 'telemetry-value';
      figure.textContent = value;
      row.append(name, figure);
      this.facts.append(row);
    }
    // The node's verbs ride its facts: a control lives where it acts.
    const verbs: HTMLDivElement = document.createElement('div');
    verbs.className = 'universe-node-verbs';
    const enter: HTMLButtonElement = document.createElement('button');
    enter.className = 'pacs-capsule universe-node-enter';
    enter.textContent = 'ENTER NODE';
    enter.title = 'the session moves to this node\'s data';
    enter.addEventListener('click', (): void => this.handlers.node_enter?.(payload.vfsPath));
    const process: HTMLButtonElement = document.createElement('button');
    process.className = 'pacs-capsule universe-node-process';
    process.textContent = 'PROCESS';
    process.title = 'a catalogue bound to this node\'s data';
    process.addEventListener('click', (): void => this.handlers.node_process?.({ vfsPath: payload.vfsPath, instanceId: payload.instanceId, label: node.label }));
    verbs.append(enter, process);
    this.facts.append(verbs);
    this.facts.hidden = false;
  }

  private facts_clear(): void {
    if (this.facts === null) return;
    this.facts.replaceChildren();
    this.facts.hidden = true;
  }

  /** Titles the space with what it holds and, while warming, how far the index is. */
  private title_paint(): void {
    if (this.inside !== null) {
      const jobs: number = this.inside.entered.nodes.reduce((sum: number, node: SceneNode): number => sum + (node.count ?? 1), 0);
      this.title.textContent = `UNIVERSE — INSIDE FEED ${this.inside.feedId} · ${this.inside.title} · ${jobs.toLocaleString('en-US')} JOBS`;
      if (this.state !== null) {
        this.state.classList.remove('state-live', 'state-settled', 'state-stale', 'state-wait');
        this.state.classList.add('state-live');
        this.state.textContent = 'INSIDE';
      }
      return;
    }
    if (this.cluster !== null) {
      const count: number = this.landed.all().filter((feed: LandedFeed): boolean => shape_of(feed) === this.cluster?.shape).length;
      // The bar is not the place for eleven plugin names: the first few and
      // the count, the whole shape on the halo's tip.
      this.title.textContent = `UNIVERSE — SHAPE ${shapeWords_brief(this.cluster.shape)} · ${count} FEED${count === 1 ? '' : 'S'}`;
      if (this.state !== null) {
        this.state.classList.remove('state-live', 'state-settled', 'state-stale', 'state-wait');
        this.state.classList.add('state-live');
        this.state.textContent = 'CLUSTER';
      }
      return;
    }
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
