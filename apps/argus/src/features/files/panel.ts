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
  /** True when this browser follows the session cwd (the console's browser). */
  private following: boolean = false;
  /** Whether the listing on stage was served stale. */
  private stale: boolean = false;

  /**
   * @param container - The DOM element the panel renders into.
   * @param activate - Called when the operator activates a row; the caller
   *   lowers the gesture to session commands.
   */
  /** Per-column sort + filter over the resident entries. */
  private readonly order: RosterOrder<FsListingEntry>;
  /** The title bar's state span (FILTERED n/m). */
  private readonly stateSpan: HTMLElement | null;

  constructor(container: HTMLElement, activate: (action: FileAction) => void) {
    this.order = new RosterOrder<FsListingEntry>(
      [
        { key: 'name', label: 'NAME' },
        { key: 'size', label: 'SIZE' },
        { key: 'date', label: 'DATE' },
        { key: 'owner', label: 'OWNER' },
      ],
      (row: FsListingEntry, key: string): string | number =>
        key === 'size' ? row.size : key === 'date' ? row.date : key === 'owner' ? row.owner : row.name,
      (): void => this.listings_render(this.lastListings),
      { key: 'name', dir: 'asc' },
      1,
    );
    this.stateSpan = container.closest<HTMLElement>('.pane-files')?.querySelector<HTMLElement>('.pane-state') ?? null;
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
   * Presents one image in place of the grid, streamed from the daemon's
   * `/vfs` route, with a CLOSE pill returning to the last listing.
   *
   * @param path - The file's path, shown as the view's header.
   * @param url - The token-gated `/vfs` URL serving the image bytes.
   */
  public contentImage_show(path: string, url: string): void {
    this.contentShown = true;
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
    this.lastListings = listings;
    this.order.host_prepare(this.container);
    for (const listing of listings) {
      const block: HTMLElement = document.createElement('section');
      block.className = 'files-listing';

      const header: HTMLElement = document.createElement('header');
      header.className = 'files-path';
      header.textContent = listing.path;
      block.appendChild(header);

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
        updir.append(glyph, name, document.createElement('span'), document.createElement('span'), document.createElement('span'));
        updir.addEventListener('click', (): void => {
          this.activate({ kind: 'dir', path: parentPath_of(listing.path) });
        });
        table.appendChild(updir);
      }
      for (const item of this.order.apply(listing.items)) {
        table.appendChild(this.row_build(listing.path, item));
      }
      block.appendChild(table);
      this.container.appendChild(block);
    }
    // Honest-wait: a listing served stale says so on the bar until the
    // session's refresh replaces it.
    this.stale = listings.some((listing: FsListing): boolean => listing.fresh === false);
    this.state_render();
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

  /** The bar's state: what the browser is bound to, then what it shows. */
  private state_render(): void {
    if (this.stateSpan === null) return;
    this.stateSpan.classList.toggle('state-stale', this.stale);
    const parts: string[] = [];
    if (this.following) parts.push('CWD');
    parts.push(this.stale ? 'STALE' : this.order.summary());
    this.stateSpan.textContent = parts.filter((part: string): boolean => part !== '').join(' · ');
  }

  /** Shows or hides the filter strip (the drawer's FILTER, or `file filter`). */
  public filter_toggle(open?: boolean): void {
    this.order.strip_toggle(open);
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

    const glyph: HTMLSpanElement = document.createElement('span');
    glyph.className = 'files-glyph';
    glyph.textContent = TYPE_GLYPHS[item.type];

    const name: HTMLSpanElement = document.createElement('span');
    name.className = 'files-name';
    name.textContent = item.name;

    const size: HTMLSpanElement = document.createElement('span');
    size.className = 'files-size';
    size.textContent = item.type === 'dir' ? '' : size_format(item.size);

    const date: HTMLSpanElement = document.createElement('span');
    date.className = 'files-date';
    date.textContent = item.date.slice(0, 10);

    const owner: HTMLSpanElement = document.createElement('span');
    owner.className = 'files-owner';
    owner.textContent = item.owner;

    row.append(glyph, name, size, date, owner);

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
