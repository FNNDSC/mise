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
 * The listing itself — caps, filter, sort, the action track, indication,
 * the selection and the state line — is the `Listing` façade of
 * `features/roster`, declared once (`features/roster/listing.ts`). This
 * panel owns only what a browser has beyond a listing: content views (a
 * file, an image, a /bin entry), the card and preview projections, the
 * cwd binding, and the stale readout.
 *
 * The payload types below are a local mirror of the wire shape the stack
 * emits (authoritative source: brasa's typed kind map, which the browser
 * boundary rule forbids importing). Promotion of the kind map into the
 * published calypso contract is queued with the next contract bump; until
 * then this mirror validates structurally before rendering.
 *
 * @module
 */
import { DICOM_FILE_PATTERN, SERIES_FOLDER_PATTERN } from '../image/engine.js';
import type { WireEnvelope } from '@fnndsc/menu';
import { rankedLayout_compute, type RankedLayout } from '@fnndsc/orrery/layout';
import { Listing, type ListingBlock, type ListingStateParts } from '../roster/listing.js';
import { csvTable_read, type CsvTable } from './csv.js';
import { JSON_FILE_PATTERN, jsonPretty_build } from './json.js';
import { more_wire } from '../roster/more.js';
import type { ListingAction, ListingTrait } from '../roster/row.js';
import { barState_toggle } from '../roster/bar.js';

/**
 * One entry of a directory listing, as the `fs.listing` payload carries it.
 *
 * @property name - The display name of the entry.
 * @property type - The entry kind within the ChRIS VFS/CFS namespace.
 * @property size - Size in bytes.
 * @property owner - Username of the owner.
 * @property date - Creation date (ISO string).
 */
/**
 * The version an executable's name carries (`pl-dcm2niix-v2.1.1` → `2.1.1`),
 * or empty when it carries none.
 *
 * @param name - The executable's name as `/bin` lists it.
 * @returns The version.
 */
export function executableVersion_of(name: string): string {
  return /-v(\d+(?:\.\d+)*)$/.exec(name)?.[1] ?? '';
}

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

/**
 * One row of the listing: an entry, the full path it sits at, and whether
 * it is a lead row — the way home (`~`) or the way up (`..`).
 *
 * The façade keys rows by a string and renders a row from its traits, so
 * the path a browser entry sits at — which the entry itself does not carry,
 * since a name is listed under a directory — travels on the row. A lead row
 * stands outside the order and keeps its single click; `updir` marks both
 * lead rows, `home` tells the way home from the way up.
 */
interface FileRow {
  entry: FsListingEntry;
  path: string;
  updir: boolean;
  home?: boolean;
}

/** The home glyph: the Nerd Font house, the `~` row's capsule. */
const HOME_GLYPH: string = '\uF015';

/**
 * The console's icons for the entry kinds — the Nerd Font glyphs
 * `packages/chili/config/colors.yml` gives `ls` — so a folder in the
 * browser is the folder the console just printed. A job has no entry of
 * its own there and takes the file's, as the console does. Held equal to
 * the console's table by a unit test.
 */
/** Where the catalogue's entries live. */
const BIN_PATH: string = '/bin';
/** The RECENT block's key: not a place, a lead over `/bin`'s own rows. */
const RECENT_PATH: string = '/bin/recent';

export const TYPE_GLYPHS: Readonly<Record<FsListingEntry['type'], string>> = {
  dir: '\uF07C',
  file: '\uF15B',
  link: '\uF0C1',
  plugin: '\uF013',
  pipeline: '\uF013',
  vfs: '\uF0C8',
  job: '\uF15B',
};

/**
 * The console's colour for each entry kind, by chalk name, from the same
 * table (`fileTypes` in colors.yml); the stylesheet reads them as
 * `--console-<name>`. A job is the console's cyan, set in its code rather
 * than its table.
 */
export const TYPE_COLOURS: Readonly<Record<FsListingEntry['type'], 'yellow' | 'white' | 'cyan' | 'green' | 'magenta'>> = {
  dir: 'yellow',
  file: 'white',
  link: 'cyan',
  plugin: 'green',
  pipeline: 'magenta',
  vfs: 'magenta',
  job: 'cyan',
};

/** How a listing is projected: rows on the grid, cards, or cards with previews. */
export type FilesView = 'list' | 'cards' | 'preview';

/** The projection cycle the mode-frame pill walks. */
const VIEW_CYCLE: ReadonlyArray<FilesView> = ['list', 'cards', 'preview'];

/** A record of a delimited file, as a listing row. */
interface CsvRow {
  index: number;
  cells: string[];
}

/**
 * The most records a table view paints.
 *
 * Bounded, and the bar says so when it bites: a table cut without a word
 * is a table the operator reads as complete.
 */
const CSV_ROW_CAP: number = 5000;

/** Extensions the surface renders as images through the daemon's `/vfs` route. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']);

/** Extensions whose head reads as a text glimpse. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'txt', 'md', 'adoc', 'rst', 'json', 'csv', 'tsv', 'log', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'xml', 'html',
  'py', 'sh', 'ts', 'js', 'mjs', 'r', 'c', 'h', 'cpp', 'java', 'go', 'rs', 'sql', 'tex', 'bib',
]);

/** The card's drawing area, in viewBox units. */
const GLIMPSE_VIEW_W: number = 160;
const GLIMPSE_VIEW_H: number = 100;

/** Margin inside the viewBox, so a node's disc is never clipped at an edge. */
const GLIMPSE_PAD: number = 10;

/** Above this many nodes the discs shrink, or the drawing becomes a smudge. */
const GLIMPSE_DENSE_NODES: number = 30;

/** The largest text file a preview will read the head of. */
const PREVIEW_TEXT_MAX_BYTES: number = 256 * 1024;
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
  if (head.includes(' ')) return true;
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
  /** Brings a path's bytes down to the operator's disk, or says why not. */
  download: (path: string) => void;
  textHead: (path: string, maxBytes: number) => Promise<string>;
  /** A pipeline's authored graph, for a glimpse; null when it has none. */
  pipelineGlimpse: (path: string) => Promise<GlimpseNode[] | null>;
}

/**
 * One node of a graph as a glimpse needs it: identity and parents.
 *
 * @property id - The node id.
 * @property parentIds - Its parents in the graph.
 */
export interface GlimpseNode {
  id: string;
  parentIds: string[];
}

/** The most nodes a glimpse draws before it says the count instead. */
const GLIMPSE_NODE_MAX: number = 80;

/**
 * A DOWNLOAD pill for a file view's header: the file on stage, brought
 * down to the operator's disk. Absent when the pane has no provider to
 * build the URL, as a pane under test may not.
 *
 * @param provider - The pane's provider, or null.
 * @param path - The file's path.
 * @returns The pill alone, or nothing when there is nothing to build it from.
 */
function downloadPill_build(provider: PreviewProvider | null, path: string): HTMLButtonElement[] {
  if (provider === null) return [];
  const pill: HTMLButtonElement = document.createElement('button');
  pill.className = 'files-close-pill files-download-pill';
  pill.textContent = 'DOWNLOAD';
  pill.title = 'save this file to your disk';
  pill.addEventListener('click', (): void => provider.download(path));
  return [pill];
}

/**
 * Draws a graph small: tiers by depth, parents above children, as an SVG
 * that scales to its card. Pure layout, no physics.
 *
 * Every /bin entry is a graph at this size, a plugin included — it is the
 * one-node case, and drawing it here is what stopped a plugin card being a
 * paragraph while a pipeline card was a picture.
 *
 * @param nodes - The graph's nodes.
 * @returns The SVG element.
 */
function graphSvg_build(nodes: GlimpseNode[]): SVGSVGElement {
  const svgNs: string = 'http://www.w3.org/2000/svg';
  const svg: SVGSVGElement = document.createElementNS(svgNs, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${GLIMPSE_VIEW_W} ${GLIMPSE_VIEW_H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // The same placement the stage uses, drawn small. This card cannot hold a
  // WebGL context — a grid wants ninety of them and a browser grants about
  // a dozen — so it paints SVG, but it must not paint a DIFFERENT graph.
  const layout: RankedLayout = rankedLayout_compute(nodes);
  const spanX: number = Math.max(layout.width, 1);
  const spanY: number = Math.max(layout.tierCount - 1, 1);
  const position: Map<string, { x: number; y: number }> = new Map();
  for (const placement of layout.placements) {
    position.set(placement.id, {
      x: GLIMPSE_PAD + ((placement.x / spanX) * (GLIMPSE_VIEW_W - 2 * GLIMPSE_PAD)),
      y: GLIMPSE_PAD + ((placement.tier / spanY) * (GLIMPSE_VIEW_H - 2 * GLIMPSE_PAD)),
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
    dot.setAttribute('cx', String(at.x)); dot.setAttribute('cy', String(at.y));
    dot.setAttribute('r', nodes.length > GLIMPSE_DENSE_NODES ? '2.2' : '4');
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
 * The kind of activation an entry answers to, or null when it answers to
 * none (a /bin catalogue entry that is not itself navigable).
 *
 * Links navigate: in this VFS a link names a place (a node's `data`
 * pointing into the feed tree), so following it is a directory move — the
 * engine resolves the target. Only plain files are viewable content.
 * 'job' is /proc's directory kind for a plugin instance — navigable, and
 * inside a node's overlay it is the hop target.
 *
 * @param entry - The entry.
 * @returns The action kind, or null.
 */
function actionKind_of(entry: FsListingEntry): FileAction['kind'] | null {
  if (entry.type === 'dir' || entry.type === 'vfs' || entry.type === 'link' || entry.type === 'job') return 'dir';
  if (entry.type === 'file') return 'file';
  if (entry.type === 'plugin' || entry.type === 'pipeline') return entry.type;
  return null;
}

/**
 * The Files panel: renders the latest `fs.listing` the session produced,
 * and can present one file's content with a way back to the listing.
 */
export class FilesPanel {
  private readonly container: HTMLElement;
  /**
   * The executables run lately, newest first, when this pane is a
   * catalogue: they lead the /bin listing as a RECENT block so the last
   * thing run is the first thing offered. Null: no such block.
   */
  private recent: string[] | null = null;
  private readonly activate: (action: FileAction) => void;
  private readonly listing: Listing<FileRow>;
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
  /** What previews fetch through, when the surface offers it. */
  private readonly preview: PreviewProvider | null;
  /** Whether this browser is a CATALOGUE: `/bin` listed for running, in catalogue traits. */
  private readonly catalogue: boolean;
  /** The run strip a bound catalogue wears at the head of its listing: the binding, the line, the run. */
  private runStrip: HTMLElement | null = null;
  /** Told when the operator presses the FEED capsule a run left behind. */
  private feedOpen: ((feedId: number) => void) | null = null;
  /** Text heads already read, by path. */
  private readonly headCache: Map<string, string> = new Map();
  /** Watches preview cards scroll into view; only then do they fetch. */
  private thumbObserver: IntersectionObserver | null = null;
  /** Tracks the roster frame's height so the mode frame starts beneath it. */
  private frameTopObserver: ResizeObserver | null = null;
  /** Whether the listing on stage was served stale. */
  private stale: boolean = false;
  /** The session's home directory, `/home/<user>`, once the prompt says who. */
  private home: string | null = null;
  /** Where the way up is the way out: its path, and what the updir row reads there. */
  private ceiling: { path: string; word: string } | null = null;
  /** The pane's state span, kept only to wear the STALE underline class. */
  private readonly stateSpan: HTMLElement | null;
  /** Told which row was indicated, for the regard; nothing until the surface says. */
  private indicate: ((entry: FsListingEntry, path: string) => void) | null = null;
  /** What a SELECTION may be told to do; the surface declares it. */
  private selectionVerbs: ((rows: ReadonlyArray<[string, FsListingEntry]>) => ReadonlyArray<ListingAction<void>>) | null = null;

  /**
   * @param container - The DOM element the panel renders into.
   * @param activate - Called when the operator activates a row; the caller
   *   lowers the gesture to session commands.
   * @param preview - What previews fetch through, or null for none.
   */
  constructor(
    container: HTMLElement,
    activate: (action: FileAction) => void,
    preview: PreviewProvider | null = null,
    options: { catalogue?: boolean } = {},
  ) {
    this.container = container;
    this.activate = activate;
    this.preview = preview;
    this.catalogue = options.catalogue === true;
    // A catalogue's frame offers what acts on a catalogue: the stylesheet
    // hides the place verbs (HOME, BACK, MKDIR, UPLOAD, SELECT) by this mark.
    if (this.catalogue) container.parentElement?.classList.add('files-catalogue');
    // The state line lives on the pane header; the mode-frame blocks live on
    // the body. A console pane has a `.pane-files` over both; a node overlay
    // has only its stamped body, and no state line of its own.
    const paneRoot: HTMLElement | null = container.closest<HTMLElement>('.pane-files') ?? container.parentElement;
    this.viewPill = container.parentElement?.querySelector<HTMLElement>('.files-view') ?? null;
    this.modeSpan = container.closest<HTMLElement>('.pane-files')?.querySelector<HTMLElement>('.pane-mode') ?? null;
    this.stateSpan = paneRoot?.querySelector<HTMLElement>('.pane-state') ?? null;
    this.viewPill?.addEventListener('click', (): void => {
      this.view_set(VIEW_CYCLE[(VIEW_CYCLE.indexOf(this.viewMode) + 1) % VIEW_CYCLE.length] ?? 'list');
    });
    // A row's verbs, and a selection's, ride the frame's row zone, which
    // the façade mints into the body's frame. A stamped body with no
    // frame (a node's overlay) gets none, declares no verbs, keeps one click.
    const framed: boolean = container.parentElement?.querySelector(':scope > .mode-frame') !== null;
    this.listing = new Listing<FileRow>({
      mount: container,
      traits: this.traits_declare(),
      // The way home keys apart from the way up: from a directory just
      // under home both lead to the same path.
      key: (row: FileRow): string => (row.home === true ? '~' : row.path),
      // What the kernel calls this row, so the index pill can carry the
      // number `@N` would actually reach.
      address: (row: FileRow): string | undefined => row.path,
      chrome: paneRoot === null ? undefined : { root: paneRoot, prefix: 'files' },
      control: 'control',
      activate: (row: FileRow): void => this.row_activate(row),
      activatable: (row: FileRow): boolean => row.updir || actionKind_of(row.entry) !== null,
      indicated: (row: FileRow): void => this.indicate?.(row.entry, row.path),
      row: {
        className: (row: FileRow): string =>
          `files-row files-type-${row.entry.type}${row.home === true ? ' files-lead-home' : row.updir ? ' files-lead-up' : ''}${!row.updir && this.denied.has(row.path) ? ' files-denied' : ''}`,
        decorate: (element: HTMLElement, row: FileRow): void => {
          // The path is on the row so a selection can be repainted without
          // rebuilding it, and so it survives the same rows arriving again.
          element.dataset['path'] = row.path;
          if (!row.updir && this.denied.has(row.path)) {
            element.title = 'listed but not readable — CUBE refused this identity access to the contents';
          }
        },
      },
      ...(!framed ? {} : {
        selection: {
          verbs: (rows: ReadonlyArray<[string, FileRow]>): ReadonlyArray<ListingAction<void>> =>
            this.selectionVerbs?.(rows.map(([path, row]: [string, FileRow]): [string, FsListingEntry] => [path, row.entry])) ?? [],
        },
      }),
      state: (parts: ListingStateParts): string => this.stateLine_compose(parts),
      defaultSort: { key: 'name', dir: 'asc' },
    });
    this.empty_render();
  }

  /**
   * The files listing's columns, declared once.
   *
   * A directory shows no size: a folder's byte count is not a fact CUBE
   * reports, and a zero would read as an empty directory. The updir shows
   * only its glyph and name; the rest of its cells are blank.
   *
   * @returns The traits, closing over this panel's refusal set for the glyph.
   */
  private traits_declare(): ReadonlyArray<ListingTrait<FileRow>> {
    return this.catalogue ? this.catalogueTraits_declare() : this.browserTraits_declare();
  }

  /** The browser's own columns: the control (the kind's glyph), then what a file is. */
  private browserTraits_declare(): ReadonlyArray<ListingTrait<FileRow>> {
    return [
      {
        // The row's CONTROL, as PACS's fold column, is the kind's own glyph
        // — the console's folder, file, cog — in a capsule when the row
        // opens (a directory enters, a file shows, a catalogue entry
        // graphs), bare when it opens nothing. No word: the glyph already
        // says what the row is, and what a press does follows from that.
        // `..` is a directory like any other, so it wears the folder.
        // Navigating is not selecting: this cell activates, the rest of the
        // row indicates.
        key: 'control',
        label: '',
        className: 'files-control',
        capped: false,
        width: '2.4em',
        cell: (row: FileRow): HTMLElement => {
          const cell: HTMLSpanElement = document.createElement('span');
          const kind: FsListingEntry['type'] = row.updir ? 'dir' : row.entry.type;
          const opens: boolean = row.updir || actionKind_of(row.entry) !== null;
          cell.className = `files-control files-glyph files-glyph-${kind}${opens ? ' files-capsule' : ''}`;
          cell.textContent = row.home === true ? HOME_GLYPH : !row.updir && this.denied.has(row.path) ? '⃠' : TYPE_GLYPHS[kind];
          return cell;
        },
      },
      {
        key: 'name',
        label: 'NAME',
        className: 'files-name',
        // A floor so the name never collapses to a glyph in a narrow pane (a
        // DIR tile split to a third of the stage): it holds a readable width
        // and the pane scrolls to the rest rather than clipping the filename.
        width: 'minmax(12em, 1fr)',
        cell: (row: FileRow): string | HTMLElement => {
          const name: HTMLSpanElement = document.createElement('span');
          name.className = 'files-name';
          // A lead row is a control and carries its label on its capsule
          // (UP); a caption beside it would say the same thing twice.
          name.textContent = row.home === true ? '~' : row.entry.name;
          if (row.home === true) {
            // The way home says where home is, dimmed the way a link says
            // where it points.
            const where: HTMLSpanElement = document.createElement('span');
            where.className = 'files-target';
            where.textContent = row.path;
            name.appendChild(where);
            name.title = `home: ${row.path}`;
          }
          if (!row.updir && row.entry.type === 'link' && row.entry.target !== undefined) {
            // A link says where it points, the way `ls -l` does.
            const target: HTMLSpanElement = document.createElement('span');
            target.className = 'files-target';
            target.textContent = `→ ${row.entry.target}`;
            name.appendChild(target);
            name.title = row.entry.target;
          }
          return name;
        },
        compare: (row: FileRow): string => row.entry.name,
      },
      {
        key: 'type',
        label: 'TYPE',
        className: 'files-type',
        width: '6em',
        cell: (row: FileRow): string => (row.updir ? '' : row.entry.type),
      },
      {
        key: 'size',
        label: 'SIZE',
        className: 'files-size',
        width: '6em',
        cell: (row: FileRow): string => (row.updir || row.entry.type === 'dir' ? '' : size_format(row.entry.size)),
        compare: (row: FileRow): number => row.entry.size,
      },
      {
        key: 'date',
        label: 'DATE',
        className: 'files-date',
        width: '7em',
        cell: (row: FileRow): string => (row.updir ? '' : row.entry.date.slice(0, 10)),
        compare: (row: FileRow): string => row.entry.date,
      },
      {
        key: 'owner',
        label: 'OWNER',
        className: 'files-owner',
        width: '10em',
        cell: (row: FileRow): string => (row.updir ? '' : row.entry.owner),
      },
    ];
  }

  /**
   * Activates a row: the updir and a directory move the session, a file
   * opens, a /bin entry opens as context. The surface lowers each gesture.
   *
   * @param row - The activated row.
   */
  private row_activate(row: FileRow): void {
    if (row.updir) {
      this.activate({ kind: 'dir', path: row.path });
      return;
    }
    const kind: FileAction['kind'] | null = actionKind_of(row.entry);
    if (kind === null) return;
    this.activate({ kind, path: row.path });
  }

  /**
   * Inspects one envelope and repaints when it carries a listing model.
   *
   * @param envelope - Any envelope the session showed this surface.
   */
  public envelope_observe(envelope: WireEnvelope): void {
    // A press the kernel refused: the row stands down and the bar reads
    // the kernel's own words (cd: x: Not a directory; not yours to read).
    if (envelope.status === 'error') {
      const said: string = (envelope.renderedErr ?? envelope.rendered ?? '').replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n')[0] ?? '';
      if (/^(cd|ls): /.test(said)) this.listing.activation_refuse(said);
      return;
    }
    if (envelope.model?.kind !== 'fs.listing') {
      return;
    }
    const listings: FsListing[] | null = listings_validate(envelope.model.data);
    if (listings === null || listings.length === 0) {
      return;
    }
    this.lastListings = listings;
    // A projection is listed by the kernel and written by nothing: /proc is
    // a view of jobs, not a folder. The blocks that would write into the
    // field stand down there rather than offering an act that cannot
    // happen — and a control that cannot act is a promise the frame does
    // not get to make.
    const place: string = listings[0]?.path ?? '';
    this.container.closest('.workspace-pane')?.classList.toggle('files-projection', /^\/(proc|net|etc|usr)(\/|$)/.test(place));
    // A view is closed by the operator, never by an arrival. A listing
    // reaching a pane whose operator is reading something lands UNDER it —
    // CLOSE and Esc then show the newer listing. Rendering it instead took
    // the view away mid-read, and a /bin scene fetched for a mount that no
    // longer exists cannot come back (#425).
    if (this.contentShown) return;
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
    if (!touched) return;
    // A background revalidation must never take a view away from the
    // operator: it lands under whatever they are reading, so CLOSE
    // returns to the fresh listing rather than the one that went stale.
    if (this.contentShown) {
      this.lastListings = merged;
      return;
    }
    this.listings_render(merged);
  }

  /**
   * Presents one file's content in place of the grid, with a CLOSE pill
   * returning to the last listing.
   *
   * @param path - The file's path, shown as the view's header.
   * @param content - The file content, already stripped of ANSI codes.
   */
  /**
   * Opens a delimited file as the table it is.
   *
   * A CSV is a table, and this surface renders every table through one
   * façade — so it is declared into the façade like every other listing,
   * caps from its header record, and gets the frame, the sort and the
   * filter for free. RAW shows the bytes, because sometimes the quoting is
   * the thing being read.
   *
   * @param path - The file's path, shown as the view's header.
   * @param content - The file's text.
   */
  public contentTable_show(path: string, content: string): void {
    const table: CsvTable = csvTable_read(content, path);
    if (table.caps.length === 0) {
      this.content_show(path, content);
      return;
    }
    // A very large table is BOUNDED and says so, never silently cut.
    const shown: string[][] = table.rows.slice(0, CSV_ROW_CAP);
    const capped: boolean = table.rows.length > shown.length;

    this.contentRelease?.();
    this.contentShown = true;
    this.container.parentElement?.classList.add('content-view');
    this.container.replaceChildren();
    this.diagram_declare(false);

    const view: HTMLElement = document.createElement('section');
    view.className = 'files-content-view files-table-view';
    const header: HTMLElement = document.createElement('header');
    header.className = 'files-path files-content-header';
    const title: HTMLSpanElement = document.createElement('span');
    title.textContent = path;
    const state: HTMLSpanElement = document.createElement('span');
    state.className = 'pane-state';
    header.append(title, state);

    // The field a listing needs: a rule turning through an elbow into the
    // spine, the frame the façade mints its zone into, and the mount.
    const field: HTMLElement = document.createElement('div');
    field.className = 'files-table-field';
    const rule: HTMLElement = document.createElement('span');
    rule.className = 'field-rule';
    const strip: HTMLButtonElement = document.createElement('button');
    strip.className = 'mode-strip';
    strip.title = 'display modes';
    const elbow: HTMLElement = document.createElement('span');
    elbow.className = 'mode-elbow';
    const frame: HTMLElement = document.createElement('aside');
    frame.className = 'mode-frame';
    // A table's verbs live on its frame, as every field's do (aegis.adoc:
    // a-control-lives-where-it-acts): FILTER for the rows, RAW for the
    // bytes as written, DOWNLOAD for the file itself, CLOSE to leave the
    // table. A frame that carried FILTER alone, off and dim above a bright
    // fill, read as no verbs.
    const filter: HTMLButtonElement = document.createElement('button');
    filter.className = 'strategy-pill csv-filter rail-off';
    filter.textContent = 'FILTER OFF';
    filter.title = 'filter the table';
    const raw: HTMLButtonElement = document.createElement('button');
    raw.className = 'strategy-pill csv-raw';
    raw.textContent = 'RAW';
    raw.title = 'the bytes as written';
    raw.addEventListener('click', (): void => this.content_show(path, content));
    const closeBlock: HTMLButtonElement = document.createElement('button');
    closeBlock.className = 'strategy-pill csv-close';
    closeBlock.textContent = 'CLOSE';
    closeBlock.title = 'leave the table; the listing beneath returns';
    closeBlock.addEventListener('click', (): void => this.listing_restore());
    const fill: HTMLElement = document.createElement('span');
    fill.className = 'mode-fill';
    frame.append(filter, raw, fill);
    const provider: PreviewProvider | null = this.preview;
    if (provider !== null) {
      const download: HTMLButtonElement = document.createElement('button');
      download.className = 'strategy-pill csv-download';
      download.textContent = 'DOWNLOAD';
      download.title = 'save this file to your disk';
      download.addEventListener('click', (): void => provider.download(path));
      frame.append(download);
    }
    frame.append(closeBlock);
    const mount: HTMLElement = document.createElement('div');
    mount.className = 'files-table-rows';
    field.append(rule, strip, elbow, frame, mount);
    view.append(header, field);
    this.container.appendChild(view);

    const traits: Array<ListingTrait<CsvRow>> = table.caps.map((cap: string, column: number): ListingTrait<CsvRow> => ({
      key: `c${column}`,
      label: cap.toUpperCase(),
      className: 'files-table-cell',
      cell: (row: CsvRow): string => row.cells[column] ?? '',
      width: 'minmax(6em, 1fr)',
    }));
    const listing: Listing<CsvRow> = new Listing<CsvRow>({
      mount,
      traits,
      key: (row: CsvRow): string => String(row.index),
      chrome: { root: view, prefix: 'csv' },
      state: (parts: ListingStateParts): string => {
        const words: string[] = [];
        // The filter's own summary already counts what it kept out of what
        // it was given, so the plain total would say the same number twice.
        if (parts.filter !== '') words.push(`${parts.filter} ROWS`);
        else words.push(capped
          ? `SHOWING ${shown.length} OF ${table.rows.length} ROWS`
          : `${table.rows.length} ROWS`);
        if (!table.headed) words.push('NO HEADER: COLUMNS NUMBERED');
        return words.join(' · ');
      },
      empty: (): HTMLElement => {
        const note: HTMLElement = document.createElement('div');
        note.className = 'files-note';
        note.textContent = 'NO ROWS';
        return note;
      },
    });
    listing.rows_set(
      [{ key: path, rows: shown.map((cells: string[], index: number): CsvRow => ({ index, cells })) }],
      { field: path },
    );
    this.contentRelease = (): void => { mount.replaceChildren(); };
  }

  /**
   * Shows a file's text. A JSON file is shown as the structure it is —
   * pretty-printed, its keys, strings, numbers and literals in their own
   * hues — with RAW for the bytes as written; one minified line of a
   * cohort manifest was unreadable as anything. A file that does not
   * parse, or is too large to lay out, is shown as it is.
   *
   * @param path - The file's path, shown as the view's header.
   * @param content - The file's text.
   * @param raw - Show the bytes as written even where a structure is known.
   */
  public content_show(path: string, content: string, raw: boolean = false): void {
    this.diagram_declare(false);
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
    const body: HTMLPreElement = document.createElement('pre');
    body.className = 'files-content';
    const structured: DocumentFragment | null = raw || !JSON_FILE_PATTERN.test(path) ? null : jsonPretty_build(content);
    const pills: HTMLElement[] = [];
    if (structured !== null || (raw && JSON_FILE_PATTERN.test(path) && jsonPretty_build(content) !== null)) {
      const toggle: HTMLButtonElement = document.createElement('button');
      toggle.className = 'files-close-pill';
      toggle.textContent = structured !== null ? 'RAW' : 'PRETTY';
      toggle.addEventListener('click', (): void => this.content_show(path, content, structured !== null));
      pills.push(toggle);
    }
    header.append(title, ...downloadPill_build(this.preview, path), ...pills, closePill);
    if (structured !== null) {
      body.classList.add('files-json');
      body.append(structured);
    } else {
      body.textContent = content;
    }

    this.container.append(header, body);
    // The view scrolls without a scrollbar and says how many lines lie below.
    more_wire(body);
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
    this.diagram_declare(false);
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
    header.append(title, ...downloadPill_build(this.preview, path), closePill);

    const image: HTMLImageElement = document.createElement('img');
    image.className = 'files-image';
    image.src = url;
    image.alt = path;

    this.container.append(header, image);
  }

  /**
   * Declares what a row may be told to do, and who to tell when one is
   * indicated.
   *
   * The panel knows what a row IS; only the surface knows what can be done
   * about it — a verb lowers to a session command, which is not this
   * class's business. The verbs ride the frame's row zone, never the row:
   * indicating a row puts them there and opens the frame. Both are
   * optional, and a browser given neither behaves as it did before there
   * were row verbs (its single click activates); so does a row offered
   * no verbs — a directory — which one click enters.
   *
   * @param actions - The verbs for one row, computed per row.
   * @param indicate - Told which row was indicated, for the regard.
   */
  public rowVerbs_declare(
    actions: (entry: FsListingEntry, path: string) => ReadonlyArray<ListingAction<FsListingEntry>>,
    indicate?: (entry: FsListingEntry, path: string) => void,
  ): void {
    this.indicate = indicate ?? null;
    this.listing.actions_declare({
      // The surface's verbs act on the entry; the façade offers them the
      // row. Each verb is rebound to its row's entry at the boundary, so
      // the two vocabularies never leak into one another.
      of: (row: FileRow): ReadonlyArray<ListingAction<FileRow>> =>
        // `..` is NAVIGATION and nothing else. It is the way out of here,
        // not a row about a place: verbs on it read as acting on what it
        // names — the parent — while they were computed for the place on
        // stage, and MKDIR reached from it said "make a directory in the
        // listing" while standing on a row that means "up". A row offered
        // nothing keeps its single click, which is exactly what going up
        // should cost.
        row.updir ? [] : actions(row.entry, row.path).map((verb: ListingAction<FsListingEntry>): ListingAction<FileRow> => ({
          label: verb.label,
          run: (): void => verb.run(row.entry),
          ...(verb.offered !== undefined ? { offered: (): boolean => verb.offered!(row.entry) } : {}),
          ...(verb.disabled !== undefined ? { disabled: (): boolean => verb.disabled!(row.entry) } : {}),
        })),
    });
  }

  /**
   * A catalogue's columns: what an executable is, not what a file is —
   * its name, its kind, and the version its name carries. Same control
   * column as a browser (the cog shows the graph; the body selects).
   */
  private catalogueTraits_declare(): ReadonlyArray<ListingTrait<FileRow>> {
    const browser: ReadonlyArray<ListingTrait<FileRow>> = this.browserTraits_declare();
    const leading: ReadonlyArray<ListingTrait<FileRow>> = browser.filter(
      (trait: ListingTrait<FileRow>): boolean => trait.key === 'control' || trait.key === 'name',
    );
    return [
      ...leading,
      {
        key: 'type',
        label: 'TYPE',
        className: 'files-type',
        width: '6em',
        cell: (row: FileRow): string => (row.updir ? '' : row.entry.type),
      },
      {
        key: 'version',
        label: 'VERSION',
        className: 'files-version',
        width: '7em',
        cell: (row: FileRow): string => (row.updir ? '' : executableVersion_of(row.entry.name)),
        compare: (row: FileRow): string => executableVersion_of(row.entry.name),
      },
    ];
  }

  /** Whether this browser is a catalogue. */
  public catalogue_is(): boolean {
    return this.catalogue;
  }

  /**
   * Binds the catalogue to an input: the run strip appears at the head of
   * the listing, reading what will be processed and where the run lands,
   * with the line that will run beneath — editable, and authoritative.
   *
   * @param binding - The input path and where a run of it lands.
   */
  public binding_set(binding: { input: string; place: string }): void {
    if (this.runStrip === null) {
      const strip: HTMLElement = document.createElement('div');
      strip.className = 'files-run-strip';
      const readout: HTMLSpanElement = document.createElement('span');
      readout.className = 'files-binding';
      const line: HTMLInputElement = document.createElement('input');
      line.className = 'files-command';
      line.spellcheck = false;
      line.autocomplete = 'off';
      line.placeholder = 'the line RUN will run';
      strip.append(readout, line);
      // Above the listing region, not inside it: the façade opens the
      // region's field afresh on every render and would sweep it away.
      this.container.parentElement?.insertBefore(strip, this.container);
      this.runStrip = strip;
      // The header says what this pane is now: a catalogue, not a workspace.
      const title: HTMLElement | null | undefined = this.container.closest<HTMLElement>('.pane-files')?.querySelector<HTMLElement>('.pane-title');
      if (title !== null && title !== undefined) title.textContent = 'CATALOGUE';
    }
    const readout: HTMLElement | null = this.runStrip.querySelector<HTMLElement>('.files-binding');
    if (readout !== null) readout.textContent = `INPUT ${binding.input} → ${binding.place}`;
    this.frameTop_track();
  }

  /** The line the strip holds, trimmed; empty when the operator typed nothing. */
  public commandLine_get(): string {
    return this.runStrip?.querySelector<HTMLInputElement>('.files-command')?.value.trim() ?? '';
  }

  /** Writes the line the strip holds. */
  public commandLine_set(line: string): void {
    const input: HTMLInputElement | null = this.runStrip?.querySelector<HTMLInputElement>('.files-command') ?? null;
    if (input !== null) input.value = line;
  }

  /** The indicated row's path, or null. */
  public indicated_get(): string | null {
    return this.listing.indicated_get();
  }

  /** Declares what pressing a run's FEED capsule does. */
  public feedOpen_declare(open: (feedId: number) => void): void {
    this.feedOpen = open;
  }

  /**
   * Shows where a run landed: a lit FEED capsule on the strip that opens
   * the feed's graph beside the catalogue. A later run replaces it.
   *
   * @param feedId - The feed the run landed in.
   */
  public run_show(feedId: number): void {
    if (this.runStrip === null) return;
    this.runStrip.querySelector('.files-feed')?.remove();
    const capsule: HTMLButtonElement = document.createElement('button');
    capsule.className = 'files-feed listing-capsule listing-action-selected';
    capsule.textContent = `FEED ${feedId}`;
    capsule.title = 'open this run\'s graph beside the catalogue';
    capsule.addEventListener('click', (): void => this.feedOpen?.(feedId));
    this.runStrip.appendChild(capsule);
  }

  /**
   * Indicates one row: its verbs appear in the frame's row zone in place
   * of the previously indicated row's.
   *
   * @param path - The row's path, or null to indicate nothing.
   */
  public row_indicate(path: string | null): void {
    this.listing.row_indicate(path);
  }

  /**
   * Shows a readout beside an indicated row's verbs.
   *
   * A verb that grants something should say what is already granted, and
   * the answer arrives after the indication (it is a fetch). It is dropped
   * when the operator has moved on: a readout about a row nobody is looking
   * at would be an answer to a question already withdrawn.
   *
   * @param path - The row the readout belongs to.
   * @param text - What to say beside the verbs.
   */
  public rowReadout_show(path: string, text: string): void {
    this.listing.readout_show(path, text);
  }

  /**
   * Declares what a SELECTION may be told to do.
   *
   * A selection belongs to the field, so its verbs ride the frame's row
   * zone, as a row's do — and, like a row's, they lower to session
   * commands the surface owns.
   *
   * @param verbs - The verbs for the current selection.
   */
  public selectionVerbs_declare(
    verbs: (rows: ReadonlyArray<[string, FsListingEntry]>) => ReadonlyArray<ListingAction<void>>,
  ): void {
    this.selectionVerbs = verbs;
  }

  /**
   * Turns SELECT on or off. Turning it off clears nothing: the selection
   * is the field's until the field changes.
   *
   * @param on - Whether to select; omitted flips the mode.
   */
  public select_toggle(on?: boolean): void {
    this.listing.select_toggle(on);
  }

  /** @returns Whether SELECT is on. */
  public select_isOn(): boolean {
    return this.listing.select_isOn();
  }

  /** @returns The selected paths, in listing order. */
  public selection_get(): string[] {
    return this.listing.selection_get();
  }

  /** @returns The path of the listing currently shown, or null before the first. */
  public path_current(): string | null {
    return this.lastListings[0]?.path ?? null;
  }

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
    view.appendChild(header);
    // A plugin's view is its graph and nothing else: an empty <pre> would
    // hold open the space the wall of text used to fill.
    if (html !== '') {
      const body: HTMLPreElement = document.createElement('pre');
      body.className = 'files-content';
      body.innerHTML = html;
      view.appendChild(body);
    }
    let mount: HTMLElement | null = null;
    if (options.diagram === true) {
      mount = document.createElement('div');
      mount.className = 'files-diagram';
      view.appendChild(mount);
    }
    this.diagram_declare(options.diagram === true);
    this.container.appendChild(view);
    return mount;
  }

  /**
   * Fills in a content view's summary text after the view is already up.
   *
   * A /bin entry's graph is fetched with the view on screen, and some
   * entries carry a summary above it. Rendering that when it arrives keeps
   * the view immediate rather than holding it back for the slower half.
   *
   * @param html - The summary, already escaped and marked up.
   */
  public contentText_set(html: string): void {
    const view: HTMLElement | null = this.container.querySelector<HTMLElement>('.files-content-view');
    if (view === null) return;
    const existing: HTMLElement | null = view.querySelector<HTMLElement>('.files-content');
    const body: HTMLElement = existing ?? document.createElement('pre');
    body.className = 'files-content';
    body.innerHTML = html;
    if (existing === null) {
      const header: HTMLElement | null = view.querySelector<HTMLElement>('.files-content-header');
      header?.after(body);
    }
  }

  /**
   * Declares the executables run lately, newest first; the /bin listing on
   * stage (or the next to arrive) leads with them as a RECENT block.
   *
   * @param names - `/bin` entry names, or null for no block.
   */
  public recent_set(names: ReadonlyArray<string> | null): void {
    this.recent = names === null ? null : [...names];
    if (this.lastListings.length > 0 && !this.contentShown) this.listings_render(this.lastListings);
  }

  /** Returns from a content view to the most recent listing. */
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
    this.diagram_declare(false);
    this.container.replaceChildren();
    const hint: HTMLParagraphElement = document.createElement('p');
    hint.className = 'files-empty';
    hint.textContent = 'AWAITING LISTING — TYPE ls IN THE CONSOLE';
    this.container.appendChild(hint);
  }

  /**
   * Renders the listings through the façade: one block per listed
   * directory, each led by its updir, drawn as rows or — under cards and
   * previews — by a painter.
   *
   * @param listings - The listings to paint.
   */
  private listings_render(listings: FsListing[]): void {
    // A listing on stage means the diagram is gone, however it arrived.
    this.diagram_declare(false);
    this.contentShown = false;
    this.container.parentElement?.classList.remove('content-view');
    this.lastListings = listings;
    this.thumbObserver?.disconnect();
    this.thumbObserver = null;
    // Honest-wait: a listing served stale says so on the bar until the
    // session's refresh replaces it.
    this.stale = listings.some((listing: FsListing): boolean => listing.fresh === false);
    barState_toggle(this.stateSpan, 'stale', this.stale);
    this.listing.painter_set(this.viewMode === 'list' ? null : (block: ListingBlock<FileRow>, into: HTMLElement): void => this.cards_paint(block, into));
    const blocks: ListingBlock<FileRow>[] = listings.map((listing: FsListing): ListingBlock<FileRow> => this.block_of(listing));
    // A catalogue leads with what ran lately: the same rows /bin holds,
    // in the order they were last run, under their own header.
    const bin: FsListing | undefined = listings.find((listing: FsListing): boolean => listing.path === BIN_PATH);
    if (this.recent !== null && this.recent.length > 0 && bin !== undefined) {
      const recent: ListingBlock<FileRow> | null = this.recentBlock_of(bin);
      if (recent !== null) blocks.unshift(recent);
    }
    this.listing.rows_set(blocks, {
      // The field is the FIRST listed path: a selection is the field's, so
      // it survives a filter and the same rows arriving again, and clears
      // when the operator navigates elsewhere.
      field: listings[0]?.path ?? '',
    });
    this.frameTop_track();
  }

  /**
   * The path line as a trail of places: every segment but the last is a
   * press that goes there, the way `..` goes one up. Under home the trail
   * starts at `~`; elsewhere it starts at the root, `/`.
   *
   * @param path - The listed directory.
   * @returns The header.
   */
  private crumbs_build(path: string): HTMLElement {
    const header: HTMLElement = document.createElement('header');
    header.className = 'files-path files-crumbs';
    const trail: Array<{ label: string; path: string }> = [];
    const home: string | null = this.home;
    let rest: string;
    if (home !== null && (path === home || path.startsWith(`${home}/`))) {
      trail.push({ label: '~', path: home });
      rest = path.slice(home.length);
    } else {
      trail.push({ label: '/', path: '/' });
      rest = path;
    }
    let at: string = trail[0]?.path ?? '/';
    for (const segment of rest.split('/').filter((part: string): boolean => part.length > 0)) {
      at = at === '/' ? `/${segment}` : `${at}/${segment}`;
      trail.push({ label: segment, path: at });
    }
    trail.forEach((place: { label: string; path: string }, index: number): void => {
      // A separator between segments; the root's own `/` is the first
      // segment and needs none after it.
      if (index > 0 && trail[index - 1]?.label !== '/') header.append('/');
      const last: boolean = index === trail.length - 1;
      const crumb: HTMLElement = document.createElement(last ? 'span' : 'button');
      crumb.className = last ? 'files-crumb files-crumb-here' : 'files-crumb';
      crumb.textContent = place.label;
      crumb.dataset['path'] = place.path;
      if (!last) {
        crumb.title = `go to ${place.path}`;
        crumb.addEventListener('click', (event: MouseEvent): void => {
          event.stopPropagation();
          this.activate({ kind: 'dir', path: place.path });
        });
      }
      header.appendChild(crumb);
    });
    return header;
  }

  /**
   * Makes a place a ceiling: there the updir row is the way out of the
   * browser's context (a node the operator dived into), and reads as the
   * word given instead of `..`. The host decides what pressing it does.
   *
   * @param path - The ceiling, or null for none.
   * @param word - What the updir row reads at the ceiling.
   */
  public ceiling_set(path: string | null, word: string = '..'): void {
    this.ceiling = path === null ? null : { path: path.replace(/\/+$/, '') || '/', word };
  }

  /**
   * Tells the browser where home is: the session's `/home/<user>`. The
   * trail starts there and the `~` row goes there; a change repaints the
   * listing on stage.
   *
   * @param path - The home directory, or null while no one is logged in.
   */
  public home_set(path: string | null): void {
    if (path === this.home) return;
    this.home = path;
    if (!this.contentShown && this.lastListings.length > 0) this.listings_render(this.lastListings);
  }

  /**
   * One block: a header, the updir as a lead row (except at the root), and
   * a row per entry.
   *
   * @param listing - The listed directory.
   * @returns The block.
   */
  private block_of(listing: FsListing): ListingBlock<FileRow> {
    const header: HTMLElement = this.crumbs_build(listing.path);
    const rows: FileRow[] = listing.items.map((entry: FsListingEntry): FileRow => ({
      entry,
      path: path_join(listing.path, entry.name),
      updir: false,
    }));
    // Navigation goes both ways: every listing below the root leads with an
    // updir row, lowering to the same `cd ..` an operator would type. Above
    // it, anywhere but home itself, the way home: one press where HOME on
    // the frame costs two. A catalogue is a picker over /bin, not a place
    // to walk from, and leads with neither.
    const lead: FileRow[] = [];
    if (!this.catalogue && this.home !== null && listing.path !== this.home) {
      lead.push({ entry: { name: '~', type: 'dir', size: 0, owner: '', date: '' }, path: this.home, updir: true, home: true });
    }
    if (listing.path !== '/') {
      // At a ceiling the way up is the way out, and says so (EXIT NODE).
      const word: string = this.ceiling !== null && this.ceiling.path === listing.path ? this.ceiling.word : '..';
      lead.push({ entry: { name: word, type: 'dir', size: 0, owner: '', date: '' }, path: parentPath_of(listing.path), updir: true });
    }
    return { key: listing.path, header, lead, rows };
  }

  /**
   * The RECENT block: the lately-run executables that /bin lists, in run
   * order, keyed under `/bin/recent` so each row is its own row beside the
   * same entry lower down. No lead row: it is not a place to go up from.
   *
   * @param bin - The /bin listing on stage.
   * @returns The block, or null when none of the recent names is listed.
   */
  private recentBlock_of(bin: FsListing): ListingBlock<FileRow> | null {
    const byName: Map<string, FsListingEntry> = new Map(bin.items.map((entry: FsListingEntry): [string, FsListingEntry] => [entry.name, entry]));
    const rows: FileRow[] = [];
    for (const name of this.recent ?? []) {
      const entry: FsListingEntry | undefined = byName.get(name);
      if (entry !== undefined) rows.push({ entry, path: path_join(RECENT_PATH, name), updir: false });
    }
    if (rows.length === 0) return null;
    const header: HTMLElement = document.createElement('header');
    header.className = 'files-path files-recent';
    header.textContent = 'RECENT';
    return { key: RECENT_PATH, header, lead: [], rows };
  }

  /**
   * Paints one block as cards (or cards with previews): the projection is
   * a mode, so the same rows, the same order and the same activation are
   * drawn another way. The rows arrive from the façade already ordered.
   *
   * @param block - The block, its rows already sorted and filtered.
   * @param into - The block's section element.
   */
  private cards_paint(block: ListingBlock<FileRow>, into: HTMLElement): void {
    const withPreview: boolean = this.viewMode === 'preview';
    const cards: HTMLElement = document.createElement('div');
    cards.className = withPreview ? 'files-cards files-previews' : 'files-cards';
    for (const lead of block.lead ?? []) {
      const up: HTMLElement = document.createElement('article');
      up.className = lead.home === true ? 'files-card files-card-up files-card-home files-activatable' : 'files-card files-card-up files-activatable';
      up.textContent = lead.home === true ? `${HOME_GLYPH} ~` : '▴ ..';
      up.addEventListener('click', (): void => this.activate({ kind: 'dir', path: lead.path }));
      cards.appendChild(up);
    }
    const parentPath: string = block.key;
    for (const row of block.rows) cards.appendChild(this.card_build(parentPath, row.entry, withPreview));
    into.appendChild(cards);
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
    this.listing.state_refresh();
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
   * The body this panel draws into — the host of the pane's one mode frame.
   *
   * @returns The body element, or null for a panel mounted outside one.
   */
  private body_get(): HTMLElement | null {
    return this.container.closest<HTMLElement>('.files-body');
  }

  /**
   * Declares whether a diagram holds the field.
   *
   * The pane has ONE mode frame and its blocks answer to what is on stage,
   * so this has exactly one owner. It was briefly toggled at the two places
   * that open and close a content view, and leaked: a listing arriving on
   * its own — the cwd-follow re-listing, a refresh — replaces the content
   * without either of them running, and the frame was left offering a
   * graph's modes over a list of files.
   *
   * @param on - True when a diagram is what the field holds.
   */
  private diagram_declare(on: boolean): void {
    this.body_get()?.classList.toggle('diagram-shown', on);
    if (!on) this.mode_annunciate(this.viewMode === 'list' ? '' : this.viewMode.toUpperCase());
  }

  /**
   * Writes what the bar says about the modes in force.
   *
   * @param text - The annunciation, or an empty string for the default.
   */
  public mode_annunciate(text: string): void {
    if (this.modeSpan !== null) this.modeSpan.textContent = text;
  }

  /**
   * Composes the state line: what the browser is bound to, then what it
   * shows. CWD and STALE are the pane's own; the filter and the selection
   * counts come from the façade's parts.
   *
   * @param parts - The façade's typed state parts.
   * @returns The line.
   */
  private stateLine_compose(parts: ListingStateParts): string {
    const words: string[] = [];
    if (this.following) words.push('CWD');
    if (parts.selecting) words.push('SELECT');
    words.push(this.stale ? 'STALE' : parts.filter);
    if (parts.selected > 0) {
      // How many are selected, and — when a filter hides some of them —
      // how many of those the operator can currently see, since a verb over
      // a selection acts on all of it and not on what is on screen.
      words.push(parts.shown === parts.selected
        ? `${parts.selected} SELECTED`
        : `${parts.selected} SELECTED · ${parts.shown} SHOWN`);
    }
    return words.filter((word: string): boolean => word !== '').join(' · ');
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
    const kind: FileAction['kind'] | null = actionKind_of(item);
    if (kind !== null) {
      card.classList.add('files-activatable');
      card.addEventListener('click', (): void => this.activate({ kind, path }));
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
    // A DICOM series (a folder named as oxidicom names one) or one of its
    // files shows a modality glyph, never a thumbnail: a thumbnail would
    // cost a fetch and a decode per card, and the glyph says what a card
    // needs to say — this opens as an image.
    if (SERIES_FOLDER_PATTERN.test(item.name) || DICOM_FILE_PATTERN.test(item.name)) {
      thumb.classList.add('thumb-series');
      const mark: HTMLSpanElement = document.createElement('span');
      mark.className = 'thumb-series-mark';
      mark.textContent = 'DCM';
      const description: string | undefined = /^\d+-(.*)-[0-9a-f]{7}$/.exec(item.name)?.[1];
      thumb.replaceChildren(mark);
      if (description !== undefined) {
        const text: HTMLSpanElement = document.createElement('span');
        text.className = 'thumb-series-text';
        text.textContent = description.replace(/_/g, ' ');
        thumb.appendChild(text);
      }
      return thumb;
    }
    if (this.preview === null || !(item.type === 'file' || item.type === 'plugin' || item.type === 'pipeline')) {
      glyph();
      return thumb;
    }
    if (item.type === 'plugin') {
      // A plugin IS a graph — the one-node case — so its card carries that
      // node, drawn by the same layout a pipeline's card uses. It costs no
      // fetch: a plugin has one node whatever it turns out to declare, and
      // the card used to spend a `cat` per entry to print a paragraph.
      thumb.replaceChildren(graphSvg_build([{ id: path, parentIds: [] }]));
      return thumb;
    }
    if (item.type === 'pipeline') {
      const binProvider: PreviewProvider = this.preview;
      thumb.classList.add('thumb-wait');
      thumb.textContent = TYPE_GLYPHS[item.type];
      const loadBin = (): void => {
        void binProvider.pipelineGlimpse(path).then((nodes: GlimpseNode[] | null): void => {
          thumb.classList.remove('thumb-wait');
          if (nodes === null || nodes.length === 0) { glyph(); return; }
          if (nodes.length > GLIMPSE_NODE_MAX) { thumb.textContent = `${nodes.length} NODES`; thumb.classList.add('thumb-count'); return; }
          thumb.replaceChildren(graphSvg_build(nodes));
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

  /** Shows or hides the filter strip (the mode frame's FILTER, or `file filter`). */
  public filter_toggle(open?: boolean): void {
    this.listing.filter_toggle(open);
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
