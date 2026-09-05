/**
 * @file The Files instrument: a graphical projection of `fs.listing` models.
 *
 * The panel subscribes to every envelope the session shows this surface —
 * its own results and session-bus broadcasts alike — and repaints whenever
 * one carries an `fs.listing` model. Typing `ls` in the terminal therefore
 * updates this panel as data: two projections of one session. A directory
 * row lowers to the same bounded command an operator could type (`cd` then
 * `ls`), never to a graphical-only mutation path.
 *
 * The payload types below are a local mirror of the wire shape the stack
 * emits (authoritative source: brasa's typed kind map, which the browser
 * boundary rule forbids importing). Promotion of the kind map into the
 * published calypso contract is queued with the next contract bump; until
 * then this mirror validates structurally before rendering.
 *
 * @module
 */
import type { WireEnvelope } from '@fnndsc/menu';
import { RosterOrder } from '../roster/order.js';
import { ListingHost } from '../roster/host.js';

/**
 * One entry of a directory listing, as the `fs.listing` payload carries it.
 *
 * @property name - The display name of the entry.
 * @property type - The entry kind within the ChRIS VFS/CFS namespace.
 * @property size - Size in bytes.
 * @property owner - Username of the owner.
 * @property date - Creation date (ISO string).
 */
export interface FsListingEntry {
  name: string;
  type: 'dir' | 'file' | 'link' | 'plugin' | 'pipeline' | 'vfs' | 'job';
  size: number;
  owner: string;
  date: string;
  /** Where a link points, when the listing knows. */
  target?: string;
}

/**
 * One listed directory: its path and its entries.
 *
 * @property path - The listed directory's path.
 * @property items - The directory's entries.
 */
export interface FsListing {
  path: string;
  items: FsListingEntry[];
  /** False when the session served this listing stale; a refresh follows on its own. */
  fresh?: boolean;
}

/** Glyphs for the entry kinds, chosen to read at LCARS contrast. */
const TYPE_GLYPHS: Record<FsListingEntry['type'], string> = {
  dir: '▸',
  file: '·',
  link: '→',
  plugin: '⚙',
  pipeline: '⛓',
  vfs: '◆',
  job: '▷',
};

/** How a listing is projected: rows on the grid, cards, or cards with previews. */
export type FilesView = 'list' | 'cards' | 'preview';

/** The projection cycle the mode-frame pill walks. */
const VIEW_CYCLE: ReadonlyArray<FilesView> = ['list', 'cards', 'preview'];

/** Extensions the surface renders as images through the daemon's `/vfs` route. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']);

/** Extensions whose head reads as a text glimpse. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'txt', 'md', 'adoc', 'rst', 'json', 'csv', 'tsv', 'log', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'xml', 'html',
  'py', 'sh', 'ts', 'js', 'mjs', 'r', 'c', 'h', 'cpp', 'java', 'go', 'rs', 'sql', 'tex', 'bib',
]);

/** The largest text file a preview will read the head of. */
const PREVIEW_TEXT_MAX_BYTES: number = 256 * 1024;
/** How much of a text file's head a preview reads. */
/**
 * How much of a file a preview card holds.
 *
 * The card shows roughly the first eight lines; the rest is what the wheel
 * reaches. Enough to make scrolling worth the gesture, small enough that a
 * screen of cards is still one cheap read each.
 */
const PREVIEW_HEAD_BYTES: number = 4000;
/** The largest image a preview will ask the browser to decode. */
const PREVIEW_IMAGE_MAX_BYTES: number = 12 * 1024 * 1024;
/** Text heads remembered per panel before the cache is emptied. */
const PREVIEW_CACHE_MAX: number = 400;

/**
 * Reports whether a path's extension names a browser-renderable image.
 *
 * @param filePath - The file path.
 * @returns True for image extensions.
 */
export function extension_isImage(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extension_of(filePath));
}

/** The lower-cased extension of a path, or '' when it has none. */
function extension_of(filePath: string): string {
  const name: string = filePath.split('/').pop() ?? '';
  const dot: number = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Reports whether a text head reads as binary: a NUL, or a run of
 * replacement characters from decoding bytes that were never text.
 *
 * @param head - The decoded head of a file.
 * @returns True when the bytes were not text.
 */
function text_isBinary(head: string): boolean {
  if (head.includes('\u0000')) return true;
  const bad: number = (head.match(/\uFFFD/g) ?? []).length;
  return bad > 0 && bad / head.length > 0.02;
}

/**
 * What a preview needs from the surface: a URL that serves a file's bytes
 * natively, and a bounded read of a file's head. Both go through the
 * daemon's token-gated `/vfs` route, never the terminal stream.
 *
 * @property imageUrl - Builds the URL serving a path's bytes.
 * @property textHead - Reads at most `maxBytes` of a path, as text.
 */
export interface PreviewProvider {
  imageUrl: (path: string) => string;
  textHead: (path: string, maxBytes: number) => Promise<string>;
  /** The head of a /bin entry's description (a plugin's), through the session. */
  binHead: (path: string, maxChars: number) => Promise<string>;
  /** A pipeline's authored graph, for a glimpse; null when it has none. */
  pipelineGlimpse: (path: string) => Promise<PipelineGlimpseNode[] | null>;
}

/**
 * One node of a pipeline as a glimpse needs it: identity and parents.
 *
 * @property id - The node id.
 * @property parentIds - Its parents in the authored graph.
 */
export interface PipelineGlimpseNode {
  id: string;
  parentIds: string[];
}

/** The most nodes a glimpse draws before it says the count instead. */
const GLIMPSE_NODE_MAX: number = 80;

/**
 * Draws a pipeline's graph small: tiers by depth, parents above children,
 * as an SVG that scales to its card. Pure layout, no physics.
 *
 * @param nodes - The pipeline's nodes.
 * @returns The SVG element.
 */
function pipelineSvg_build(nodes: PipelineGlimpseNode[]): SVGSVGElement {
  const svgNs: string = 'http://www.w3.org/2000/svg';
  const svg: SVGSVGElement = document.createElementNS(svgNs, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 160 100');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const depth: Map<string, number> = new Map();
  const byId: Map<string, PipelineGlimpseNode> = new Map(nodes.map((node: PipelineGlimpseNode): [string, PipelineGlimpseNode] => [node.id, node]));
  const depth_of = (id: string, seen: Set<string> = new Set()): number => {
    const known: number | undefined = depth.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents: string[] = (byId.get(id)?.parentIds ?? []).filter((parent: string): boolean => byId.has(parent));
    const value: number = parents.length === 0 ? 0 : 1 + Math.max(...parents.map((parent: string): number => depth_of(parent, seen)));
    depth.set(id, value);
    return value;
  };
  for (const node of nodes) depth_of(node.id);
  const tiers: Map<number, string[]> = new Map();
  for (const node of nodes) {
    const tier: string[] = tiers.get(depth.get(node.id) ?? 0) ?? [];
    tier.push(node.id);
    tiers.set(depth.get(node.id) ?? 0, tier);
  }
  const tierCount: number = tiers.size;
  const position: Map<string, { x: number; y: number }> = new Map();
  for (const [level, ids] of tiers) {
    const y: number = tierCount === 1 ? 50 : 12 + (76 * level) / (tierCount - 1);
    ids.forEach((id: string, index: number): void => {
      position.set(id, { x: (160 * (index + 1)) / (ids.length + 1), y });
    });
  }
  for (const node of nodes) {
    const to = position.get(node.id);
    if (!to) continue;
    for (const parent of node.parentIds) {
      const from = position.get(parent);
      if (!from) continue;
      const line: SVGLineElement = document.createElementNS(svgNs, 'line') as SVGLineElement;
      line.setAttribute('x1', String(from.x)); line.setAttribute('y1', String(from.y));
      line.setAttribute('x2', String(to.x)); line.setAttribute('y2', String(to.y));
      line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '1'); line.setAttribute('opacity', '0.6');
      svg.appendChild(line);
    }
  }
  for (const [, at] of position) {
    const dot: SVGCircleElement = document.createElementNS(svgNs, 'circle') as SVGCircleElement;
    dot.setAttribute('cx', String(at.x)); dot.setAttribute('cy', String(at.y)); dot.setAttribute('r', nodes.length > 30 ? '2.2' : '4');
    dot.setAttribute('fill', 'currentColor');
    svg.appendChild(dot);
  }
  return svg;
}

/**
 * An operator gesture on a panel row, for the composer to lower into
 * session commands.
 *
 * @property kind - Whether a directory was entered or a file opened.
 * @property path - The full path of the activated entry.
 */
export interface FileAction {
  kind: 'dir' | 'file' | 'plugin' | 'pipeline';
  path: string;
}

/**
 * The Files panel: renders the latest `fs.listing` the session produced,
 * and can present one file's content with a way back to the listing.
 */
export class FilesPanel {
  private readonly container: HTMLElement;
  private readonly activate: (action: FileAction) => void;
  private lastListings: FsListing[] = [];
  /** True while one file's content stands in place of the listing. */
  private contentShown: boolean = false;

  /**
   * Paths this session was refused. CUBE's listing does not say what may
   * be read, so the browser only learns by being told no — and having been
   * told, says so on the row rather than making the operator find out
   * again.
   */
  private readonly denied: Set<string> = new Set();
  /** True when this browser follows the session cwd (the console's browser). */
  private following: boolean = false;
  /** How the listing is projected: rows on the grid, cards, or previews. */
  private viewMode: FilesView = 'list';
  /** The mode-frame pill that reads (and cycles) the projection. */
  private readonly viewPill: HTMLElement | null;
  /** The title bar's mode readout (silent at the default projection). */
  private readonly modeSpan: HTMLElement | null;
  /** The mode frame's FILTER block; it reads the strip's state. */
  private readonly filterBlock: HTMLElement | null;
  /** What previews fetch through, when the surface offers it. */
  private readonly preview: PreviewProvider | null;
  /** Text heads already read, by path. */
  private readonly headCache: Map<string, string> = new Map();
  /** Watches preview cards scroll into view; only then do they fetch. */
  private thumbObserver: IntersectionObserver | null = null;
  /** Tracks the roster frame's height so the mode frame starts beneath it. */
  private frameTopObserver: ResizeObserver | null = null;
  /** Whether the listing on stage was served stale. */
  private stale: boolean = false;

  /**
   * @param container - The DOM element the panel renders into.
   * @param activate - Called when the operator activates a row; the caller
   *   lowers the gesture to session commands.
   */
  /** Per-column sort + filter over the resident entries. */
  private readonly order: RosterOrder<FsListingEntry>;
  /** The frame-and-field host both tabular panes share. */
  private readonly host: ListingHost<FsListingEntry>;
  /** The title bar's state span (FILTERED n/m). */
  private readonly stateSpan: HTMLElement | null;

  constructor(container: HTMLElement, activate: (action: FileAction) => void, preview: PreviewProvider | null = null) {
    this.preview = preview;
    this.order = new RosterOrder<FsListingEntry>(
      [
        { key: 'name', label: 'NAME' },
        { key: 'type', label: 'TYPE' },
        { key: 'size', label: 'SIZE' },
        { key: 'date', label: 'DATE' },
        { key: 'owner', label: 'OWNER' },
      ],
      (row: FsListingEntry, key: string): string | number =>
        key === 'size' ? row.size : key === 'date' ? row.date : key === 'owner' ? row.owner : key === 'type' ? row.type : row.name,
      (): void => this.listings_render(this.lastListings),
      { key: 'name', dir: 'asc' },
      1,
    );
    this.host = new ListingHost<FsListingEntry>(container, this.order);
    this.stateSpan = container.closest<HTMLElement>('.pane-files')?.querySelector<HTMLElement>('.pane-state') ?? null;
    // The blocks live on this body's own frame (a files pane's, or a node browser's).
    this.viewPill = container.parentElement?.querySelector<HTMLElement>('.files-view') ?? null;
    this.modeSpan = container.closest<HTMLElement>('.pane-files')?.querySelector<HTMLElement>('.pane-mode') ?? null;
    this.viewPill?.addEventListener('click', (): void => {
      this.view_set(VIEW_CYCLE[(VIEW_CYCLE.indexOf(this.viewMode) + 1) % VIEW_CYCLE.length] ?? 'list');
    });
    this.filterBlock = container.parentElement?.querySelector<HTMLElement>('.files-filter') ?? null;
    this.filterBlock?.classList.add('rail-off');
    this.filterBlock?.addEventListener('click', (): void => this.filter_toggle());
    this.order.stripChange_observe((): void => this.filterBlock_sync());
    // The language reaches ordering through a DOM event on the pane.
    container.closest<HTMLElement>('.pane-files')?.addEventListener('argus:roster', (event: Event): void => {
      const detail = (event as CustomEvent<{ op: 'sort'; key: string; dir?: 'asc' | 'desc' } | { op: 'filter'; text: string }>).detail;
      if (detail.op === 'sort') this.order.sort_set(detail.key, detail.dir ?? 'asc');
      else if (detail.text === '') this.order.strip_toggle(false);
      else this.order.filter_set(detail.text);
    });
    this.container = container;
    this.activate = activate;
    this.empty_render();
  }

  /**
   * Inspects one envelope and repaints when it carries a listing model.
   *
   * @param envelope - Any envelope the session showed this surface.
   */
  public envelope_observe(envelope: WireEnvelope): void {
    if (envelope.model?.kind !== 'fs.listing') {
      return;
    }
    const listings: FsListing[] | null = listings_validate(envelope.model.data);
    if (listings === null || listings.length === 0) {
      return;
    }
    this.lastListings = listings;
    this.listings_render(listings);
  }

  /**
   * A refreshed listing arrived from the session on its own (the
   * revalidation behind a stale serve). Only a path this pane is showing
   * is its business: that listing is replaced in place and the STALE
   * readout clears.
   *
   * @param envelope - An ambient envelope.
   */
  public ambient_observe(envelope: WireEnvelope): void {
    if (envelope.model?.kind !== 'fs.listing') return;
    const incoming: FsListing[] | null = listings_validate(envelope.model.data);
    if (incoming === null || this.lastListings.length === 0) return;
    let touched: boolean = false;
    const merged: FsListing[] = this.lastListings.map((shown: FsListing): FsListing => {
      const fresh: FsListing | undefined = incoming.find((listing: FsListing): boolean => listing.path === shown.path);
      if (fresh === undefined) return shown;
      touched = true;
      return fresh;
    });
    if (touched) this.listings_render(merged);
  }

  /**
   * Presents one file's content in place of the grid, with a CLOSE pill
   * returning to the last listing.
   *
   * @param path - The file's path, shown as the view's header.
   * @param content - The file content, already stripped of ANSI codes.
   */
  public content_show(path: string, content: string): void {
    this.contentShown = true;
    this.container.parentElement?.classList.add('content-view');
    this.container.replaceChildren();

    const header: HTMLElement = document.createElement('header');
    header.className = 'files-path files-content-header';
    const title: HTMLSpanElement = document.createElement('span');
    title.textContent = path;
    const closePill: HTMLButtonElement = document.createElement('button');
    closePill.className = 'files-close-pill';
    closePill.textContent = 'CLOSE';
    closePill.addEventListener('click', (): void => this.listing_restore());
    header.append(title, closePill);

    const body: HTMLPreElement = document.createElement('pre');
    body.className = 'files-content';
    body.textContent = content;

    this.container.append(header, body);
  }

  /**
   * Presents a refused read in place of the file's contents.
   *
   * A file the operator may list but not read is ordinary: a feed shared
   * with them grants the listing, not the bytes. Rendering nothing made
   * that indistinguishable from an empty file, so the refusal is shown in
   * the session's own words, and the row is remembered as unreadable so
   * the listing carries the same news when it returns.
   *
   * @param path - The file's path, shown as the view's header.
   * @param reason - What the session said when it refused.
   */
  public contentRefused_show(path: string, reason: string): void {
    this.denied.add(path);
    this.contentShown = true;
    this.container.parentElement?.classList.add('content-view');
    this.container.replaceChildren();

    const header: HTMLElement = document.createElement('header');
    header.className = 'files-path files-content-header files-content-refused';
    const title: HTMLSpanElement = document.createElement('span');
    title.textContent = path;
    const closePill: HTMLButtonElement = document.createElement('button');
    closePill.className = 'files-close-pill';
    closePill.textContent = 'CLOSE';
    closePill.addEventListener('click', (): void => this.listing_restore());
    header.append(title, closePill);

    const body: HTMLElement = document.createElement('div');
    body.className = 'files-refused';
    const lede: HTMLElement = document.createElement('p');
    lede.className = 'files-refused-lede';
    lede.textContent = 'READ REFUSED';
    const said: HTMLElement = document.createElement('pre');
    said.className = 'files-refused-said';
    said.textContent = reason;
    body.append(lede, said);

    this.container.append(header, body);
  }

  /**
   * Presents one image in place of the grid, streamed from the daemon's
   * `/vfs` route, with a CLOSE pill returning to the last listing.
   *
   * @param path - The file's path, shown as the view's header.
   * @param url - The token-gated `/vfs` URL serving the image bytes.
   */
  public contentImage_show(path: string, url: string): void {
    this.contentShown = true;
    this.container.parentElement?.classList.add('content-view');
    this.container.replaceChildren();

    const header: HTMLElement = document.createElement('header');
    header.className = 'files-path files-content-header';
    const title: HTMLSpanElement = document.createElement('span');
    title.textContent = path;
    const closePill: HTMLButtonElement = document.createElement('button');
    closePill.className = 'files-close-pill';
    closePill.textContent = 'CLOSE';
    closePill.addEventListener('click', (): void => this.listing_restore());
    header.append(title, closePill);

    const image: HTMLImageElement = document.createElement('img');
    image.className = 'files-image';
    image.src = url;
    image.alt = path;

    this.container.append(header, image);
  }

  /** @returns The path of the listing currently shown, or null before the first. */
  public path_current(): string | null {
    return this.lastListings[0]?.path ?? null;
  }

  /** Returns from a content view to the most recent listing. */
  /** Whether a file view, not a listing, is on stage (a level Esc can pop). */
  public content_isShown(): boolean {
    return this.contentShown;
  }

  /** Releases whatever the current content view mounted (a diagram scene). */
  private contentRelease: (() => void) | null = null;

  /**
   * Presents rendered markup in place of the grid — a /bin entry's
   * description, a pipeline's summary — with a CLOSE pill returning to the
   * listing, and optionally a work surface beneath it for a diagram.
   *
   * @param path - The entry's path, shown as the view's header.
   * @param html - Safe markup for the text body.
   * @param options - `diagram` asks for a mount beneath the text; `release`
   *   runs when the view is replaced (dispose what was mounted).
   * @returns The diagram mount when asked for, else null.
   */
  public contentHtml_show(
    path: string,
    html: string,
    options: { diagram?: boolean; release?: () => void } = {},
  ): HTMLElement | null {
    this.contentRelease?.();
    this.contentRelease = options.release ?? null;
    this.contentShown = true;
    this.container.parentElement?.classList.add('content-view');
    this.container.replaceChildren();

    const view: HTMLElement = document.createElement('section');
    view.className = 'files-content-view';
    const header: HTMLElement = document.createElement('header');
    header.className = 'files-path files-content-header';
    const title: HTMLSpanElement = document.createElement('span');
    title.textContent = path;
    const closePill: HTMLButtonElement = document.createElement('button');
    closePill.className = 'files-close-pill';
    closePill.textContent = 'CLOSE';
    closePill.addEventListener('click', (): void => this.listing_restore());
    header.append(title, closePill);
    const body: HTMLPreElement = document.createElement('pre');
    body.className = 'files-content';
    body.innerHTML = html;
    view.append(header, body);
    let mount: HTMLElement | null = null;
    if (options.diagram === true) {
      mount = document.createElement('div');
      mount.className = 'files-diagram';
      view.appendChild(mount);
    }
    this.container.appendChild(view);
    return mount;
  }

  public listing_restore(): void {
    this.contentRelease?.();
    this.contentRelease = null;
    if (this.lastListings.length > 0) {
      this.listings_render(this.lastListings);
    } else {
      this.empty_render();
    }
  }

  /** Paints the waiting state shown before any listing arrives. */
  private empty_render(): void {
    this.container.replaceChildren();
    const hint: HTMLParagraphElement = document.createElement('p');
    hint.className = 'files-empty';
    hint.textContent = 'AWAITING LISTING — TYPE ls IN THE CONSOLE';
    this.container.appendChild(hint);
  }

  /**
   * Paints the listings: one block per listed directory, one row per entry.
   *
   * @param listings - The listings to paint.
   */
  private listings_render(listings: FsListing[]): void {
    this.contentShown = false;
    this.container.parentElement?.classList.remove('content-view');
    this.lastListings = listings;
    this.thumbObserver?.disconnect();
    this.thumbObserver = null;
    // Rows scroll; the frame does not. The host seats the frame and opens
    // the field beneath it.
    const field: HTMLElement = this.host.field_open();
    for (const listing of listings) {
      const block: HTMLElement = document.createElement('section');
      block.className = 'files-listing';

      const header: HTMLElement = document.createElement('header');
      header.className = 'files-path';
      header.textContent = listing.path;
      block.appendChild(header);

      if (this.viewMode !== 'list') {
        const withPreview: boolean = this.viewMode === 'preview';
        const cards: HTMLElement = document.createElement('div');
        cards.className = withPreview ? 'files-cards files-previews' : 'files-cards';
        if (listing.path !== '/') {
          const up: HTMLElement = document.createElement('article');
          up.className = 'files-card files-card-up files-activatable';
          up.textContent = '▴ ..';
          up.addEventListener('click', (): void => {
            this.activate({ kind: 'dir', path: parentPath_of(listing.path) });
          });
          cards.appendChild(up);
        }
        for (const item of this.order.apply(listing.items)) cards.appendChild(this.card_build(listing.path, item, withPreview));
        block.appendChild(cards);
        field.appendChild(block);
        continue;
      }
      const table: HTMLElement = document.createElement('div');
      table.className = 'files-grid';
      // Navigation goes both ways: every listing below the root leads with
      // an updir row, lowering to the same `cd ..` an operator would type.
      if (listing.path !== '/') {
        const updir: HTMLElement = document.createElement('div');
        updir.className = 'files-row files-type-dir files-activatable';
        const glyph: HTMLSpanElement = document.createElement('span');
        glyph.className = 'files-glyph';
        glyph.textContent = '▴';
        const name: HTMLSpanElement = document.createElement('span');
        name.className = 'files-name';
        name.textContent = '..';
        updir.append(glyph, name, document.createElement('span'), document.createElement('span'), document.createElement('span'), document.createElement('span'));
        updir.addEventListener('click', (): void => {
          this.activate({ kind: 'dir', path: parentPath_of(listing.path) });
        });
        table.appendChild(updir);
      }
      for (const item of this.order.apply(listing.items)) {
        table.appendChild(this.row_build(listing.path, item));
      }
      block.appendChild(table);
      field.appendChild(block);
    }
    // Honest-wait: a listing served stale says so on the bar until the
    // session's refresh replaces it.
    this.stale = listings.some((listing: FsListing): boolean => listing.fresh === false);
    this.state_render();
    this.frameTop_track();
  }

  /**
   * The caps and filter strip are the table's own frame, sticky at the top
   * of the field, and the path header rides sticky beneath them; the field
   * rule (and the mode frame under it) sit at the path header's bottom.
   * Two CSS variables on the body carry those offsets, kept true by a
   * ResizeObserver as the filter strip comes and goes.
   */
  private frameTop_track(): void {
    const body: HTMLElement | null = this.container.parentElement;
    const roster: HTMLElement | null = this.container.querySelector<HTMLElement>('.roster-order');
    const header: HTMLElement | null = this.container.querySelector<HTMLElement>('.files-path');
    this.frameTopObserver?.disconnect();
    this.frameTopObserver = null;
    if (body === null) return;
    if (roster === null || header === null) {
      body.style.removeProperty('--mode-frame-top');
      body.style.removeProperty('--roster-frame-h');
      return;
    }
    const sync = (): void => {
      const top: number = body.getBoundingClientRect().top;
      const rosterH: number = Math.ceil(roster.getBoundingClientRect().bottom - top);
      body.style.setProperty('--roster-frame-h', `${rosterH}px`);
      body.style.setProperty('--mode-frame-top', `${Math.ceil(header.getBoundingClientRect().bottom - top)}px`);
    };
    sync();
    this.frameTopObserver = new ResizeObserver(sync);
    this.frameTopObserver.observe(roster);
    this.frameTopObserver.observe(header);
  }

  /**
   * Declares whether this browser follows the session cwd. The bar says so
   * (`CWD`): a following browser and a rooted one wear the same chrome, and
   * a binding nobody can see is a hardcode, not a binding.
   *
   * @param on - True to follow the cwd.
   */
  public follow_set(on: boolean): void {
    this.following = on;
    this.state_render();
  }

  /** Whether this browser follows the session cwd. */
  public follow_get(): boolean {
    return this.following;
  }

  /**
   * Sets the projection: rows on the grid, cards, or cards with previews.
   * The same listing, the same sort and filter, the same activation —
   * drawn another way. The mode-frame pill reads the current mode; the
   * bar annunciates a non-default one.
   *
   * @param mode - The projection.
   */
  public view_set(mode: FilesView): void {
    this.viewMode = mode;
    if (this.viewPill !== null) this.viewPill.textContent = mode.toUpperCase();
    if (this.modeSpan !== null) this.modeSpan.textContent = mode === 'list' ? '' : mode.toUpperCase();
    if (this.lastListings.length > 0 && !this.contentShown) this.listings_render(this.lastListings);
  }

  /** The current projection. */
  public view_get(): FilesView {
    return this.viewMode;
  }

  /**
   * One entry as a card: the kind as its badge, the name as its title, the
   * owner and date beneath, the size at the right. Activates like a row.
   * With previews, the card leads with a glimpse of its content.
   *
   * @param parentPath - The listed directory.
   * @param item - The entry.
   * @param withPreview - Whether to lead with a content glimpse.
   * @returns The card element.
   */
  private card_build(parentPath: string, item: FsListingEntry, withPreview: boolean = false): HTMLElement {
    const card: HTMLElement = document.createElement('article');
    card.className = `files-card files-type-${item.type}`;
    if (withPreview) card.appendChild(this.thumb_build(path_join(parentPath, item.name), item));
    const head: HTMLElement = document.createElement('div');
    head.className = 'files-card-head';
    const badge: HTMLSpanElement = document.createElement('span');
    badge.className = 'files-card-badge';
    badge.textContent = item.type.toUpperCase();
    const size: HTMLSpanElement = document.createElement('span');
    size.className = 'files-card-size';
    size.textContent = item.type === 'dir' || item.size === 0 ? '' : size_format(item.size);
    head.append(badge, size);
    const title: HTMLElement = document.createElement('div');
    title.className = 'files-card-title';
    title.textContent = item.name;
    const meta: HTMLElement = document.createElement('div');
    meta.className = 'files-card-meta';
    const owner: HTMLSpanElement = document.createElement('span');
    owner.textContent = item.owner;
    const date: HTMLSpanElement = document.createElement('span');
    date.textContent = item.date.slice(0, 10);
    meta.append(owner, date);
    card.append(head, title, meta);
    if (item.type === 'link' && item.target !== undefined) {
      const target: HTMLElement = document.createElement('div');
      target.className = 'files-card-target';
      target.textContent = `→ ${item.target}`;
      target.title = item.target;
      card.appendChild(target);
    }
    const path: string = path_join(parentPath, item.name);
    if (item.type === 'dir' || item.type === 'vfs' || item.type === 'link' || item.type === 'job') {
      card.classList.add('files-activatable');
      card.addEventListener('click', (): void => this.activate({ kind: 'dir', path }));
    } else if (item.type === 'file') {
      card.classList.add('files-activatable');
      card.addEventListener('click', (): void => this.activate({ kind: 'file', path }));
    } else if (item.type === 'plugin' || item.type === 'pipeline') {
      card.classList.add('files-activatable');
      card.addEventListener('click', (): void => this.activate({ kind: item.type as 'plugin' | 'pipeline', path }));
    }
    return card;
  }

  /**
   * The glimpse a preview card leads with: an image served natively, the
   * head of a text file, or the kind's glyph when nothing renders (a
   * directory, a plugin, a DICOM file, a text file too large to read for
   * a thumbnail). Images and heads are fetched only once the card is on
   * screen; heads are remembered per path.
   *
   * @param path - The entry's path.
   * @param item - The entry.
   * @returns The thumbnail element, armed to fetch when seen.
   */
  private thumb_build(path: string, item: FsListingEntry): HTMLElement {
    const thumb: HTMLElement = document.createElement('div');
    thumb.className = 'files-card-thumb';
    const glyph = (): void => { thumb.textContent = TYPE_GLYPHS[item.type]; };
    if (this.preview === null || !(item.type === 'file' || item.type === 'plugin' || item.type === 'pipeline')) {
      glyph();
      return thumb;
    }
    if (item.type === 'plugin' || item.type === 'pipeline') {
      // A plugin's glimpse is what it does: the head of its description. A
      // pipeline's is its authored graph, drawn small.
      const binProvider: PreviewProvider = this.preview;
      const cachedHead: string | undefined = this.headCache.get(path);
      if (cachedHead !== undefined && item.type === 'plugin') {
        const pre: HTMLPreElement = document.createElement('pre');
        pre.textContent = cachedHead;
        thumb.appendChild(pre);
        return thumb;
      }
      thumb.classList.add('thumb-wait');
      thumb.textContent = TYPE_GLYPHS[item.type];
      const loadBin = (): void => {
        if (item.type === 'plugin') {
          void binProvider.binHead(path, PREVIEW_HEAD_BYTES).then((head: string): void => {
            thumb.classList.remove('thumb-wait');
            if (head.trim() === '') { glyph(); return; }
            if (this.headCache.size >= PREVIEW_CACHE_MAX) this.headCache.clear();
            this.headCache.set(path, head);
            const pre: HTMLPreElement = document.createElement('pre');
            pre.textContent = head;
            thumb.replaceChildren(pre);
          }).catch((): void => { thumb.classList.remove('thumb-wait'); glyph(); });
          return;
        }
        void binProvider.pipelineGlimpse(path).then((nodes: PipelineGlimpseNode[] | null): void => {
          thumb.classList.remove('thumb-wait');
          if (nodes === null || nodes.length === 0) { glyph(); return; }
          if (nodes.length > GLIMPSE_NODE_MAX) { thumb.textContent = `${nodes.length} NODES`; thumb.classList.add('thumb-count'); return; }
          thumb.replaceChildren(pipelineSvg_build(nodes));
        }).catch((): void => { thumb.classList.remove('thumb-wait'); glyph(); });
      };
      this.thumbObserver_get().observe(thumb);
      thumb.addEventListener('files:thumb-seen', loadBin, { once: true });
      return thumb;
    }
    const cached: string | undefined = this.headCache.get(path);
    if (cached !== undefined) {
      const pre: HTMLPreElement = document.createElement('pre');
      pre.textContent = cached;
      thumb.appendChild(pre);
      return thumb;
    }
    const isImage: boolean = extension_isImage(path) && item.size <= PREVIEW_IMAGE_MAX_BYTES;
    // A file with no extension (a node's log, params, status) is read as
    // text until its head proves otherwise.
    const extension: string = extension_of(path);
    const isText: boolean = (extension === '' || TEXT_EXTENSIONS.has(extension)) && item.size <= PREVIEW_TEXT_MAX_BYTES;
    if (!isImage && !isText) {
      glyph();
      return thumb;
    }
    thumb.classList.add('thumb-wait');
    thumb.textContent = TYPE_GLYPHS.file;
    const provider: PreviewProvider = this.preview;
    const load = (): void => {
      if (isImage) {
        const image: HTMLImageElement = document.createElement('img');
        image.alt = item.name;
        image.addEventListener('load', (): void => { thumb.classList.remove('thumb-wait'); });
        image.addEventListener('error', (): void => { thumb.classList.remove('thumb-wait'); glyph(); });
        image.src = provider.imageUrl(path);
        thumb.replaceChildren(image);
        return;
      }
      void provider.textHead(path, PREVIEW_HEAD_BYTES).then((head: string): void => {
        if (this.headCache.size >= PREVIEW_CACHE_MAX) this.headCache.clear();
        this.headCache.set(path, head);
        thumb.classList.remove('thumb-wait');
        if (head.trim() === '' || text_isBinary(head)) { glyph(); return; }
        const pre: HTMLPreElement = document.createElement('pre');
        pre.textContent = head;
        thumb.replaceChildren(pre);
      }).catch((): void => { thumb.classList.remove('thumb-wait'); glyph(); });
    };
    this.thumbObserver_get().observe(thumb);
    thumb.addEventListener('files:thumb-seen', load, { once: true });
    return thumb;
  }

  /** The observer that wakes a preview card when it scrolls into view. */
  private thumbObserver_get(): IntersectionObserver {
    if (this.thumbObserver === null) {
      this.thumbObserver = new IntersectionObserver((entries: IntersectionObserverEntry[]): void => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.thumbObserver?.unobserve(entry.target);
          entry.target.dispatchEvent(new CustomEvent('files:thumb-seen'));
        }
      }, { root: this.container, rootMargin: '25%' });
    }
    return this.thumbObserver;
  }

  /** The bar's state: what the browser is bound to, then what it shows. */
  private state_render(): void {
    if (this.stateSpan === null) return;
    this.stateSpan.classList.toggle('state-stale', this.stale);
    const parts: string[] = [];
    if (this.following) parts.push('CWD');
    parts.push(this.stale ? 'STALE' : this.order.summary());
    this.stateSpan.textContent = parts.filter((part: string): boolean => part !== '').join(' · ');
  }

  /** Shows or hides the filter strip (the mode frame's FILTER, or `file filter`). */
  public filter_toggle(open?: boolean): void {
    this.order.strip_toggle(open);
  }

  /** The FILTER block reads the strip's state, like every mode block. */
  private filterBlock_sync(): void {
    if (this.filterBlock === null) return;
    const on: boolean = this.order.strip_isOpen();
    this.filterBlock.textContent = on ? 'FILTER ON' : 'FILTER OFF';
    this.filterBlock.classList.toggle('rail-off', !on);
  }

  /**
   * Builds one entry row; directory rows are activatable.
   *
   * @param parentPath - The listed directory containing the entry.
   * @param item - The entry to render.
   * @returns The row element.
   */
  private row_build(parentPath: string, item: FsListingEntry): HTMLElement {
    const row: HTMLElement = document.createElement('div');
    row.className = `files-row files-type-${item.type}`;

    // Listable is not readable. Once refused, the row says so rather than
    // inviting the same click again.
    const refused: boolean = this.denied.has(path_join(parentPath, item.name));
    if (refused) {
      row.classList.add('files-denied');
      row.title = 'listed but not readable — CUBE refused this identity access to the contents';
    }

    const glyph: HTMLSpanElement = document.createElement('span');
    glyph.className = 'files-glyph';
    glyph.textContent = refused ? '⃠' : TYPE_GLYPHS[item.type];

    const name: HTMLSpanElement = document.createElement('span');
    name.className = 'files-name';
    name.textContent = item.name;
    if (item.type === 'link' && item.target !== undefined) {
      // A link says where it points, the way `ls -l` does.
      const target: HTMLSpanElement = document.createElement('span');
      target.className = 'files-target';
      target.textContent = `→ ${item.target}`;
      name.appendChild(target);
      name.title = item.target;
    }

    const size: HTMLSpanElement = document.createElement('span');
    size.className = 'files-size';
    size.textContent = item.type === 'dir' ? '' : size_format(item.size);

    const date: HTMLSpanElement = document.createElement('span');
    date.className = 'files-date';
    date.textContent = item.date.slice(0, 10);

    const owner: HTMLSpanElement = document.createElement('span');
    owner.className = 'files-owner';
    owner.textContent = item.owner;

    // The entry's kind is a column of its own: a name alone does not say
    // whether it is a plugin, a pipeline, a link, or a directory.
    const type: HTMLSpanElement = document.createElement('span');
    type.className = 'files-type';
    type.textContent = item.type;
    row.append(glyph, name, type, size, date, owner);

    // Links navigate: in this VFS a link names a place (a node's `data`
    // pointing into the feed tree), so following it is a directory move —
    // the engine resolves the target. Only plain files are viewable content.
    // 'job' is /proc's directory kind for a plugin instance — navigable,
    // and inside a node's overlay it is the hop target.
    if (item.type === 'dir' || item.type === 'vfs' || item.type === 'link' || item.type === 'job') {
      row.classList.add('files-activatable');
      row.addEventListener('click', (): void => {
        this.activate({ kind: 'dir', path: path_join(parentPath, item.name) });
      });
    } else if (item.type === 'file') {
      row.classList.add('files-activatable');
      row.addEventListener('click', (): void => {
        this.activate({ kind: 'file', path: path_join(parentPath, item.name) });
      });
    } else if (item.type === 'plugin' || item.type === 'pipeline') {
      // A /bin entry opens as context: what this executable is.
      row.classList.add('files-activatable');
      row.addEventListener('click', (): void => {
        this.activate({ kind: item.type as 'plugin' | 'pipeline', path: path_join(parentPath, item.name) });
      });
    }
    return row;
  }
}

/**
 * Structurally validates an `fs.listing` payload before rendering.
 *
 * The wire model slot is `{ kind, data: unknown }`; this check is the local
 * boundary between that unknown and the panel's typed rendering.
 *
 * @param data - The model payload.
 * @returns The typed listings, or null when the shape does not match.
 */
function listings_validate(data: unknown): FsListing[] | null {
  if (!Array.isArray(data)) {
    return null;
  }
  for (const listing of data) {
    if (typeof listing !== 'object' || listing === null) {
      return null;
    }
    const candidate: { path?: unknown; items?: unknown } = listing as { path?: unknown; items?: unknown };
    if (typeof candidate.path !== 'string' || !Array.isArray(candidate.items)) {
      return null;
    }
  }
  return data as FsListing[];
}

/**
 * Joins a parent path and an entry name with exactly one separator.
 *
 * @param parentPath - The containing directory.
 * @param name - The entry name.
 * @returns The joined path.
 */
function path_join(parentPath: string, name: string): string {
  return parentPath.endsWith('/') ? `${parentPath}${name}` : `${parentPath}/${name}`;
}

/**
 * Resolves a path's parent directory.
 *
 * @param path - The path whose parent is wanted.
 * @returns The parent path; `/` is its own parent.
 */
function parentPath_of(path: string): string {
  const trimmed: string = path.endsWith('/') ? path.slice(0, -1) : path;
  const cut: number = trimmed.lastIndexOf('/');
  return cut <= 0 ? '/' : trimmed.slice(0, cut);
}

/**
 * Formats a byte count for the grid, compactly.
 *
 * @param bytes - The size in bytes.
 * @returns The human form (e.g. `2.4K`, `13M`).
 */
function size_format(bytes: number): string {
  if (bytes < 1024) {
    return String(bytes);
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
