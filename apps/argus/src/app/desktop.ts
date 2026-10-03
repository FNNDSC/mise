/**
 * @file A desktop: the stage captured as a script of console lines that
 * reproduces it, and that script replayed. A domain switch captures the
 * outgoing stage as a PANES card; a card pressed replays its actions, each
 * open launched FROM the pane a prior action produced, and lays the
 * recorded tiling over the panes that came back.
 *
 * The host hands in its open verbs as hooks (an image, a directory, a
 * catalogue, a cohort, a graph, a drawer-pill pane); this module keeps the
 * births, the replay place the opens read, and the capture and the replay.
 */
import type { GatherFeed, GatherSeries } from '../features/gather/panel.js';
import type { DesktopAction, DesktopShape, GroupSnapshot } from './dormant.js';
import type { HostContext } from './hostContext.js';
import type { LayoutNode } from './layout.js';
import { pane_isPrimary, paneInstance_dispose, paneInstances_list, type PaneKind } from './panes.js';
import { place_of } from './sides.js';

/** What PROCESS was pressed on, and where a run lands: a catalogue pane's binding. */
export interface CatalogueBinding {
  input: string;
  feed: number | null;
  node: number | null;
}

/** The split a pane was born with: the pane it split FROM, the orientation, the side, and the drawer binding if a pill made it. */
export interface PaneBirth {
  parent: string;
  dir: 'row' | 'col';
  before: boolean;
  binding?: string;
}

/** The split a replayed open must use: the captured orientation and side. */
export interface ReplayPlace {
  dir: 'row' | 'col';
  before: boolean;
}

/** The host's open verbs, as a replay drives them. */
export interface DesktopHooks {
  image_open: (fromId: string | null, path: string, options: { force?: boolean }, onOpen?: (id: string) => void) => Promise<string>;
  /** Opens a file in an EDIT pane, the pane first; its id, or null when none could stand. */
  edit_open: (path: string) => string | null;
  dir_open: (folderPath: string) => void;
  process_open: (fromId: string, binding: CatalogueBinding) => void;
  gather_open: (entries: ReadonlyArray<GatherSeries>, host: string) => string | null;
  feed_open: (fromId: string, feedId: number) => void;
  pillPane_spawn: (parentId: string, binding: 'view' | 'fs' | 'empty', dir: 'row' | 'col', before: boolean) => string | null;
  /** The PACS query on stage, for a PACS domain's capture; null when none. */
  pacsQuery_get: () => string | null;
  /** A catalogue pane's binding, when the pane is one. */
  catalogue_of: (paneId: string) => CatalogueBinding | undefined;
  /** Every catalogue pane's id. */
  catalogueIds: () => string[];
  /** The PACS rows' verbs re-lit after the stage changed. */
  stage_relight: () => void;
}

/** The desktop verbs a wired host has. */
export interface Desktop {
  /** Records how a pane was born, for the capture and the replay. */
  birth_record: (childId: string, parent: string, dir: 'row' | 'col', before: boolean, binding?: string) => void;
  /** The split a replayed open must use; null in normal use (the column-after default). */
  replayPlace_get: () => ReplayPlace | null;
  /** Whether a replay is in flight; capture is suppressed during it. */
  replaying: () => boolean;
  /** A strip of the whole stage, as a card's figure. */
  strip_capture: (stageIds: readonly string[]) => string | undefined;
  /** Captures the stage as a desktop card, when it holds content. */
  capture: () => void;
  /** Disposes split-born instances the tree no longer holds. */
  orphans_dispose: () => void;
  /** Enters a gutter domain: capture, preset, sweep. */
  domain_enter: (preset: string) => void;
  /** Brings a dormant group back onto the stage. */
  restore: (id: string) => Promise<void>;
}

/** The members a card badges, by the action that opened each. */
const MEMBER_OF: Readonly<Record<string, string>> = { image: 'viewer', view: 'viewer', dir: 'files', fs: 'files', tags: 'tags', empty: 'pane', domain: 'dag', catalogue: 'catalogue', graph: 'dag', gather: 'gather', edit: 'editor' };

/** The width of a card's strip, in pixels. */
const STRIP_WIDTH_PX: number = 240;

/**
 * Wires the desktop to a host.
 *
 * @param context - The layout, the panels, the pane instances, the dormant groups and the terminal.
 * @param hooks - The host's open verbs.
 * @returns The desktop verbs.
 */
export function desktop_wire(context: Pick<HostContext, 'layout' | 'panels' | 'paneInstance_get' | 'dormant' | 'terminal'>, hooks: DesktopHooks): Desktop {
  const { layout, panels, paneInstance_get, dormant } = context;
  const births: Map<string, PaneBirth> = new Map();
  let replaying: boolean = false;
  let replayPlace: ReplayPlace | null = null;
  const paneKind_get = (id: string): PaneKind | null => paneInstance_get(id)?.kind ?? null;

  const birth_record = (childId: string, parent: string, dir: 'row' | 'col', before: boolean, binding?: string): void => {
    births.set(childId, { parent, dir, before, ...(binding !== undefined ? { binding } : {}) });
  };

  /** A glyph standing in for a pane whose surface is not a raster (a listing, tags). */
  const kindGlyph_of = (id: string): string => {
    if (id === 'pacs') return '⊞';
    if (id === 'dag') return '⋔';
    const kind: string | null = paneKind_get(id);
    if (kind === 'image') return '▣';
    if (kind === 'tags') return '≣';
    if (kind === 'edit') return '✎';
    return '▤';
  };

  /**
   * A strip of the whole stage: each shown pane drawn as a tile at its real
   * position and size, scaled into the figure — a raster where a pane has a
   * canvas, a glyph tile where it does not — so a desktop reads as the
   * arrangement it is (PACS | DIR | viewer), not as one lone viewer.
   */
  const strip_capture = (stageIds: readonly string[]): string | undefined => {
    if (stageIds.length === 0) return undefined;
    const rects: { id: string; left: number; top: number; width: number; height: number }[] = [];
    for (const id of stageIds) {
      const mount = paneInstance_get(id)?.mount;
      if (mount === undefined) continue;
      const box: DOMRect = mount.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) rects.push({ id, left: box.left, top: box.top, width: box.width, height: box.height });
    }
    if (rects.length === 0) return undefined;
    const minLeft: number = Math.min(...rects.map((rect): number => rect.left));
    const minTop: number = Math.min(...rects.map((rect): number => rect.top));
    const spanW: number = Math.max(...rects.map((rect): number => rect.left + rect.width)) - minLeft;
    const spanH: number = Math.max(...rects.map((rect): number => rect.top + rect.height)) - minTop;
    if (spanW <= 0 || spanH <= 0) return undefined;
    const scale: number = STRIP_WIDTH_PX / spanW;
    const canvasH: number = Math.max(40, Math.min(260, Math.round(spanH * scale)));
    try {
      const off: HTMLCanvasElement = document.createElement('canvas');
      off.width = STRIP_WIDTH_PX;
      off.height = canvasH;
      const ctx: CanvasRenderingContext2D | null = off.getContext('2d');
      if (ctx === null) return undefined;
      const style: CSSStyleDeclaration = getComputedStyle(document.documentElement);
      const accent: string = style.getPropertyValue('--harvestgold').trim() || '#c9a15a';
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, STRIP_WIDTH_PX, canvasH);
      for (const rect of rects) {
        const tx: number = Math.round((rect.left - minLeft) * scale);
        const ty: number = Math.round((rect.top - minTop) * scale);
        const tw: number = Math.max(6, Math.round(rect.width * scale));
        const th: number = Math.max(6, Math.round(rect.height * scale));
        const canvas = paneInstance_get(rect.id)?.mount.querySelector<HTMLCanvasElement>('canvas');
        if (canvas !== null && canvas !== undefined && canvas.width > 0) {
          const fit: number = Math.min(tw / canvas.width, th / canvas.height);
          const dw: number = Math.round(canvas.width * fit);
          const dh: number = Math.round(canvas.height * fit);
          ctx.fillStyle = '#000';
          ctx.fillRect(tx, ty, tw, th);
          ctx.drawImage(canvas, tx + Math.round((tw - dw) / 2), ty + Math.round((th - dh) / 2), dw, dh);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(tx, ty, tw, th);
          ctx.fillStyle = accent;
          ctx.font = `${Math.max(9, Math.min(28, Math.round(Math.min(tw, th) * 0.5)))}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(kindGlyph_of(rect.id), tx + tw / 2, ty + th / 2 + 1);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, th - 1);
      }
      return off.toDataURL('image/png');
    } catch {
      return undefined;
    }
  };

  /**
   * One pane's action for the capture, or null when the pane is not content
   * (a bare primary is the domain; a pane with nothing to show is skipped).
   * Returns the action and, when this pane names the card, its anchor and label.
   */
  const action_of = (id: string, preset: string, target: number): { action: DesktopAction; anchor?: string; label?: string } | null => {
    const kind: string | null = paneKind_get(id);
    const birth: PaneBirth | undefined = births.get(id);
    // The real split the pane was born with — a stacked or before-split pane
    // carries its own orientation and side, not the column-right default.
    const place = { dir: birth?.dir ?? 'col', side: place_of(birth?.before ?? false) };
    if (pane_isPrimary(id)) {
      const domain = (preset === 'dag' ? 'runs' : preset) as 'pacs' | 'files' | 'runs';
      const query: string | null = preset === 'pacs' ? hooks.pacsQuery_get() : null;
      // The runs domain with a graph on stage is content, as a PACS query
      // is: the feed, and the view the operator chose for it.
      const dagPanel = preset === 'dag' ? panels.get('dag', 'dag') : undefined;
      const feed: number | null = dagPanel !== undefined && dagPanel.graph_isShown() ? dagPanel.feed_get() : null;
      const dagView: string[] = feed !== null && dagPanel !== undefined ? dagPanel.view_lines() : [];
      const label: string | undefined = feed !== null ? dagPanel?.feedTitle_get() : undefined;
      return {
        action: { op: 'domain', domain, ...(query !== null ? { query } : {}), ...(feed !== null ? { feed } : {}), ...(dagView.length > 0 ? { view: dagView } : {}) },
        ...(label !== undefined ? { label } : {}),
      };
    }
    if (birth?.binding === 'fs' || birth?.binding === 'view' || birth?.binding === 'empty') {
      // A drawer SPLIT-pill pane replays as its own birth, whatever it holds.
      return { action: { op: birth.binding, target, ...place } };
    }
    if (kind === 'image') {
      const panel = panels.get('image', id);
      const state = panel?.state_get() ?? null;
      if (panel === undefined || state === null || state.path === null) return null;
      const view: string[] = [];
      if (state.layout !== 'single') view.push(`image layout ${state.layout}`);
      if (state.colormap !== undefined && state.colormap !== 'gray') view.push(`image colormap ${state.colormap}`);
      if (state.voi !== undefined && state.voi !== null) view.push(`image wl ${state.voi.lower} ${state.voi.upper}`);
      if (state.slice > 1) view.push(`image slice ${state.slice}`);
      if (state.ghost !== undefined && state.ghost !== null && state.layout === 'slab') view.push(`image ghost ${state.ghost}`);
      const series = panel.series_get();
      const parts: string[] = [series?.seriesDescription ?? '', series?.modality ?? ''].filter((part): boolean => part !== '');
      return {
        action: { op: 'image', path: state.path, target, ...place, ...(view.length > 0 ? { view } : {}) },
        anchor: state.path,
        ...(parts.length > 0 ? { label: parts.join(' · ') } : {}),
      };
    }
    const bound: CatalogueBinding | undefined = hooks.catalogue_of(id);
    if (bound !== undefined) {
      // A catalogue is a files pane by kind and a catalogue by its binding:
      // what PROCESS was pressed on, where a run lands, and the line RUN
      // would run, verbatim. Asked before the files branch, or it would be
      // logged as a browser at /bin.
      const line: string = panels.get('files', id)?.commandLine_get() ?? '';
      return {
        action: { op: 'catalogue', input: bound.input, target, ...place, ...(bound.feed !== null ? { feed: bound.feed } : {}), ...(bound.node !== null ? { node: bound.node } : {}), ...(line !== '' ? { line } : {}) },
        label: `PROCESS ${bound.input.split('/').filter(Boolean).pop() ?? bound.input}`,
      };
    }
    if (kind === 'files') {
      const path: string | null = panels.get('files', id)?.path_current() ?? null;
      if (typeof path !== 'string' || path.length === 0) return null;
      return { action: { op: 'dir', path, target, ...place } };
    }
    if (kind === 'gather') {
      // The cohort travels with the desktop: its series, and its name.
      const panel = panels.get('gather', id);
      if (panel === undefined) return null;
      const series: GatherSeries[] = [...panel.entries_get()];
      const name: string | null = panel.name_get();
      const made: GatherFeed | null = panel.feed_get();
      return {
        action: { op: 'gather', series, target, ...place, ...(name !== null ? { name } : {}), ...(made !== null ? { feed: made.feedId, root: { instance: made.rootInstanceId, path: made.path } } : {}) },
        label: name ?? `GATHER · ${series.length} series`,
      };
    }
    if (kind === 'dag') {
      // A run's graph beside its catalogue: the feed it graphs.
      const graphed: number | null = panels.get('dag', id)?.feed_get() ?? null;
      if (graphed === null) return null;
      return { action: { op: 'graph', feed: graphed, target, ...place } };
    }
    if (kind === 'tags') return { action: { op: 'tags', target, ...place } };
    if (kind === 'edit') {
      // An editor comes back on its file, read again: unsaved text is the
      // operator's to save before leaving, never carried in a card.
      const path: string | null = panels.get('edit', id)?.path_get() ?? null;
      if (path === null) return null;
      return { action: { op: 'edit', path, target, ...place }, label: `EDIT ${path.split('/').pop() ?? path}` };
    }
    return null;
  };

  /**
   * Captures the current stage as a DESKTOP: a script of console lines that
   * reproduces it when replayed — the domain, its content (a PACS query, a
   * viewer at its layout/slice/W-L/colormap/ghost, its tags), and, by replay,
   * the tiles as they were. A desktop is a replay of actions, not a pixel
   * snapshot. Keyed by the on-stage viewer's series so returning to the same
   * arrangement updates its one card; a viewer-less desktop is keyed by the
   * set of content it holds. A bare domain is one gutter press away and is
   * not carded; a domain with a feed on stage is content.
   */
  const capture = (): void => {
    if (replaying) return;
    const shown: Set<string> = new Set(layout.panes_shown());
    const preset: string = layout.activePreset_get();
    if (preset === 'panes' || preset === 'launcher') return;
    // Panes on stage in creation order (the registry's insertion order): the
    // domain primary is earliest (action 0), content follows as opened. Each
    // action records the pane it split FROM, as that pane's index in this
    // action log — which is what replay resolves against its produced table.
    const stageIds: string[] = paneInstances_list().map((instance): string => instance.id).filter((id): boolean => shown.has(id));
    const actionIndexOf: Map<string, number> = new Map<string, number>();
    let anchor: string | undefined;
    let label: string | undefined;
    const actions: DesktopAction[] = [];
    for (const id of stageIds) {
      const target: number = actionIndexOf.get(births.get(id)?.parent ?? '') ?? 0;
      const read = action_of(id, preset, target);
      if (read === null) continue;
      actionIndexOf.set(id, actions.length);
      actions.push(read.action);
      // The first viewer anchors the card and names it; another pane names
      // it only when nothing has yet.
      if (read.anchor !== undefined) {
        if (anchor === undefined) {
          anchor = read.anchor;
          if (read.label !== undefined) label = read.label;
        }
      } else if (read.label !== undefined && label === undefined) {
        label = read.label;
      }
    }
    const content = actions.filter((action): boolean => action.op !== 'domain' || action.feed !== undefined);
    if (content.length === 0) return;
    const thumbnail: string | undefined = strip_capture(stageIds);
    // The tiling as it stands, leaves as action indices: a pane moved after
    // its birth stands where it was moved to, which its birth cannot say.
    const shape_of = (node: LayoutNode): DesktopShape | null => {
      if ('pane' in node) {
        const index: number | undefined = actionIndexOf.get(node.pane);
        return index === undefined ? null : { leaf: index };
      }
      const first: DesktopShape | null = shape_of(node.first);
      const second: DesktopShape | null = shape_of(node.second);
      if (first === null) return second;
      if (second === null) return first;
      return { dir: node.dir, ratio: node.ratio, first, second };
    };
    const stageTree: LayoutNode | null = layout.tree_get();
    const shape: DesktopShape | null = stageTree === null ? null : shape_of(stageTree);
    const members: string[] = [...new Set(content.map((action): string => MEMBER_OF[action.op] ?? 'pane'))];
    let id: string;
    let cardLabel: string;
    let regard: { address: string; modelKind: string };
    if (anchor !== undefined) {
      id = anchor;
      cardLabel = label ?? (anchor.split('/').pop() ?? anchor);
      regard = { address: anchor, modelKind: 'dicom.series' };
    } else {
      const firstPath: string | undefined = content.map((action): string | undefined => action.path).find((path): boolean => path !== undefined);
      const signature: string = content.map((action): string => action.path
        ?? (action.input !== undefined ? `catalogue:${action.input}`
          : action.series !== undefined ? `gather:${action.series.map((one): string => one.seriesUID).join(',')}`
            : action.feed !== undefined ? `feed:${action.feed}` : action.op)).sort().join('|');
      const domainName: string = preset === 'dag' ? 'RUNS' : preset.toUpperCase();
      id = `${preset}:${signature}`;
      cardLabel = label !== undefined && label !== ''
        ? label
        : firstPath !== undefined ? (firstPath.split('/').pop() ?? firstPath) : `${domainName} · ${content.length + 1} panes`;
      regard = { address: id, modelKind: 'argus.desktop' };
    }
    dormant.add({
      id,
      label: cardLabel,
      regard,
      members,
      actions,
      ...(shape === null ? {} : { shape }),
      ...(thumbnail === undefined ? {} : { thumbnail }),
      lastTouched: Date.now(),
    });
  };

  const orphans_dispose = (): void => {
    const shown: Set<string> = new Set(layout.panes_shown());
    for (const instance of paneInstances_list()) {
      if (shown.has(instance.id)) continue;
      // The primaries are the domains' own panes and outlive any preset;
      // the launcher is one of them, and disposing it left the word that
      // opens it pointing at a pane that no longer existed (an empty stage).
      if (pane_isPrimary(instance.id)
        || instance.id === 'panes' || instance.id === 'launcher' || instance.id === 'universe') continue;
      paneInstance_dispose(instance.id);
      layout.mount_remove(instance.id);
    }
    hooks.stage_relight();
  };

  /**
   * Enters a gutter domain. The one chokepoint every domain switch routes
   * through: it captures the outgoing stage as a desktop BEFORE the preset
   * changes (so the context a switch would lose becomes a PANES card), then
   * applies the new preset and disposes what it left behind.
   */
  const domain_enter = (preset: string): void => {
    capture();
    layout.preset_apply(preset);
    orphans_dispose();
  };

  /** Replays one action; returns the pane it produced, or null. */
  const action_replay = (action: DesktopAction, host: string | null): string | null => {
    const paneOf = (kind: string): string[] => paneInstances_list().filter((instance): boolean => layout.panes_shown().includes(instance.id) && paneKind_get(instance.id) === kind).map((instance): string => instance.id);
    // The split this pane was born with — replayed opens read it so a
    // stacked or before-split pane returns where it was.
    const place: ReplayPlace = { dir: action.dir ?? 'col', before: action.side === 'before' };
    /** Runs an open with the replay place set, and names the pane new among a kind. */
    const placed = <T>(run: () => T): T => {
      replayPlace = place;
      try { return run(); } finally { replayPlace = null; }
    };
    const newOf = (kind: string, before: Set<string>): string | null => paneOf(kind).find((paneId): boolean => !before.has(paneId)) ?? null;
    if (action.op === 'domain') {
      // The domain switch must FINISH before the content panes open, or its
      // orphan sweep would dispose the panes opened after it. domain_enter
      // is synchronous, so the preset is applied and swept before this pass
      // moves on. The query then fires async; no pane targets its results.
      const preset: string = action.domain === 'runs' ? 'dag' : action.domain === 'pacs' ? 'pacs' : 'files';
      domain_enter(preset);
      if (action.query !== undefined) context.terminal.line_run(action.query);
      if (action.feed !== undefined) {
        // The graph comes back as the roster would bring it, then the view
        // the operator had chosen, once the graph has landed.
        const feed: number = action.feed;
        const view: readonly string[] = action.view ?? [];
        const dagPanel = panels.get('dag', 'dag');
        dagPanel?.feed_enter(feed);
        if (view.length > 0 && dagPanel !== undefined) {
          const landed = (tries: number): void => {
            if (dagPanel.graph_isShown() && dagPanel.feed_get() === feed) {
              for (const line of view) context.terminal.line_run(line);
              return;
            }
            if (tries > 0) window.setTimeout((): void => landed(tries - 1), 250);
          };
          landed(240);
        }
      }
      return preset;
    }
    if (host !== null) layout.focus_set(host);
    if (action.op === 'image' && action.path !== undefined) {
      let viewerId: string | null = null;
      const path: string = action.path;
      const done: Promise<string> = placed((): Promise<string> => hooks.image_open(null, path, {}, (openedId: string): void => { viewerId = openedId; }));
      // The saved view state lands when the series does — applied on the
      // viewer's own completion, never blocking the other panes.
      const view: readonly string[] | undefined = action.view;
      const vid: string | null = viewerId;
      if (view !== undefined && view.length > 0 && vid !== null) {
        void done.then((): void => { for (const line of view) { layout.focus_set(vid); context.terminal.line_run(line); } }).catch((): void => { /* the pane stands; its view state simply did not land */ });
      }
      return viewerId;
    }
    if (action.op === 'dir' && action.path !== undefined) {
      const before: Set<string> = new Set(paneOf('files'));
      const path: string = action.path;
      placed((): void => hooks.dir_open(path));
      return newOf('files', before);
    }
    if (action.op === 'tags') {
      const before: Set<string> = new Set(paneOf('tags'));
      placed((): void => context.terminal.line_run('image tags'));
      return newOf('tags', before);
    }
    if (action.op === 'catalogue' && action.input !== undefined) {
      // The catalogue returns bound as it was, its line intact and RUN
      // ready — the listing, not the dive: what to run is a choice again.
      const catalogues = (): string[] => hooks.catalogueIds().filter((paneId: string): boolean => layout.panes_shown().includes(paneId));
      const before: Set<string> = new Set(catalogues());
      const input: string = action.input;
      placed((): void => hooks.process_open(host ?? 'files', { input, feed: action.feed ?? null, node: action.node ?? null }));
      const opened: string | null = catalogues().find((paneId): boolean => !before.has(paneId)) ?? null;
      if (opened !== null && action.line !== undefined) panels.get('files', opened)?.commandLine_set(action.line);
      return opened;
    }
    if (action.op === 'gather' && action.series !== undefined) {
      // The cohort returns as it was gathered, named if it was named.
      const series: GatherSeries[] = [...action.series];
      const opened: string | null = placed((): string | null => hooks.gather_open(series, host ?? 'pacs'));
      if (opened !== null && action.name !== undefined) panels.get('gather', opened)?.name_set(action.name);
      if (opened !== null && action.feed !== undefined && action.root !== undefined) {
        panels.get('gather', opened)?.feed_set({ feedId: action.feed, rootInstanceId: action.root.instance, path: action.root.path });
      }
      return opened;
    }
    if (action.op === 'graph' && action.feed !== undefined) {
      const before: Set<string> = new Set(paneOf('dag'));
      const feed: number = action.feed;
      placed((): void => hooks.feed_open(host ?? 'files', feed));
      return newOf('dag', before);
    }
    if (action.op === 'edit' && action.path !== undefined) {
      const path: string = action.path;
      return placed((): string | null => hooks.edit_open(path));
    }
    if (action.op === 'fs' || action.op === 'view' || action.op === 'empty') {
      // A drawer-pill pane replays as its own birth: the pill's spawn, at
      // the same parent, orientation and side.
      if (host === null) return null;
      return hooks.pillPane_spawn(host, action.op, place.dir, place.before);
    }
    return null;
  };

  /**
   * Brings a dormant group back onto the stage: leaves the PANES domain,
   * replays the action log — `produced[i]` is the pane action i made, so an
   * action's `target` resolves to the exact pane it split from, and each
   * open is launched FROM that pane — then lays the recorded shape over the
   * panes that came back. Structure-first: every pane's frame opens
   * synchronously, the slow parts load in parallel behind it. The group is
   * taken out of the dormant set; it re-snapshots when it next leaves.
   */
  const restore = async (id: string): Promise<void> => {
    const snapshot: GroupSnapshot | undefined = dormant.get(id);
    if (snapshot === undefined || snapshot.actions === undefined) return;
    dormant.dismiss(id);
    replaying = true;
    try {
      const produced: Array<string | null> = [];
      for (const action of snapshot.actions) {
        const host: string | null = produced[action.target ?? 0] ?? null;
        produced.push(action_replay(action, host));
      }
      // The tiling returns as it stood: every frame is open now, so the
      // recorded shape is laid over them — a moved pane where it was moved
      // to, a block beside a block. A leaf whose action produced nothing
      // is left out of the shape.
      if (snapshot.shape !== undefined) {
        const tree_of = (node: DesktopShape): LayoutNode | null => {
          if ('leaf' in node) {
            const pane: string | null = produced[node.leaf] ?? null;
            return pane === null ? null : { pane };
          }
          const first: LayoutNode | null = tree_of(node.first);
          const second: LayoutNode | null = tree_of(node.second);
          if (first === null) return second;
          if (second === null) return first;
          return { dir: node.dir, ratio: node.ratio, first, second };
        };
        const tree: LayoutNode | null = tree_of(snapshot.shape);
        if (tree !== null && !('pane' in tree)) layout.tree_set(tree);
      }
    } finally {
      replaying = false;
      hooks.stage_relight();
    }
  };

  return {
    birth_record,
    replayPlace_get: (): ReplayPlace | null => replayPlace,
    replaying: (): boolean => replaying,
    strip_capture,
    capture,
    orphans_dispose,
    domain_enter,
    restore,
  };
}
