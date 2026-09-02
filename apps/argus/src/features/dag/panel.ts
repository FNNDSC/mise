/**
 * @file The DAG pane: a feed's live execution graph, drawn beside the files
 * it produces.
 *
 * The pane is a projection of the `feed.dag` envelope model — it issues no
 * bespoke requests of its own. It follows the working directory the way the
 * files panel does (cd into a feed and its graph appears); an explicit
 * `feed diagram <feed>` pins the shown feed until the cwd enters a
 * different one. Statuses arriving on the typed progress channel recolor
 * nodes in place; the topology itself came once, on the envelope.
 *
 * Selection shows the node's facts; activation lowers to a `cd` of the
 * node's data space — the graph and the filesystem are one object seen
 * twice, so "fly into a node" is navigation, not a new machine.
 *
 * @module
 */
import {
  feedDagModelSchema,
  feedListModelSchema,
  DAG_MODEL_KINDS,
  FEED_LIST_MODEL_KIND,
  type FeedDagModel,
  type FeedDagNode,
  type FeedListEntry,
  type PromptContext,
  type WireEnvelope,
} from '@fnndsc/menu';
import { DagScene, type LayoutStrategy, type PhysicsTerms, type SceneNode } from '../../scene/dagScene.js';
import { RosterOrder } from '../roster/order.js';
import type { ProgressMessage } from '../../calypso/client.js';

/** What the pane asks of its host. */
export interface DagPanelHandlers {
  /** Runs a session command silently (instrument traffic, not transcript). */
  command_run: (line: string) => void;
  /** Lowers a node activation to a visible cd. */
  node_enter: (vfsPath: string) => void;
  /**
   * A dblclick dive arrived inside a node: the host overlays the rooted
   * browser. When absent, activation falls back to `node_enter`.
   */
  node_dive?: (vfsPath: string) => void;
  /** A node was selected: the pane indicates its data address (a regard write). */
  node_regard?: (vfsPath: string) => void;
  /** A feed came into view: the layout should summon this pane. */
  feed_shown?: () => void;
}

/** Feed-id extraction from a working directory. */
const CWD_FEED_PATTERNS: readonly RegExp[] = [
  /\/proc\/jobs\/feed_(\d+)(?:\/|$)/,
  /\/feeds?\/feed_(\d+)(?:\/|$)/,
];

/** Progress statuses mapped onto the DAG vocabulary. */
const PROGRESS_STATUS_MAP: Readonly<Record<string, string>> = {
  running: 'started',
  done: 'finishedSuccessfully',
  error: 'finishedWithError',
};

/**
 * The DAG pane controller.
 */
export class DagPanel {
  private readonly scene: DagScene;
  private readonly canvas: HTMLElement;
  private readonly title: HTMLElement;
  private readonly facts: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly strategyPill: HTMLElement;
  private readonly feedList: HTMLElement;
  private readonly handlers: DagPanelHandlers;
  private shownFeedId: number | null = null;
  private pinnedFeedId: number | null = null;
  private requestedFeedId: number | null = null;
  private readonly defaultTitle: string;
  /** What scales a molecule node: execution wall time, or output bytes. */
  private metricMode: 'time' | 'size' = 'time';
  /** The last shown model, re-projected locally when the scale flips. */
  private lastModel: FeedDagModel | null = null;
  /** The roster last shown, re-rendered on any order change. */
  private lastRoster: FeedListEntry[] = [];
  /** Per-column sort + filter over the resident roster. */
  private readonly order: RosterOrder<FeedListEntry>;
  /** The title bar's state span (FILTERED n/m). */
  private readonly stateSpan: HTMLElement | null;

  /**
   * @param canvas - The element the scene renders into.
   * @param title - The pane header's title element.
   * @param facts - The selection facts chip.
   * @param empty - The empty-state element.
   * @param strategyPill - The ranked/molecule toggle pill.
   * @param handlers - Host callbacks.
   */
  constructor(
    canvas: HTMLElement,
    title: HTMLElement,
    facts: HTMLElement,
    empty: HTMLElement,
    strategyPill: HTMLElement,
    feedList: HTMLElement,
    handlers: DagPanelHandlers,
  ) {
    this.feedList = feedList;
    this.canvas = canvas;
    // No graph yet, no canvas: an empty scene above the chooser or the
    // empty-state hint is dead space. First arrival shows it.
    canvas.style.display = 'none';
    this.title = title;
    this.defaultTitle = title.textContent ?? '';
    this.facts = facts;
    this.empty = empty;
    this.strategyPill = strategyPill;
    this.handlers = handlers;
    this.order = new RosterOrder<FeedListEntry>(
      [
        { key: 'id', label: 'ID' },
        { key: 'title', label: 'TITLE' },
        { key: 'status', label: 'STATUS' },
        { key: 'owner', label: 'OWNER' },
        { key: 'createdAt', label: 'CREATED' },
      ],
      (row: FeedListEntry, key: string): string | number =>
        key === 'id' ? row.id : key === 'title' ? row.title : key === 'status' ? row.status : key === 'owner' ? row.owner : row.createdAt,
      (): void => { if (this.lastRoster.length > 0) this.chooser_show(this.lastRoster); },
      { key: 'createdAt', dir: 'desc' },
    );
    const paneRootEl: HTMLElement | null = strategyPill.closest<HTMLElement>('.pane-dag');
    this.stateSpan = paneRootEl?.querySelector<HTMLElement>('.pane-state') ?? null;
    paneRootEl?.addEventListener('argus:roster', (event: Event): void => {
      const detail = (event as CustomEvent<{ op: 'sort'; key: string; dir?: 'asc' | 'desc' } | { op: 'filter'; text: string }>).detail;
      if (detail.op === 'sort') this.order.sort_set(detail.key, detail.dir ?? 'asc');
      else if (detail.text === '') this.order.strip_toggle(false);
      else this.order.filter_set(detail.text);
    });
    this.scene = new DagScene(canvas, {
      select: (node: SceneNode): void => this.facts_show(node),
      activate: (node: SceneNode): void => this.node_activate(node),
      deselect: (): void => this.facts.replaceChildren(),
    });
    strategyPill.addEventListener('click', (): void => {
      const next: LayoutStrategy = this.scene.strategy_get() === 'ranked' ? 'molecule' : 'ranked';
      this.scene.strategy_set(next);
      strategyPill.textContent = next.toUpperCase();
    });
    // The projection pill lives beside the strategy pill on the rail; the
    // label always names the CURRENT mode, same as RANKED/MOLECULE.
    const projectionPill: HTMLElement | null =
      strategyPill.parentElement?.querySelector<HTMLElement>('.dag-projection') ?? null;
    projectionPill?.addEventListener('click', (): void => {
      const next: '3d' | '2d' = this.scene.projection_get() === '3d' ? '2d' : '3d';
      this.scene.projection_set(next);
      projectionPill.textContent = next.toUpperCase();
    });
    // PULSE is a MODE, not a one-shot: the pill shows the current state
    // (rail convention) and carries its weight — lit when looping, dim
    // when quiet. The one arrival-wave on graph load stays canon.
    const pulsePill: HTMLElement | null =
      strategyPill.parentElement?.querySelector<HTMLElement>('.dag-pulse') ?? null;
    pulsePill?.classList.add('rail-off');
    pulsePill?.addEventListener('click', (): void => {
      const on: boolean = !this.scene.waveLoop_get();
      this.scene.waveLoop_set(on);
      pulsePill.textContent = on ? 'PULSE ON' : 'PULSE OFF';
      pulsePill.classList.toggle('rail-off', !on);
    });
    // SCALE is a display-content control: it re-projects the remembered
    // model locally — no wire traffic, the metrics are already resident.
    const scalePill: HTMLElement | null =
      strategyPill.parentElement?.querySelector<HTMLElement>('.dag-scale') ?? null;
    scalePill?.addEventListener('click', (): void => {
      this.metricMode = this.metricMode === 'time' ? 'size' : 'time';
      scalePill.textContent = this.metricMode === 'time' ? 'TIME' : 'SIZE';
      if (this.lastModel !== null) this.graph_show(this.lastModel, false);
    });
    this.scalePill = scalePill;
    // CENSUS is spectacle: the full multiplicity, instanced. SHAPE is the
    // semantic default; selection and facts belong to shape.
    const censusPill: HTMLElement | null =
      strategyPill.parentElement?.querySelector<HTMLElement>('.dag-census') ?? null;
    censusPill?.addEventListener('click', (): void => {
      const on: boolean = !this.scene.census_get();
      this.scene.census_set(on);
      censusPill.textContent = on ? 'CENSUS' : 'SHAPE';
    });
    // GRAVITY is a meaning (heaviest stage at the heart), so it earns a
    // pill; the other physics terms are expert knobs and live in LANG.
    const gravityPill: HTMLElement | null =
      strategyPill.parentElement?.querySelector<HTMLElement>('.dag-gravity') ?? null;
    gravityPill?.classList.add('rail-off');
    gravityPill?.addEventListener('click', (): void => {
      const on: boolean = !this.scene.physics_get().gravity;
      this.scene.physics_set({ gravity: on });
      gravityPill.textContent = on ? 'GRAVITY ON' : 'GRAVITY OFF';
      gravityPill.classList.toggle('rail-off', !on);
    });
    // The language reaches the expert knobs through DOM events on the pane
    // (verbs run over the DOM, never a private API).
    const paneRoot: HTMLElement | null = strategyPill.closest<HTMLElement>('.pane-dag');
    paneRoot?.addEventListener('argus:dag-physics', (event: Event): void => {
      const detail = (event as CustomEvent<{ term: string; on: boolean } | 'reset'>).detail;
      if (detail === 'reset') {
        this.scene.physics_set({ charge: true, link: true, collide: true });
        return;
      }
      if (detail.term === 'gravity') {
        if (this.scene.physics_get().gravity !== detail.on) gravityPill?.click();
        return;
      }
      this.scene.physics_set({ [detail.term]: detail.on } as Partial<PhysicsTerms>);
    });
    // The THEME pill re-seats the palette on the root element; follow it.
    new MutationObserver((): void => this.scene.palette_refresh()).observe(
      document.documentElement,
      { attributes: true, attributeFilter: ['data-lcars'] },
    );
    window.addEventListener('resize', (): void => this.scene.size_fit());
    // A zoom glide resizes the canvas without a window resize; refit once
    // the transition has settled.
    new MutationObserver((): void => {
      window.setTimeout((): void => this.scene.size_fit(), 600);
    }).observe(document.body, { attributes: true, attributeFilter: ['data-zoom'] });
  }

  /**
   * Observes every session envelope; a `feed.dag` model repaints the pane.
   * An explicit invocation (any feed.dag arrival not requested by the pane
   * itself) pins the feed.
   *
   * @param envelope - Any envelope crossing the session.
   */
  public envelope_observe(envelope: WireEnvelope): void {
    if (envelope.model?.kind === FEED_LIST_MODEL_KIND) {
      this.rosterPending = false;
      const roster = feedListModelSchema.safeParse(envelope.model.data);
      if (roster.success) {
        this.chooser_show(roster.data.feeds);
      }
      return;
    }
    if (this.rosterPending && envelope.status === 'error') {
      // The roster request was refused (the warmup guard declines global
      // queries over a half-built index). A loading row that outlives its
      // request is a lie: show the refusal, and let the prompt context
      // keep the warming figure honest below it.
      this.rosterPending = false;
      this.rosterRefusal_show(envelope);
      return;
    }
    if (envelope.model?.kind !== DAG_MODEL_KINDS.feedDag) {
      return;
    }
    const parsed = feedDagModelSchema.safeParse(envelope.model.data);
    if (!parsed.success) {
      return;
    }
    const model: FeedDagModel = parsed.data;
    if (this.requestedFeedId === model.feedId) {
      this.requestedFeedId = null;
    } else {
      // The operator asked for this one by hand: pin it.
      this.pinnedFeedId = model.feedId;
    }
    this.shownFeedId = model.feedId;
    this.title.textContent = `DAG · FEED ${model.feedId} — ${model.feedName}`.toUpperCase();
    this.empty.style.display = 'none';
    // A graph arrival always takes the whole pane: selecting a feed IS
    // entering it. (The half-pane "preview above the list" is gone; live
    // scrubbing returns when a context split exists to receive it.)
    this.feedList.style.display = 'none';
    this.canvas.style.display = 'block';
    if (this.lastModel !== null && this.lastModel.feedId !== model.feedId) {
      // A different feed owes nothing to the old one: stale selection facts
      // must not haunt the new graph.
      this.facts.replaceChildren();
      this.scene.selection_clear();
    }
    this.lastModel = model;
    this.graph_show(model);
    this.handlers.feed_shown?.();
  }

  /** The scale pill, dimmed when the feed carries no data for its mode. */
  private scalePill: HTMLElement | null = null;

  /** Renders a model into the scene under the current metric mode. */
  private graph_show(model: FeedDagModel, wave: boolean = true): void {
    const metric_of = (node: FeedDagNode): number | undefined =>
      this.metricMode === 'time' ? node.metrics?.computeSeconds : node.metrics?.dataBytes;
    // Honesty on the pill itself: a mode with no data behind it dims and
    // says so, instead of silently rendering an unchanged graph.
    const hasData: boolean = model.nodes.some((node: FeedDagNode): boolean => metric_of(node) !== undefined);
    this.scalePill?.classList.toggle('rail-na', !hasData);
    if (this.scalePill !== null) {
      this.scalePill.title = hasData
        ? 'molecule node size: wall time or output bytes'
        : `no ${this.metricMode === 'time' ? 'wall-time' : 'output-size'} data in this feed's cache yet`;
    }
    this.scene.graph_set({
      nodes: model.nodes.map((node: FeedDagNode): SceneNode => ({
        id: node.id,
        label: node.label,
        parentIds: node.parentIds,
        joinParentIds: node.joinParentIds,
        status: node.status,
        metric: metric_of(node),
        count: node.tally?.count,
      })),
    }, { wave });
    this.scene.size_fit();
    this.factsPayloads.clear();
    for (const node of model.nodes) {
      this.factsPayloads.set(node.id, node);
    }
  }

  /** Node facts, kept for the selection chip. */
  private readonly factsPayloads: Map<string, FeedDagNode> = new Map();

  /**
   * Follows the working directory: entering a different feed's tree
   * refreshes the pane (and releases a pin on a feed left behind).
   *
   * @param context - The pushed prompt context.
   */
  public promptContext_observe(context: PromptContext): void {
    if (this.rosterProgress !== null && this.rosterProgress.isConnected) {
      const warm = context.procWarmup;
      if (warm?.total !== undefined && warm.total > 0) {
        const percent: number = Math.floor((warm.loaded / warm.total) * 100);
        this.rosterProgress.textContent =
          `INDEX WARMING \u2014 ${warm.loaded}/${warm.total} (${percent}%). The roster opens when the index is whole.`;
      }
      if (warm === undefined || warm.state === 'cached') {
        // The index came whole: ask again on the operator's behalf.
        this.rosterProgress = null;
        this.feedsChooser_request();
      }
    }
    // An offstage pane must not queue diagram traffic: following the cwd
    // while nobody can see the graph is pure session-queue congestion (and
    // exactly the kind of delay RUNS-02 then sits behind).
    if (!this.canvas.isConnected) {
      return;
    }
    const feedId: number | null = cwdFeed_find(context.cwd);
    if (feedId === null) {
      return;
    }
    if (feedId === this.shownFeedId) {
      return;
    }
    if (this.pinnedFeedId !== null && feedId === this.pinnedFeedId) {
      return;
    }
    // A different feed underfoot re-follows, ending any pin.
    this.pinnedFeedId = null;
    this.requestedFeedId = feedId;
    this.handlers.command_run(`feed diagram feed_${feedId}`);
  }

  /**
   * Recolors a node when the progress channel reports its job moving.
   *
   * @param message - A typed progress message.
   */
  public progress_observe(message: ProgressMessage): void {
    if (message.itemId === undefined) {
      return;
    }
    const status: string | undefined =
      message.status !== undefined ? PROGRESS_STATUS_MAP[message.status] : undefined;
    if (status !== undefined) {
      this.scene.status_update(String(message.itemId), status);
    }
  }

  /** Refits the scene after a zoom transition settles. */
  public size_fit(): void {
    this.scene.size_fit();
  }

  /** Releases the pane's scene (a disposed instance). */
  public dispose(): void {
    this.scene.dispose();
  }

  /** Enters a feed by id: pins it and fetches its graph (the textual verb). */
  public feed_enter(feedId: number): void {
    this.pinnedFeedId = feedId;
    this.requestedFeedId = null;
    this.handlers.command_run(`feed diagram feed_${feedId}`);
  }

  /** Asks for the cache-resident feed roster (the RUNS-02 gesture). */
  public feedsChooser_request(): void {
    // The roster itself is cache-resident, but the request waits in the
    // session queue behind whatever is executing — honesty demands the wait
    // be visible from the first frame.
    const loading: HTMLDivElement = document.createElement('div');
    loading.className = 'feedlist-loading';
    loading.textContent = 'RETRIEVING FEED ROSTER…';
    this.feedList.replaceChildren(loading);
    this.feedList.style.display = 'block';
    this.rosterPending = true;
    this.handlers.command_run('proc feeds');
  }

  /** An unanswered roster request, awaiting its envelope. */
  private rosterPending: boolean = false;

  /** The live progress line of a refused roster, fed by the prompt. */
  private rosterProgress: HTMLElement | null = null;

  /**
   * Paints the roster refusal in place of the loading row: the daemon's
   * own reason, with a live warming figure beneath it.
   *
   * @param envelope - The error envelope that answered `proc feeds`.
   */
  private rosterRefusal_show(envelope: WireEnvelope): void {
    const raw: string = (envelope.renderedErr || envelope.rendered || '').replace(
      // eslint-disable-next-line no-control-regex
      /\u001b\[[0-9;]*m/g,
      '',
    );
    const reason: string =
      raw.split('\n').find((line: string): boolean => line.trim().length > 0)?.trim() ??
      'the roster request was refused';
    const refusal: HTMLDivElement = document.createElement('div');
    refusal.className = 'feedlist-refusal';
    refusal.textContent = reason;
    const progress: HTMLDivElement = document.createElement('div');
    progress.className = 'feedlist-warming';
    progress.textContent = 'INDEX WARMING\u2026 the roster opens when the index is whole.';
    this.feedList.replaceChildren(refusal, progress);
    this.feedList.style.display = 'block';
    this.rosterProgress = progress;
  }

  /**
   * Declares the list level: RUNS-02 always lands on the feed roster and
   * nothing else. A graph retained from an earlier visit would be a ghost
   * render above the list, so the canvas hides and any pin releases; the
   * shown-feed memory survives so the cwd follow does not immediately
   * repaint what was just dismissed.
   */
  public list_reset(): void {
    this.facts.replaceChildren();
    this.scene.selection_clear();
    this.canvas.style.display = 'none';
    this.pinnedFeedId = null;
    this.requestedFeedId = null;
    this.title.textContent = this.defaultTitle;
    // The empty-state hint ("no feed in view — press RUNS-02...") is for a
    // pane that arrived with nothing to say; RUNS-02 itself is the answer to
    // that hint, so flashing it here before the roster lands is nonsense.
    this.empty.style.display = 'none';
  }

  /**
   * Pops one navigation level: a shown graph (entered or previewed) steps
   * back to the feed list. Scrubbing the list is one level however many
   * previews it painted — the pop clears whatever graph is up and restores
   * the pure list.
   *
   * @returns True when a level was popped; false when the pane is already
   * at its list (or never had one), letting Esc fall through.
   */
  public nav_pop(): boolean {
    if (this.canvas.style.display === 'none') {
      return false;
    }
    if (this.feedList.childElementCount === 0) {
      // No roster was ever shown: this pane arrived by cwd-follow, and
      // there is no list level beneath it to return to.
      return false;
    }
    this.canvas.style.display = 'none';
    this.pinnedFeedId = null;
    this.requestedFeedId = null;
    this.title.textContent = this.defaultTitle;
    this.facts.replaceChildren();
    this.scene.selection_clear();
    this.feedList.style.display = 'block';
    return true;
  }

  /**
   * Shows the titled feed chooser over the pane; picking one loads its DAG.
   *
   * @param feeds - The roster, newest first.
   */
  private chooser_show(feeds: FeedListEntry[]): void {
    this.lastRoster = feeds;
    this.empty.style.display = 'none';
    this.order.host_prepare(this.feedList);
    for (const feed of this.order.apply(feeds)) {
      const row: HTMLDivElement = document.createElement('div');
      row.className = `feedlist-row feedlist-${feed.status}`;
      const idBadge: HTMLSpanElement = document.createElement('span');
      idBadge.className = 'feedlist-id';
      idBadge.textContent = String(feed.id);
      const name: HTMLSpanElement = document.createElement('span');
      name.className = 'feedlist-title';
      name.textContent = feed.title || '(untitled)';
      const status: HTMLSpanElement = document.createElement('span');
      status.className = 'feedlist-status';
      status.textContent = feed.status.toUpperCase();
      const owner: HTMLSpanElement = document.createElement('span');
      owner.className = 'feedlist-owner';
      owner.textContent = feed.owner;
      const created: HTMLSpanElement = document.createElement('span');
      created.className = 'feedlist-created';
      created.textContent = feed.createdAt.slice(0, 10);
      row.append(idBadge, name, status, owner, created);
      row.title = 'enter the feed (Esc returns to this list)';
      // Selecting a feed enters it: the full graph takes the pane and the
      // list steps aside. Esc (contextual back) returns here.
      row.addEventListener('click', (): void => {
        this.pinnedFeedId = feed.id;
        this.requestedFeedId = null;
        this.handlers.command_run(`feed diagram feed_${feed.id}`);
      });
      this.feedList.appendChild(row);
    }
    this.feedList.style.display = 'block';
    if (this.stateSpan !== null) this.stateSpan.textContent = this.order.summary();
  }

  /** Shows or hides the roster filter strip (the drawer's FILTER, or `runs filter`). */
  public filter_toggle(open?: boolean): void {
    this.order.strip_toggle(open);
  }

  /** Paints the selection facts chip. */
  private facts_show(node: SceneNode): void {
    const payload: FeedDagNode | undefined = this.factsPayloads.get(node.id);
    if (!payload) {
      this.facts.textContent = node.label;
      return;
    }
    // A selection is an indication: the node's data address becomes the
    // pane's regard, feeding any slaved viewer in its group.
    this.handlers.node_regard?.(payload.vfsPath);
    this.facts.replaceChildren();
    const settled: boolean =
      payload.status === 'finishedSuccessfully' ||
      payload.status === 'finishedWithError' ||
      payload.status === 'cancelled';
    // Metrics ride the warmed ProcCache; a settled node without them has
    // simply not been backfilled yet.
    const pending: string = settled ? 'awaiting warmup' : 'in flight';
    const tally = payload.tally;
    const rows: Array<[string, string]> = [
      ['PLUGIN', payload.pluginName],
      [tally ? 'REP. INSTANCE' : 'INSTANCE', String(payload.instanceId)],
      ['STATUS', payload.status],
      ...(tally
        ? ([[
            'COUNT',
            `×${tally.count} — ${tally.done} done, ${tally.error} err, ${tally.running} live, ${tally.other} other`,
          ]] as Array<[string, string]>)
        : []),
      ...(tally?.anomalies !== undefined && tally.anomalies.length > 0
        ? ([[
            'FAULTS',
            tally.anomalies.map((a): string => a.id).join(' ') + (tally.count > tally.done + tally.anomalies.length ? ' …' : ''),
          ]] as Array<[string, string]>)
        : []),
      [
        'WALL',
        payload.metrics?.computeSeconds !== undefined
          ? duration_format(payload.metrics.computeSeconds)
          : pending,
      ],
      [
        'SIZE',
        payload.metrics?.dataBytes !== undefined
          ? size_format(payload.metrics.dataBytes)
          : pending,
      ],
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
      this.facts.appendChild(row);
    }
    this.facts.appendChild(subway_build(payload.status));
  }

  /** Activation: fly into the node — literally when the host can overlay. */
  private node_activate(node: SceneNode): void {
    const payload: FeedDagNode | undefined = this.factsPayloads.get(node.id);
    if (!payload) {
      return;
    }
    if (this.handlers.node_dive !== undefined) {
      const dive: (vfsPath: string) => void = this.handlers.node_dive;
      this.scene.flight_into(node.id, (): void => dive(payload.vfsPath));
    } else {
      this.handlers.node_enter(payload.vfsPath);
    }
  }

  /** Clears the node detail (selection + facts chip) — the drawer's CLEAR DETAIL. */
  public detail_clear(): void {
    this.scene.selection_clear();
    this.facts.replaceChildren();
  }

  /** Fires one pulse wave: dependency-order replay, honest to history. */
  public wave_start(): void {
    this.scene.wave_start();
  }

  /**
   * Flies the camera back out of a node once its overlay has closed.
   *
   * @param onDone - Called when the camera is home.
   */
  public flight_back(onDone: () => void): void {
    this.scene.flight_back(onDone);
  }

  /**
   * Flies into the node hosting the given plugin instance — the immersive
   * hop: clicking a descendant instance inside a node is graph navigation,
   * not directory descent. Call after the current overlay's `flight_back`
   * has landed.
   *
   * @param instanceID - The CUBE plugin-instance id to dive into.
   * @returns True when the instance is a node of the shown graph.
   */
  public node_flyTo(instanceID: number): boolean {
    for (const [sceneId, node] of this.factsPayloads) {
      if (node.instanceId !== instanceID) continue;
      if (this.handlers.node_dive === undefined) return false;
      const dive: (vfsPath: string) => void = this.handlers.node_dive;
      this.facts_show({ id: sceneId, label: node.label, parentIds: [], joinParentIds: [] });
      this.scene.flight_into(sceneId, (): void => dive(node.vfsPath));
      return true;
    }
    return false;
  }
}

/**
 * Formats a wall-clock duration for the facts chip.
 *
 * @param seconds - The duration in seconds.
 * @returns The human form (e.g. `42s`, `4m 12s`, `2h 05m`).
 */
function duration_format(seconds: number): string {
  const whole: number = Math.round(seconds);
  if (whole < 60) {
    return `${whole}s`;
  }
  if (whole < 3600) {
    return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
  }
  return `${Math.floor(whole / 3600)}h ${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}m`;
}

/**
 * Formats a byte count for the facts chip, compactly.
 *
 * @param bytes - The size in bytes.
 * @returns The human form (e.g. `2.4K`, `13M`).
 */
function size_format(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  const units: string[] = ['K', 'M', 'G', 'T'];
  let value: number = bytes;
  let unitIndex: number = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value = value / 1024;
    unitIndex = unitIndex + 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}${units[unitIndex]}`;
}

/** The job lifecycle, in order — the subway line a node rides. */
const SUBWAY_STAGES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'created', label: 'created' },
  { key: 'waiting', label: 'waiting' },
  { key: 'scheduled', label: 'scheduled' },
  { key: 'started', label: 'started' },
  { key: 'registeringFiles', label: 'registering' },
];

/**
 * Builds the subway strip: the node's lifecycle as stops on a line, filled
 * to where the job actually is — the classic ChRIS UI progression carried
 * over. A happy terminal fills the whole line; an error or cancellation
 * ends the line at a red terminal stop.
 *
 * @param status - The node's current CUBE status.
 * @returns The strip element.
 */
function subway_build(status: string): HTMLElement {
  const strip: HTMLDivElement = document.createElement('div');
  strip.className = 'dag-subway';
  const doneAll: boolean = status === 'finishedSuccessfully';
  const failed: boolean = status === 'finishedWithError' || status === 'cancelled';
  const at: number = SUBWAY_STAGES.findIndex((stage): boolean => stage.key === status);
  const reached: number = doneAll || failed ? SUBWAY_STAGES.length : at;
  SUBWAY_STAGES.forEach((stage, index): void => {
    if (index > 0) {
      const link: HTMLSpanElement = document.createElement('span');
      link.className = 'subway-link' + (index <= reached ? ' subway-passed' : '');
      strip.appendChild(link);
    }
    const stop: HTMLSpanElement = document.createElement('span');
    stop.className =
      'subway-stop' +
      (index < reached ? ' subway-passed' : '') +
      (index === at && !doneAll && !failed ? ' subway-here' : '');
    stop.title = stage.label;
    strip.appendChild(stop);
  });
  const lastLink: HTMLSpanElement = document.createElement('span');
  lastLink.className = 'subway-link' + (doneAll || failed ? ' subway-passed' : '');
  strip.appendChild(lastLink);
  const terminal: HTMLSpanElement = document.createElement('span');
  terminal.className =
    'subway-stop subway-terminal' +
    (doneAll ? ' subway-done' : '') +
    (failed ? ' subway-failed' : '');
  terminal.title = doneAll ? 'finished' : failed ? status : 'pending';
  strip.appendChild(terminal);
  return strip;
}

/**
 * Extracts a feed id from a working directory, wherever a feed's tree is
 * mounted in the VFS.
 *
 * @param cwd - The session's working directory.
 * @returns The feed id, or null when the cwd is outside any feed.
 */
export function cwdFeed_find(cwd: string): number | null {
  for (const pattern of CWD_FEED_PATTERNS) {
    const match: RegExpMatchArray | null = cwd.match(pattern);
    if (match?.[1] !== undefined) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}
