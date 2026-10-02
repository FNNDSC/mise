/**
 * @file Inside a node: the camera has flown into a sphere of the DAG (or
 * the universe's entered feed), and a rooted browser of the node's data
 * stands over the canvas. The overlay IS the pane transformed — same id,
 * same group — so file clicks write the pane's regard and slaved viewers
 * follow. Esc, EXIT NODE and the way up all reverse the dolly.
 *
 * A module of the host: the host hands in its files-body stamp, its rooted
 * listing, its row verbs and its file readers as hooks; the overlay keeps
 * the records, by pane.
 */
import { extension_isImage, FilesPanel, type FileAction, type FsListingEntry, type PreviewProvider } from '../features/files/panel.js';
import type { ListingAction } from '../features/roster/row.js';
import type { HostContext } from './hostContext.js';

/** A file read through the session: whether it could be, and its text (or the refusal). */
export interface FileText {
  ok: boolean;
  text: string;
}

/** What the overlay asks of the host. */
export interface NodeOverlayHooks {
  /** A files body stamped from the template: the frame, the caps grid, the panel mount. */
  filesBody_stamp: () => HTMLElement;
  /** Shows a listing in a pane's browser, rooted. */
  rootedListing_show: (id: string, panel: FilesPanel, path: string) => void;
  /** The verbs a row is offered, the same roster the browser uses. */
  rowVerbs_of: (id: string, entry: FsListingEntry, path: string) => ReadonlyArray<ListingAction<FsListingEntry>>;
  /** Opens imagery beside the pane, joined to its group; answers a line for the console. */
  image_open: (fromId: string, path: string) => Promise<string>;
  /** Whether a path is imagery the viewer opens (a volume, a series). */
  imagery_is: (path: string) => boolean;
  /** Whether a path is a table (every table on this surface is a listing). */
  tableFile_is: (path: string) => boolean;
  /** The byte route for a path. */
  vfsUrl_build: (path: string) => string;
  /** Reads a file's text through the session. */
  fileText_fetch: (path: string) => Promise<FileText>;
  previewProvider: PreviewProvider;
}

/** The overlay verbs a wired host has. */
export interface NodeOverlay {
  /** Opens the node's browser over a pane's canvas; flies back out when it cannot. */
  open: (id: string, vfsPath: string) => void;
  /** Closes a pane's overlay, flying back out; calls back when the camera is home. */
  close: (id: string, onDone?: () => void) => void;
  /** BACK inside the node: the previous listing, when there is one. */
  back: (id: string) => void;
  /**
   * Esc with an overlay up: a file view returns to the node's listing, a
   * listing leaves the node. Directory depth inside the node stays BACK's.
   *
   * @returns Whether an overlay took the key.
   */
  escape: () => boolean;
  /** A pane is disposed: its overlay's element goes with it, no flight. */
  dispose: (id: string) => void;
}

/** One pane's overlay: the element over the canvas, the browser in it, the listings it walked. */
interface OverlayRecord {
  element: HTMLElement;
  panel: FilesPanel;
  history: string[];
}

/**
 * Wires the node overlay to a host.
 *
 * @param context - The panels (the scene a pane flies in), the pane mounts, the subjects, the sound and the console.
 * @param hooks - The host's files body, listing, verbs and readers.
 * @returns The overlay verbs.
 */
export function nodeOverlay_wire(context: Pick<HostContext, 'panels' | 'paneInstance_get' | 'subjects' | 'sound' | 'terminal'>, hooks: NodeOverlayHooks): NodeOverlay {
  const { panels, paneInstance_get, subjects } = context;
  const records: Map<string, OverlayRecord> = new Map();

  /** The scene a pane flies in: the DAG pane's or the universe's. */
  const flier_of = (id: string): { flight_back: (onDone: () => void) => void; node_flyTo: (instanceID: number) => boolean } | undefined =>
    panels.get('dag', id) ?? panels.get('universe', id);

  const close = (id: string, onDone?: () => void): void => {
    const record: OverlayRecord | undefined = records.get(id);
    if (record === undefined) {
      onDone?.();
      return;
    }
    records.delete(id);
    record.element.classList.remove('node-overlay-open');
    const finish = (): void => {
      record.element.remove();
      onDone?.();
    };
    const flier = flier_of(id);
    if (flier !== undefined) flier.flight_back(finish);
    else finish();
  };

  /** What a click on a row inside the node does: a walk, a hop, an exit, or a file shown. */
  const action_take = (id: string, vfsPath: string, panel: FilesPanel, history: string[], action: FileAction): void => {
    if (action.kind === 'dir') {
      // Above the node's own root is outside the node: the way up is the
      // way out (the updir row there reads EXIT NODE), never a walk out of
      // the graph into /proc — nor a hop, since `feed_<id>` looks like one.
      const root: string = vfsPath.replace(/\/+$/, '');
      if (action.path !== root && !action.path.startsWith(`${root}/`)) {
        close(id);
        context.sound('audio3');
        return;
      }
      // A descendant plugin instance is a node of the same graph: the
      // experience is a hop — fly out of this node, fly into that one —
      // never a directory descent that leaves the graph behind.
      const instMatch: RegExpMatchArray | null =
        action.path.startsWith('/proc/jobs/') ? (action.path.split('/').pop() ?? '').match(/_(\d+)$/) : null;
      if (instMatch !== null) {
        const instanceID: number = parseInt(instMatch[1] ?? '', 10);
        close(id, (): void => {
          if (flier_of(id)?.node_flyTo(instanceID) !== true) {
            // Not a node of this graph after all: fall back to descent.
            open(id, action.path);
          }
        });
        return;
      }
      const previous: string | null = panel.path_current();
      if (previous !== null) history.push(previous);
      hooks.rootedListing_show(id, panel, action.path);
      return;
    }
    // A file click inside the node is an indication on the DAG pane's own
    // group (the overlay shares its identity), feeding any slaved viewer.
    subjects.regard_write(id, { address: action.path, modelKind: 'fs.file' });
    if (subjects.groupHasViewer(id)) return;
    // A run's own output is usually a volume, and a volume is an image:
    // it opens beside the graph, joined to its group, exactly as it does
    // from the browser. Reading it as text is what the kernel refuses.
    if (hooks.imagery_is(action.path)) {
      void hooks.image_open(id, action.path).then((line: string): void => context.terminal.line_note(line));
      return;
    }
    if (extension_isImage(action.path)) {
      panel.contentImage_show(action.path, hooks.vfsUrl_build(action.path));
      return;
    }
    void hooks.fileText_fetch(action.path).then((read: FileText): void => {
      if (!read.ok) {
        panel.contentRefused_show(action.path, read.text);
        return;
      }
      // A CSV is a table, and every table on this surface is a listing.
      if (hooks.tableFile_is(action.path)) panel.contentTable_show(action.path, read.text);
      else panel.content_show(action.path, read.text);
    });
  };

  const open = (id: string, vfsPath: string): void => {
    const mount: HTMLElement | undefined = paneInstance_get(id)?.mount;
    const canvas: HTMLElement | null = mount?.querySelector<HTMLElement>('.dag-canvas, .universe-canvas') ?? null;
    // A record whose element is no longer in the document is a ghost: the
    // pane was rebuilt (a layout change, a preset) while a node was open,
    // which takes the overlay's DOM with it and leaves this map holding a
    // dead reference. That reference then refused EVERY later dive on this
    // pane — and a refused dive is not nothing, because the camera has
    // already flown inside. One wedged pane looked like a broken viewer.
    const held: OverlayRecord | undefined = records.get(id);
    if (held !== undefined && !held.element.isConnected) records.delete(id);
    if (canvas === null || records.has(id)) {
      // By the time this runs the camera is already INSIDE the node — the
      // fly-in dollies to just shy of its surface, which is the whole point
      // of the gesture. Returning quietly therefore does not cancel a dive;
      // it strands the operator looking at the inside of a sphere, filling
      // the pane with one flat colour, with the scene held so nothing even
      // moves. It reads exactly like a crash, and an operator reported it
      // as one. So: fly back out, and say what happened.
      context.terminal.line_note(
        `dag: ${vfsPath}: ${canvas === null ? 'this pane has no scene to fly in' : 'a node is already open here'} — flew back out`,
      );
      flier_of(id)?.flight_back((): void => undefined);
      return;
    }
    const element: HTMLElement = document.createElement('div');
    element.className = 'node-overlay';
    element.setAttribute('aria-label', `inside ${vfsPath}`);
    // The node's browser is a files body like any other: the same frame
    // (rule, elbow, spine, mode bar) and the same caps grid. It covers the
    // pane's own frame, so one frame stands — a strip of its own above it
    // left the pane's elbow hanging beside it, and the breadcrumb already
    // says where inside the node the operator is.
    const body: HTMLElement = hooks.filesBody_stamp();
    body.classList.add('node-overlay-body');
    // The way out is a control on the frame, first among the field's verbs
    // and beside BACK: a phone has no Esc. It leaves the node, as its word
    // says, from wherever inside it; Esc keeps its gentler first step back
    // to the listing.
    const exit: HTMLButtonElement = document.createElement('button');
    exit.type = 'button';
    exit.className = 'strategy-pill node-overlay-exit';
    exit.title = 'leave the node (Esc)';
    exit.textContent = 'EXIT NODE';
    body.querySelector('.mode-frame')?.prepend(exit);
    element.append(body);
    const panelMount: HTMLElement | null = body.querySelector<HTMLElement>('.files-panel');
    if (panelMount === null) throw new Error('pane template is missing .files-panel');
    const history: string[] = [];
    const panel: FilesPanel = new FilesPanel(panelMount, (action: FileAction): void => action_take(id, vfsPath, panel, history, action), hooks.previewProvider);
    // A listing inside a node is a listing. Declaring no row verbs left the
    // façade with nothing to hide behind an indication, so it kept its old
    // bargain — one click activates — and the node's browser alone behaved
    // unlike every other listing on the surface: a click walked into the
    // row instead of indicating it, and the frame never opened. The verbs
    // are the same ones the browser offers, computed by the same roster, so
    // a node's own `data` is offered PROCESS here exactly as it is outside.
    panel.rowVerbs_declare(
      (entry: FsListingEntry, path: string) => hooks.rowVerbs_of(id, entry, path),
      (_entry: FsListingEntry, path: string): void => {
        // Indicating IS the regard, on the DAG pane's own group: the
        // overlay shares its identity, so a slaved viewer follows.
        subjects.regard_write(id, { address: path, modelKind: 'fs.file' });
      },
    );
    records.set(id, { element, panel, history });
    panel.ceiling_set(vfsPath, 'EXIT NODE');
    exit.addEventListener('click', (): void => {
      close(id);
      context.sound('audio3');
    });
    canvas.appendChild(element);
    window.requestAnimationFrame((): void => element.classList.add('node-overlay-open'));
    hooks.rootedListing_show(id, panel, vfsPath);
  };

  const back = (id: string): void => {
    const record: OverlayRecord | undefined = records.get(id);
    const previous: string | undefined = record?.history.pop();
    if (record !== undefined && previous !== undefined) hooks.rootedListing_show(id, record.panel, previous);
  };

  const escape = (): boolean => {
    const overlayId: string | undefined = [...records.keys()].pop();
    if (overlayId === undefined) return false;
    // Inside a node, a file view is a level of its own: the first Esc
    // returns to the node's listing, the next leaves the node. Directory
    // depth inside the node stays BACK's job — it is not visible, and Esc
    // never walks invisible depth.
    const record: OverlayRecord | undefined = records.get(overlayId);
    if (record !== undefined && record.panel.content_isShown()) record.panel.listing_restore();
    else close(overlayId);
    return true;
  };

  const dispose = (id: string): void => {
    records.get(id)?.element.remove();
    records.delete(id);
  };

  return { open, close, back, escape, dispose };
}
