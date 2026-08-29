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
import { DagScene, type LayoutStrategy, type SceneNode } from '../../scene/dagScene.js';
import type { ProgressMessage } from '../../calypso/client.js';

/** What the pane asks of its host. */
export interface DagPanelHandlers {
  /** Runs a session command silently (instrument traffic, not transcript). */
  command_run: (line: string) => void;
  /** Lowers a node activation to a visible cd. */
  node_enter: (vfsPath: string) => void;
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
  private readonly title: HTMLElement;
  private readonly facts: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly strategyPill: HTMLElement;
  private readonly feedList: HTMLElement;
  private readonly handlers: DagPanelHandlers;
  private shownFeedId: number | null = null;
  private pinnedFeedId: number | null = null;
  private requestedFeedId: number | null = null;

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
    this.title = title;
    this.facts = facts;
    this.empty = empty;
    this.strategyPill = strategyPill;
    this.handlers = handlers;
    this.scene = new DagScene(canvas, {
      select: (node: SceneNode): void => this.facts_show(node),
      activate: (node: SceneNode): void => this.node_activate(node),
    });
    strategyPill.addEventListener('click', (): void => {
      const next: LayoutStrategy = this.scene.strategy_get() === 'ranked' ? 'molecule' : 'ranked';
      this.scene.strategy_set(next);
      strategyPill.textContent = next.toUpperCase();
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
      const roster = feedListModelSchema.safeParse(envelope.model.data);
      if (roster.success) {
        this.chooser_show(roster.data.feeds);
      }
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
    this.feedList.style.display = 'none';
    this.scene.graph_set({
      nodes: model.nodes.map((node: FeedDagNode): SceneNode => ({
        id: node.id,
        label: node.label,
        parentIds: node.parentIds,
        joinParentIds: node.joinParentIds,
        status: node.status,
        metric: node.metrics?.computeSeconds ?? node.metrics?.dataBytes,
      })),
    });
    this.scene.size_fit();
    this.handlers.feed_shown?.();
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

  /** Asks for the cache-resident feed roster (the RUNS-02 gesture). */
  public feedsChooser_request(): void {
    this.handlers.command_run('proc feeds');
  }

  /**
   * Shows the titled feed chooser over the pane; picking one loads its DAG.
   *
   * @param feeds - The roster, newest first.
   */
  private chooser_show(feeds: FeedListEntry[]): void {
    this.empty.style.display = 'none';
    this.feedList.replaceChildren();
    for (const feed of feeds) {
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
      row.append(idBadge, name, status, owner);
      row.addEventListener('click', (): void => {
        this.handlers.command_run(`feed diagram feed_${feed.id}`);
        // The arrival will hide the list; pin, since this was an explicit pick.
        this.pinnedFeedId = feed.id;
        this.requestedFeedId = null;
      });
      this.feedList.appendChild(row);
    }
    this.feedList.style.display = 'block';
  }

  /** Paints the selection facts chip. */
  private facts_show(node: SceneNode): void {
    const payload: FeedDagNode | undefined = this.factsPayloads.get(node.id);
    if (!payload) {
      this.facts.textContent = node.label;
      return;
    }
    this.facts.replaceChildren();
    const rows: Array<[string, string]> = [
      ['PLUGIN', payload.pluginName],
      ['INSTANCE', String(payload.instanceId)],
      ['STATUS', payload.status],
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
  }

  /** Activation: fly into the node's data space by navigating to it. */
  private node_activate(node: SceneNode): void {
    const payload: FeedDagNode | undefined = this.factsPayloads.get(node.id);
    if (payload) {
      this.handlers.node_enter(payload.vfsPath);
    }
  }
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
