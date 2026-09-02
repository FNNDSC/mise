/**
 * @file ARGUS composition: attach, then wire the console and instruments.
 *
 * One page, one session, two projections: the indwelling terminal renders
 * the session's ANSI stream, and the Files instrument renders its envelope
 * models. This module owns the wiring only — the attach handshake, the
 * drawer mechanics, and the lowering of graphical gestures to session
 * commands — with each instrument behind its own module.
 *
 * The attach token arrives as a `?token=` query parameter (printed by
 * `chell --daemon`) or is pasted into the attach form. The WebSocket URL
 * defaults to the serving origin, since the daemon serves this bundle and
 * the wire from one port; a `?ws=` parameter overrides it for the dev
 * server case.
 *
 * @module
 */
import type { PromptContext, WireEnvelope } from '@fnndsc/menu';
import {
  ArgusClient,
  type AttachInfo,
  type ExecuteOutcome,
  type OutputChannel,
  type ProgressMessage,
} from '../calypso/client.js';
import { ArgusTerminal } from '../console/terminal.js';
import { ArgusProgress } from '../console/progress.js';
import { FilesPanel, type FileAction, type FsListing } from '../features/files/panel.js';
import { DagPanel } from '../features/dag/panel.js';
import { PacsPanel } from '../features/pacs/panel.js';
import { EmptyPanel, type ClaimKind } from '../features/empty/panel.js';
import { ViewerPanel } from '../features/view/panel.js';
import { SubjectBus, type RegardValue } from './subjects.js';
import { StatusBar } from './status.js';
import { Cascade } from './cascade.js';
import { PipelineCycler } from './cycler.js';
import { argusLine_run, type ArgusHost } from '../console/argusLang.js';

/** Console zoom, exposed for the language (the bar carries no control). */
let consoleZoom_set: (pane: string | null) => void = () => undefined;
export function consoleZoom_toggle(): void {
  consoleZoom_set(document.body.dataset['zoom'] === 'console' ? null : 'console');
}
import {
  paneFactory_register,
  paneInstance_adopt,
  paneInstance_create,
  paneInstance_dispose,
  paneInstance_get,
  paneInstances_list,
  type PaneInstance,
} from './panes.js';
import { LayoutManager, type LayoutNode } from './layout.js';
import '../lcars/theme/lower-decks.css';
import '../lcars/argus.css';

/** The greeting written above the first prompt. */
const BANNER_LINES: string[] = [
  '\x1b[38;5;214mARGUS\x1b[0m — LCARS web console for mise',
  '\x1b[38;5;245mtwo projections of one CALYPSO session: type below, watch the instruments\x1b[0m',
  '',
];

/** The localStorage key remembering the operator's audio choice. */
const AUDIO_STORAGE_KEY: string = 'argus-audio';

/** The panel beeps' volume; the theme's files are mastered hot. */
const AUDIO_VOLUME: number = 0.4;

/** Whether the panel beeps are muted; the audio pill owns this. */
let audioMuted: boolean = false;

/**
 * Plays one of the page's LCARS beeps, silently tolerating autoplay refusal.
 * The audio pill can mute the whole voice.
 *
 * @param audioId - The id of the audio element to play.
 */
function sound_play(audioId: string): void {
  if (audioMuted) {
    return;
  }
  const audio: HTMLElement | null = document.getElementById(audioId);
  if (audio instanceof HTMLAudioElement) {
    audio.currentTime = 0;
    audio.volume = AUDIO_VOLUME;
    void audio.play().catch((): void => undefined);
  }
}

/**
 * Wires the audio pill: green means the panel voice is live, red means
 * muted. The choice persists per browser.
 */
function audioPill_wire(): void {
  const pill: HTMLElement = element_require('audio-pill');
  try {
    audioMuted = window.localStorage.getItem(AUDIO_STORAGE_KEY) === 'off';
  } catch {
    audioMuted = false;
  }
  const paint: () => void = (): void => {
    pill.classList.toggle('audio-off', audioMuted);
  };
  paint();
  pill.addEventListener('click', (): void => {
    audioMuted = !audioMuted;
    try {
      window.localStorage.setItem(AUDIO_STORAGE_KEY, audioMuted ? 'off' : 'on');
    } catch {
      // A browser without storage still gets the session-long choice.
    }
    paint();
    // Unmuting speaks; muting is, fittingly, silent.
    sound_play('audio2');
  });
}

/**
 * Fetches a required element by id.
 *
 * @param id - The element id.
 * @returns The element.
 * @throws {Error} When the element does not exist.
 */
function element_require(id: string): HTMLElement {
  const element: HTMLElement | null = document.getElementById(id);
  if (element === null) {
    throw new Error(`required element #${id} is missing`);
  }
  return element;
}

/**
 * Stamps one pane element from a template.
 *
 * @param templateId - The template's id.
 * @returns The cloned pane element, not yet in the document.
 * @throws {Error} When the template is missing or empty.
 */
function template_stamp(templateId: string): HTMLElement {
  const template: HTMLElement = element_require(templateId);
  if (!(template instanceof HTMLTemplateElement)) {
    throw new Error(`#${templateId} is not a template`);
  }
  const first: Element | null = template.content.firstElementChild;
  if (!(first instanceof HTMLElement)) {
    throw new Error(`template #${templateId} is empty`);
  }
  return first.cloneNode(true) as HTMLElement;
}

/**
 * Finds a required descendant of a stamped pane.
 *
 * @param mount - The pane element.
 * @param selector - The descendant's selector.
 * @returns The element.
 * @throws {Error} When absent.
 */
function pane_find(mount: HTMLElement, selector: string): HTMLElement {
  const found: HTMLElement | null = mount.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`pane template is missing ${selector}`);
  }
  return found;
}

/**
 * Resolves the daemon WebSocket URL: `?ws=` override first, else the origin
 * that served this page.
 *
 * @returns The WebSocket URL.
 */
function wsUrl_resolve(): string {
  const override: string | null = new URLSearchParams(window.location.search).get('ws');
  if (override !== null && override.length > 0) {
    return override;
  }
  return `ws://${window.location.host}`;
}

/**
 * Wires the tactical drawer: the lid's bar-10 segment toggles the console,
 * the mars pill retracts it, and the access strip drag-resizes it. The
 * bar-10 segment beckons while the drawer is closed, and stops the moment
 * attention belongs to the open console, per the prototype's design.
 *
 * @param drawer - The drawer element containing the terminal.
 * @param strip - The access strip below the terminal (drag to resize).
 * @param toggle - The lid's bar-10 segment (click to toggle).
 * @param close - The mars close pill in the drawer header.
 * @param terminal - The terminal to refit after size changes.
 */
function drawer_wire(
  drawer: HTMLElement,
  strip: HTMLElement,
  toggle: HTMLElement,
  terminal: ArgusTerminal,
): void {
  // A drag leaves an inline height on the drawer, which would defeat the
  // closed class; stash it while closed and restore it on reopen.
  let openHeight: string = '';
  const closed_set = (closed: boolean): void => {
    if (closed) {
      openHeight = drawer.style.height;
      drawer.style.height = '';
    } else if (openHeight !== '') {
      drawer.style.height = openHeight;
    }
    // The closed-state beckon is pure CSS on the lid's end block
    // (#drawer.drawer-closed ~ .bar-panel .bar-10). Stamping a filter class
    // on the whole bar here made every segment pulse against the static
    // elbow arm it joins.
    drawer.classList.toggle('drawer-closed', closed);
    sound_play('audio3');
    if (!closed) {
      terminal.size_fit();
      terminal.focus_take();
    }
  };

  toggle.addEventListener('click', (): void =>
    closed_set(!drawer.classList.contains('drawer-closed')),
  );

  let dragStartY: number = 0;
  let dragStartHeight: number = 0;
  let dragging: boolean = false;
  strip.addEventListener('mousedown', (event: MouseEvent): void => {
    dragging = true;
    dragStartY = event.clientY;
    dragStartHeight = drawer.getBoundingClientRect().height;
    // Dragging steers the height directly; the zoom transition would lag it.
    drawer.classList.add('drawer-dragging');
    event.preventDefault();
  });
  window.addEventListener('mousemove', (event: MouseEvent): void => {
    if (!dragging) {
      return;
    }
    // The strip floats above the lid, so pulling it down grows the console.
    const height: number = Math.max(120, dragStartHeight + (event.clientY - dragStartY));
    drawer.style.height = `${height}px`;
    terminal.size_fit();
  });
  window.addEventListener('mouseup', (): void => {
    dragging = false;
    drawer.classList.remove('drawer-dragging');
  });
}

/**
 * Wires pane zoom: any control carrying data-pane names a pane, and
 * activating it zooms that pane to the full viewport — the gutter glides
 * off stage left, the header off stage top. Esc (or the same control
 * again) restores the composition, which zoom never touches: zoom is a
 * modifier over the layout, not a layout of its own.
 *
 * @param terminal - The terminal to refit once the glide settles.
 */
function zoom_wire(terminal: ArgusTerminal): (pane: string | null) => void {
  const body: HTMLElement = document.body;
  const header: HTMLElement | null = document.querySelector<HTMLElement>('.wrap:not(#gap)');

  const zoom_set = (pane: string | null): void => {
    for (const marked of document.querySelectorAll('.pane-zoomed, .pane-zoomed-path')) {
      marked.classList.remove('pane-zoomed', 'pane-zoomed-path');
    }
    if (pane === null) {
      delete body.dataset['zoom'];
    } else {
      // A scrolled page would carry its offset into the clamped zoom view,
      // hiding the pane's top edge; zoom always starts from the origin.
      window.scrollTo(0, 0);
      // The header's height is content-driven; measure its viewport bottom
      // (not offsetHeight — the first bar's top margin collapses OUT of the
      // wrap, and an offsetHeight slide left that margin's worth of header
      // crushed on stage).
      if (header !== null) {
        body.style.setProperty('--zoom-header-height', `${header.getBoundingClientRect().bottom}px`);
      }
      body.dataset['zoom'] = pane;
      // A tree pane's zoom marks its leaf AND the split path above it:
      // hiding siblings alone left the leaf imprisoned in its old cell
      // (half a pane of graph, half a pane of nothing) — every ancestor
      // box on the path must also yield its full region.
      const mount: HTMLElement | undefined = paneInstance_get(pane)?.mount;
      const leaf: HTMLElement | null = mount?.parentElement ?? null;
      leaf?.classList.add('pane-zoomed');
      let ancestor: HTMLElement | null = leaf?.parentElement ?? null;
      while (ancestor !== null && ancestor.id !== 'layout-root') {
        ancestor.classList.add('pane-zoomed-path');
        ancestor = ancestor.parentElement;
      }
    }
    // The capsule is a toggle and must read as its next action.
    for (const capsule of document.querySelectorAll<HTMLElement>('.drawer-zoom')) {
      capsule.textContent = pane !== null && capsule.dataset['pane'] === pane ? 'RESTORE' : 'ZOOM';
    }
    sound_play('audio3');
  };
  // While zoomed, the thin top strip is the restore control (the
  // header-away listener yields to the zoom state).
  element_require('header-restore').addEventListener('click', (): void => {
    if (body.dataset['zoom'] !== undefined) {
      zoom_set(null);
    }
  });

  // Delegated: pane instances (and their zoom capsules) arrive live.
  document.addEventListener('click', (event: Event): void => {
    const target: EventTarget | null = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const control: HTMLElement | null = target.closest<HTMLElement>('[data-pane]');
    if (control === null) {
      return;
    }
    const pane: string = control.dataset['pane'] ?? '';
    if (pane === '') {
      return;
    }
    zoom_set(body.dataset['zoom'] === pane ? null : pane);
  });

  window.addEventListener('keydown', (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && body.dataset['zoom'] !== undefined) {
      zoom_set(null);
      // One press, one level: the header-restore listener must not also
      // consume this Esc.
      event.stopImmediatePropagation();
    }
  });

  element_require('drawer').addEventListener('transitionend', (event: Event): void => {
    if ((event as TransitionEvent).propertyName === 'height') {
      terminal.size_fit();
    }
  });
  return zoom_set;
}

/**
 * Builds the top frame's data cascade, live from boot, and binds the
 * labeled telemetry face beside it.
 *
 * @returns The cascade, or null when the page has no cascade element.
 */
function cascade_build(): Cascade | null {
  // The ambient number grid has retired; the class remains the keeper of
  // the labeled telemetry rows in the stats face.
  const cascadeInstance: Cascade = new Cascade(document.getElementById('data-cascade'));
  const telemetryFace: HTMLElement | null = document.getElementById('header-telemetry');
  if (telemetryFace !== null) {
    cascadeInstance.telemetryPanel_bind(telemetryFace);
  }
  return cascadeInstance;
}

/**
 * Wires the header faces. The two gutter-top buttons SELECT: ARGUS WEB
 * shows the live stats/controls/versions face, 02-CALYPSO the pipeline
 * DAG cycler (also the resting face).
 * Pressing the already-selected button sends the whole header gliding off
 * the top, leaving the lid strip; the strip (or Esc) restores it to the
 * cascade. One declaration (`data-header` on the body) carries the state:
 * absent (cascade), 'stats', 'versions', or 'away'.
 */
function headerFaces_wire(): void {
  const body: HTMLElement = document.body;
  const header: HTMLElement | null = document.querySelector<HTMLElement>('.wrap:not(#gap)');

  const face_select = (face: string): void => {
    if (body.dataset['header'] === face) {
      // Second press on the selected face: the header itself departs. The
      // slide distance is its measured height, same as the zoom glide.
      if (header !== null) {
        body.style.setProperty('--zoom-header-height', `${header.offsetHeight}px`);
      }
      body.dataset['header'] = 'away';
    } else {
      body.dataset['header'] = face;
    }
  };
  document.querySelector('.panel-1')?.addEventListener('click', (): void => face_select('stats'));
  document.querySelector('.panel-2')?.addEventListener('click', (): void => face_select('dag'));

  const header_restore = (): void => {
    if (body.dataset['zoom'] !== undefined) {
      // The strip belongs to the zoom while one is active.
      return;
    }
    delete body.dataset['header'];
    sound_play('audio3');
  };
  element_require('header-restore').addEventListener('click', header_restore);
  window.addEventListener('keydown', (event: KeyboardEvent): void => {
    // Esc restores the header, but a zoomed pane's Esc comes first.
    if (
      event.key === 'Escape' &&
      body.dataset['header'] === 'away' &&
      body.dataset['zoom'] === undefined
    ) {
      header_restore();
    }
  });
}

/** The LCARS color schemes the theme pill cycles through. */
const LCARS_SCHEMES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'lower-decks', label: 'LOWER DECKS' },
  { key: 'gold', label: 'CERRITOS GOLD' },
  { key: 'sickbay', label: 'SICKBAY' },
  { key: 'nemesis', label: 'NEMESIS' },
];

/** The localStorage key remembering the color scheme. */
const LCARS_STORAGE_KEY: string = 'argus-lcars';

/**
 * Wires the theme pill: each press advances to the next LCARS color scheme.
 * The scheme is one declaration (`data-lcars` on the body); the palettes
 * live in CSS. The choice persists per browser.
 */
function themePill_wire(): void {
  const pill: HTMLElement = element_require('theme-pill');
  let index: number = 0;
  try {
    const saved: string | null = window.localStorage.getItem(LCARS_STORAGE_KEY);
    const found: number = LCARS_SCHEMES.findIndex((scheme): boolean => scheme.key === saved);
    index = found >= 0 ? found : 0;
  } catch {
    index = 0;
  }
  // The scheme lives on the root element: the theme's derived variables
  // (--panel-4-color and kin) are resolved where they are defined — :root —
  // so a body-level override would leave them holding the original palette.
  const root: HTMLElement = document.documentElement;
  const paint = (): void => {
    const scheme = LCARS_SCHEMES[index] ?? LCARS_SCHEMES[0]!;
    if (scheme.key === 'lower-decks') {
      delete root.dataset['lcars'];
    } else {
      root.dataset['lcars'] = scheme.key;
    }
    pill.textContent = scheme.label;
  };
  paint();
  pill.addEventListener('click', (): void => {
    index = (index + 1) % LCARS_SCHEMES.length;
    paint();
    try {
      window.localStorage.setItem(LCARS_STORAGE_KEY, LCARS_SCHEMES[index]?.key ?? 'lower-decks');
    } catch {
      // A browser without storage still gets the session-long choice.
    }
    sound_play('audio2');
  });
}

/**
 * Fills the about face: the mise stack and its versions, this bundle's
 * git hash and build time, the wire contract, and the page's credits.
 *
 * @param attach - The attach ack, carrying the daemon's stack report.
 */
function aboutFace_fill(attach: AttachInfo): void {
  // The rows container only: the face's static footer (the attribution,
  // moved up from the page bottom) stays untouched.
  const face: HTMLElement | null = document.getElementById('about-rows');
  if (face === null) {
    return;
  }
  face.replaceChildren();
  const stack: Record<string, string | undefined> = {
    cumin: attach.stack?.cumin,
    salsa: attach.stack?.salsa,
    chili: attach.stack?.chili,
    brasa: attach.stack?.brasa,
    calypso: attach.stack?.calypso,
    chell: attach.stack?.chell,
  };
  const rows: Array<[string, string]> = [];
  for (const [name, version] of Object.entries(stack)) {
    if (version !== undefined) {
      rows.push([name.toUpperCase(), version]);
    }
  }
  rows.push(
    ['MENU', __ARGUS_MENU__],
    ['ARGUS', `${__ARGUS_GIT__} · ${__ARGUS_BUILT__}Z`],
    ['WIRE', `V${attach.protocolVersion}`],
  );
  if (attach.stack?.build !== undefined) {
    rows.push(['BUILD', attach.stack.build]);
  }
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
    face.appendChild(row);
  }
}

/**
 * Strips ANSI escape sequences from rendered text.
 *
 * @param text - The ANSI-decorated text.
 * @returns The plain text.
 */
function ansi_strip(text: string): string {
  return text.replace(/\x1b\[[0-9;:]*[A-Za-z]/g, '');
}

/** Extensions the panel renders as images through the /vfs route. */
const IMAGE_EXTENSIONS: Set<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']);

/**
 * Reports whether a path's extension names a browser-renderable image.
 *
 * @param filePath - The file path.
 * @returns True for image extensions.
 */
function extension_isImage(filePath: string): boolean {
  const extension: string = filePath.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(extension);
}

/**
 * Wires the LCARS panel beeps: every frame button clicks with the theme's
 * voice, live or inert alike.
 */
function panelSounds_wire(): void {
  for (const button of document.querySelectorAll('.left-frame button, .left-frame-top button')) {
    button.addEventListener('click', (): void => sound_play('audio2'));
  }
}

/**
 * Attaches to the daemon and wires every instrument to the session.
 *
 * @param token - The attach token.
 * @returns Resolves when the surface is attached and interactive.
 * @throws {Error} When the attach is refused.
 */
/** The data cascade, built at page boot and fed by the session's wiring. */
let cascade: Cascade | null = null;

async function surface_start(token: string): Promise<void> {
  const statusBar: StatusBar = new StatusBar(document);

  // Panel rosters: every live controller by instance id, for routing —
  // targeted progress, and the claim rule for console-issued models.
  const filesPanels: Map<string, FilesPanel> = new Map();
  const dagPanels: Map<string, DagPanel> = new Map();

  // The subject bus: pane linkage as hub-and-spoke subjects. Every regard
  // write also flows to the daemon as session truth (the two-layer model).
  const subjects: SubjectBus = new SubjectBus();
  subjects.writeObserver_set((value: RegardValue, groupId: string): void => {
    client.regard_send({
      address: value.address,
      ...(value.modelKind !== undefined ? { modelKind: value.modelKind } : {}),
      groupId,
      paneId: value.paneId,
    });
  });

  /** Builds the token-gated /vfs URL serving a path's bytes. */
  const vfsUrl_build = (path: string): string =>
    `/vfs?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;

  /** Fetches a file's text through a silent, pane-local cat. */
  const fileText_fetch = (path: string): Promise<string> =>
    client
      .line_execute(`cat "${path}"`, { silent: true, observe: false })
      .then((outcome: ExecuteOutcome): string =>
        ansi_strip(outcome.envelopes.map((envelope): string => envelope.rendered).join('\n')),
      );

  // Lowers a file activation. The primary browser is slaved to the session
  // cwd and navigates by real `cd`; a rooted browser (a split's instance)
  // navigates independently by targeted silent listings. A file activation
  // is an indication: it writes the pane's group regard, and when the group
  // holds a viewer, the viewer renders it — the browser overlays its own
  // content only as the viewerless fallback.
  // A rooted browser's own navigation history, for its BACK verb; the
  // primary's back is the session's own `cd -`.
  const rootedHistory: Map<string, string[]> = new Map();

  const rootedListing_show = (id: string, panel: FilesPanel, path: string): void => {
    // A bare `~` must reach the shell unquoted or it would not expand.
    const line: string = path === '~' ? 'ls ~' : `ls "${path}"`;
    void client
      .line_execute(line, { silent: true, observe: false })
      .then((outcome: ExecuteOutcome): void => {
        for (const envelope of outcome.envelopes) {
          panel.envelope_observe(envelope);
        }
      });
  };

  const fileAction_handle = (
    id: string,
    panel: FilesPanel,
    action: FileAction,
    primary: boolean,
  ): void => {
    if (action.kind === 'dir') {
      if (primary) {
        terminal.line_run(`cd "${action.path}"`);
      } else {
        const previous: string | null = panel.path_current();
        if (previous !== null) {
          rootedHistory.get(id)?.push(previous);
        }
        rootedListing_show(id, panel, action.path);
      }
      return;
    }
    subjects.regard_write(id, { address: action.path, modelKind: 'fs.file' });
    if (subjects.groupHasViewer(id)) {
      return;
    }
    if (extension_isImage(action.path)) {
      // Images render natively from the daemon's token-gated /vfs route,
      // never as terminal strings.
      panel.contentImage_show(action.path, vfsUrl_build(action.path));
      return;
    }
    // Text renders from a silent cat, so a large file does not flood the
    // transcript.
    void fileText_fetch(action.path).then((content: string): void => {
      panel.content_show(action.path, content);
    });
  };

  // Builds one files pane instance from the template.
  const filesInstance_build = (id: string, primary: boolean): PaneInstance => {
    const mount: HTMLElement = template_stamp('tpl-pane-files');
    const panel: FilesPanel = new FilesPanel(
      pane_find(mount, '.files-panel'),
      (action: FileAction): void => fileAction_handle(id, panel, action, primary),
    );
    filesPanels.set(id, panel);
    rootedHistory.set(id, []);
    return {
      id,
      kind: 'files',
      mount,
      dispose: (): void => {
        filesPanels.delete(id);
        rootedHistory.delete(id);
        subjects.pane_leave(id);
      },
    };
  };

  // Builds one viewer pane instance: a slaved projection of its group's
  // regard. The subscription happens at spawn time, after the instance has
  // joined its group (the retained cell then replays immediately).
  const viewerPanels: Map<string, ViewerPanel> = new Map();
  const viewInstance_build = (id: string): PaneInstance => {
    const mount: HTMLElement = template_stamp('tpl-pane-view');
    const panel: ViewerPanel = new ViewerPanel(
      pane_find(mount, '.view-body'),
      pane_find(mount, '.view-title'),
      {
        content_fetch: fileText_fetch,
        imageUrl_build: vfsUrl_build,
        path_isImage: extension_isImage,
      },
    );
    viewerPanels.set(id, panel);
    return {
      id,
      kind: 'view',
      mount,
      dispose: (): void => {
        viewerPanels.delete(id);
        subjects.pane_leave(id);
      },
    };
  };

  // Builds one DAG pane instance. Only the primary follows the session cwd
  // and summons itself; a split's instance stays with what it was given.
  // The fly-in overlay: dblclick dives the camera into a node, and a rooted
  // browser on the node's data directory overlays the same pane. The overlay
  // IS the DAG pane transformed — same id, same group — so file clicks write
  // the pane's regard and slaved viewers follow. Esc reverses the dolly.
  const nodeOverlays: Map<string, { element: HTMLElement; panel: FilesPanel; history: string[] }> =
    new Map();

  const nodeOverlay_open = (id: string, vfsPath: string): void => {
    const mount: HTMLElement | undefined = paneInstance_get(id)?.mount;
    const canvas: HTMLElement | null = mount?.querySelector<HTMLElement>('.dag-canvas') ?? null;
    if (canvas === null || nodeOverlays.has(id)) {
      return;
    }
    const element: HTMLElement = document.createElement('div');
    element.className = 'node-overlay';
    const header: HTMLElement = document.createElement('header');
    header.className = 'node-overlay-header';
    const title: HTMLSpanElement = document.createElement('span');
    title.textContent = `INSIDE ${vfsPath}`.toUpperCase();
    const hint: HTMLSpanElement = document.createElement('span');
    hint.className = 'node-overlay-hint';
    hint.textContent = 'ESC EXITS NODE';
    header.append(title, hint);
    const body: HTMLElement = document.createElement('div');
    body.className = 'node-overlay-body';
    element.append(header, body);
    const history: string[] = [];
    const panel: FilesPanel = new FilesPanel(body, (action: FileAction): void => {
      if (action.kind === 'dir') {
        // A descendant plugin instance is a node of the same graph: the
        // experience is a hop — fly out of this node, fly into that one —
        // never a directory descent that leaves the graph behind.
        const instMatch: RegExpMatchArray | null =
          action.path.startsWith('/proc/jobs/') ? (action.path.split('/').pop() ?? '').match(/_(\d+)$/) : null;
        if (instMatch !== null) {
          const instanceID: number = parseInt(instMatch[1] ?? '', 10);
          nodeOverlay_close(id, (): void => {
            if (dagPanels.get(id)?.node_flyTo(instanceID) !== true) {
              // Not a node of this graph after all: fall back to descent.
              nodeOverlay_open(id, action.path);
            }
          });
          return;
        }
        const previous: string | null = panel.path_current();
        if (previous !== null) {
          history.push(previous);
        }
        rootedListing_show(id, panel, action.path);
        return;
      }
      // A file click inside the node is an indication on the DAG pane's own
      // group (the overlay shares its identity), feeding any slaved viewer.
      subjects.regard_write(id, { address: action.path, modelKind: 'fs.file' });
      if (subjects.groupHasViewer(id)) {
        return;
      }
      if (extension_isImage(action.path)) {
        panel.contentImage_show(action.path, vfsUrl_build(action.path));
        return;
      }
      void fileText_fetch(action.path).then((content: string): void => {
        panel.content_show(action.path, content);
      });
    });
    nodeOverlays.set(id, { element, panel, history });
    canvas.appendChild(element);
    window.requestAnimationFrame((): void => element.classList.add('node-overlay-open'));
    rootedListing_show(id, panel, vfsPath);
  };

  const nodeOverlay_close = (id: string, onDone?: () => void): void => {
    const record = nodeOverlays.get(id);
    if (record === undefined) {
      onDone?.();
      return;
    }
    nodeOverlays.delete(id);
    record.element.classList.remove('node-overlay-open');
    const finish = (): void => {
      record.element.remove();
      onDone?.();
    };
    const panel: DagPanel | undefined = dagPanels.get(id);
    if (panel !== undefined) {
      panel.flight_back(finish);
    } else {
      finish();
    }
  };

  const dagInstance_build = (id: string, primary: boolean): PaneInstance => {
    const mount: HTMLElement = template_stamp('tpl-pane-dag');
    const panel: DagPanel = new DagPanel(
      pane_find(mount, '.dag-canvas'),
      pane_find(mount, '.dag-title'),
      pane_find(mount, '.dag-facts'),
      pane_find(mount, '.dag-empty'),
      pane_find(mount, '.dag-strategy'),
      pane_find(mount, '.dag-feedlist'),
      {
        command_run: (line: string): void => {
          // The claim rule: a pane's own requests resolve to it alone.
          void client
            .line_execute(line, { silent: true, observe: false })
            .then((outcome: ExecuteOutcome): void => {
              for (const envelope of outcome.envelopes) {
                panel.envelope_observe(envelope);
              }
            });
        },
        node_enter: (vfsPath: string): void => {
          terminal.line_run(`cd "${vfsPath}"`);
        },
        node_dive: (vfsPath: string): void => {
          // The immersive root is the node itself — status, params, log,
          // data, children — not its data link; the label stays honest.
          nodeOverlay_open(id, vfsPath.replace(/\/data$/, ''));
        },
        node_regard: (vfsPath: string): void => {
          subjects.regard_write(id, { address: vfsPath, modelKind: 'feed.node' });
        },
        ...(primary ? { feed_shown: (): void => dag_summon() } : {}),
      },
    );
    dagPanels.set(id, panel);
    return {
      id,
      kind: 'dag',
      mount,
      dispose: (): void => {
        nodeOverlays.get(id)?.element.remove();
        nodeOverlays.delete(id);
        dagPanels.delete(id);
        subjects.pane_leave(id);
        panel.dispose();
      },
    };
  };

  // The primary instances carry the preset ids the gutter's trees name.
  const filesPrimary: PaneInstance = filesInstance_build('files', true);
  paneInstance_adopt(filesPrimary);
  const dagPrimary: PaneInstance = dagInstance_build('dag', true);
  paneInstance_adopt(dagPrimary);
  const filesPanel: FilesPanel = filesPanels.get('files') as FilesPanel;
  const dagPanel: DagPanel = dagPanels.get('dag') as DagPanel;

  const cycler: PipelineCycler = new PipelineCycler(
    element_require('pipeline-cycler'),
    element_require('pipeline-cycler-name'),
    (line: string): void => {
      void client.line_execute(line, { silent: true });
    },
  );
  const pacsPanel: PacsPanel = new PacsPanel(element_require('pacs-workspace'), {
    command_run: (line: string): void => {
      void client.line_execute(line, { silent: true });
    },
    command_show: (line: string): void => {
      terminal.line_run(line);
    },
    workspace_close: (): void => home_apply(),
  });
  paneInstance_adopt({ id: 'pacs', kind: 'pacs', mount: element_require('pacs-workspace') });

  // The tiling tree: presets are the gutter's trees; a feed in view varies
  // home by materializing the DAG pane (files left, DAG right); splits
  // carve the current tree until the next preset resets to givens.
  const layout: LayoutManager = new LayoutManager(
    element_require('layout-root'),
    new Map([
      ['dag', dagPrimary.mount],
      ['files', filesPrimary.mount],
      ['pacs', element_require('pacs-workspace')],
    ]),
  );
  let dagShown: boolean = false;
  const homeTree = (): LayoutNode =>
    dagShown
      ? {
          dir: 'col',
          ratio: 0.45,
          first: { pane: 'files' },
          second: { pane: 'dag' },
        }
      : { pane: 'files' };
  layout.preset_register('files', homeTree);
  layout.preset_register('pacs', (): LayoutNode => ({ pane: 'pacs' }));
  // RUNS-02 is a full-workspace preset like PACS-03, not a split variation.
  layout.preset_register('dag', (): LayoutNode => ({ pane: 'dag' }));
  // Any geometry change (split, close, claim, preset, a settled divider
  // drag) refits the measured canvases once the DOM has settled; a
  // reparented WebGL canvas otherwise keeps its old pixel size.
  layout.renderObserver_set((): void => {
    window.requestAnimationFrame((): void => {
      for (const panel of dagPanels.values()) {
        panel.size_fit();
      }
    });
  });

  // Disposes split-born instances the current tree no longer holds; the
  // primaries (the presets' panes) always survive offstage.
  const orphans_dispose = (): void => {
    const shown: Set<string> = new Set(layout.panes_shown());
    for (const instance of paneInstances_list()) {
      if (shown.has(instance.id)) continue;
      if (instance.id === 'files' || instance.id === 'dag' || instance.id === 'pacs') continue;
      paneInstance_dispose(instance.id);
      layout.mount_remove(instance.id);
    }
  };

  const home_apply = (): void => {
    layout.preset_apply('files');
    orphans_dispose();
    dagPanel.size_fit();
  };
  const dag_summon = (): void => {
    const preset: string = layout.activePreset_get();
    if (preset === 'pacs' || preset === 'dag') {
      // A full-workspace preset is the operator's choice; the summon only
      // notes that home should include the DAG when they return to it.
      dagShown = true;
      return;
    }
    if (dagShown && preset === 'files') return;
    dagShown = true;
    home_apply();
  };

  // Creates a fresh pane instance, registered and chromed for the tree. A
  // pane spawned from another's drawer inherits the parent's link group —
  // the semantic tracing; otherwise it starts a group of its own. A viewer
  // marks itself and subscribes here, after joining, so the retained cell
  // replays immediately.
  const instance_spawn = (kind: string, inheritFrom?: string): PaneInstance => {
    const instance: PaneInstance = paneInstance_create(kind);
    subjects.pane_join(
      instance.id,
      inheritFrom !== undefined ? subjects.group_of(inheritFrom) : instance.id,
    );
    if (kind === 'view') {
      subjects.viewer_mark(instance.id);
      subjects.regard_subscribe(instance.id, (value: RegardValue): void => {
        viewerPanels.get(instance.id)?.regard_show(value);
      });
    }
    layout.mount_register(instance.id, instance.mount);
    pane_chrome_wire(instance.id, kind, instance.mount);
    return instance;
  };

  // Wires one pane's chrome under the machinery-behind-the-frame rule: at
  // rest the pane shows only work and state; clicking the header (the
  // frame) toggles the pane drawer, which holds the layout verbs and the
  // kind's semantic children (docs/aegis.adoc).
  const pane_chrome_wire = (id: string, kind: string, mount: HTMLElement): void => {
    const drawer: HTMLElement | null = mount.querySelector<HTMLElement>('.pane-drawer');
    const handle: HTMLElement | null = mount.querySelector<HTMLElement>('.pane-handle');
    if (drawer === null || handle === null) {
      return;
    }
    handle.addEventListener('click', (event: Event): void => {
      // Working controls riding the header (the strategy pill) keep their
      // own meaning; only the frame itself is the drawer's handle.
      if (event.target instanceof Element && event.target.closest('button') !== null) {
        return;
      }
      drawer.hidden = !drawer.hidden;
      // An open drawer is keyboard-live either way it opened: first verb
      // takes focus so arrows/Tab/Enter/Esc work without a prefix press.
      if (!drawer.hidden) {
        drawer.querySelector<HTMLButtonElement>('button')?.focus();
      }
      sound_play('audio3');
    });
    const zoomCapsule: HTMLElement | null = drawer.querySelector<HTMLElement>('.drawer-zoom');
    if (zoomCapsule !== null) {
      zoomCapsule.dataset['pane'] = id;
    }
    // The binding radio: what the next split creates. UNLINKED is the
    // unmarked case; the selection is per-pane drawer state.
    for (const bind of drawer.querySelectorAll<HTMLElement>('.drawer-bind')) {
      bind.addEventListener('click', (): void => {
        for (const peer of drawer.querySelectorAll('.drawer-bind')) {
          peer.classList.remove('drawer-bind-selected');
        }
        bind.classList.add('drawer-bind-selected');
        sound_play('audio3');
      });
    }
    // The four placement pills: SPLIT is the one verb that creates a pane;
    // the selected binding says what the created pane IS.
    for (const splitter of drawer.querySelectorAll<HTMLElement>('[data-split]')) {
      splitter.addEventListener('click', (): void => {
        const dir: 'row' | 'col' = splitter.dataset['split'] === 'row' ? 'row' : 'col';
        const before: boolean = splitter.dataset['place'] === 'before';
        const binding: string =
          drawer.querySelector<HTMLElement>('.drawer-bind-selected')?.dataset['bind'] ?? 'unlinked';
        const spawned: PaneInstance =
          binding === 'viewer' ? instance_spawn('view', id)
          : binding === 'fs' ? instance_spawn('files', id)
          : instance_spawn('empty');
        if (!layout.leaf_split(id, dir, spawned.id, before)) {
          paneInstance_dispose(spawned.id);
          layout.mount_remove(spawned.id);
          return;
        }
        if (binding === 'fs') {
          // Linked filesystem: follows the parent's regard at the DIRECTORY
          // level — an indicated file shows its directory, an indicated node
          // shows the node's data space.
          const browser_show = (value: RegardValue): void => {
            const panel: FilesPanel | undefined = filesPanels.get(spawned.id);
            if (panel === undefined) return;
            const dirPath: string =
              value.modelKind === 'fs.file'
                ? value.address.replace(/\/[^/]*$/, '') || '/'
                : value.address;
            rootedListing_show(spawned.id, panel, dirPath);
          };
          subjects.regard_subscribe(spawned.id, browser_show);
          const current: RegardValue | null = subjects.regard_get(id);
          if (current !== null) browser_show(current);
        }
        drawer.hidden = true;
        sound_play('audio3');
      });
    }
    drawer.querySelector<HTMLElement>('.drawer-close')?.addEventListener('click', (): void => {
      if (id === 'dag') {
        // The primary DAG's close is its dismissal from home.
        dagShown = false;
        home_apply();
        return;
      }
      if (!layout.leaf_close(id)) {
        // The root leaf: closing the last pane means home.
        home_apply();
      }
      orphans_dispose();
      sound_play('audio3');
    });
    // Semantic children: parent-contextualized intents, per pane kind.
    const children: HTMLElement | null = drawer.querySelector<HTMLElement>('.drawer-children');
    if (children === null) {
      return;
    }
    const child_offer = (label: string, hint: string, spawn: () => void, flavor: string = ''): void => {
      const capsule: HTMLButtonElement = document.createElement('button');
      capsule.className = `pacs-capsule drawer-child${flavor === '' ? '' : ` ${flavor}`}`;
      capsule.textContent = label;
      capsule.title = hint;
      capsule.addEventListener('click', (): void => {
        spawn();
        drawer.hidden = true;
        sound_play('audio3');
      });
      children.appendChild(capsule);
    };
    if (kind === 'files') {
      // Navigation verbs: the primary browser is slaved to the session, so
      // its back/home are the session's own; a rooted browser walks its own
      // history.
      const primary: boolean = id === 'files';
      child_offer('HOME', 'back to the home directory', (): void => {
        if (primary) {
          terminal.line_run('cd ~');
        } else {
          const panel: FilesPanel | undefined = filesPanels.get(id);
          if (panel !== undefined) {
            const previous: string | null = panel.path_current();
            if (previous !== null) {
              rootedHistory.get(id)?.push(previous);
            }
            rootedListing_show(id, panel, '~');
          }
        }
      });
      child_offer('BACK', 'return to the previous listing', (): void => {
        if (primary) {
          terminal.line_run('cd -');
          return;
        }
        const panel: FilesPanel | undefined = filesPanels.get(id);
        const previous: string | undefined = rootedHistory.get(id)?.pop();
        if (panel !== undefined && previous !== undefined) {
          rootedListing_show(id, panel, previous);
        }
      });
      child_offer('DOWNLOAD', 'download the indicated file', (): void => {
        const regard: RegardValue | null = subjects.regard_get(id);
        if (regard !== null && regard.modelKind === 'fs.file') {
          window.open(vfsUrl_build(regard.address), '_blank');
        }
      });
      // Destructive verbs run as VISIBLE terminal commands: auditable in the
      // transcript, never a silent mutation behind a pill.
      child_offer('DELETE', 'rm the indicated file (runs visibly in the console)', (): void => {
        const regard: RegardValue | null = subjects.regard_get(id);
        if (regard !== null && regard.modelKind === 'fs.file') {
          terminal.line_run(`rm "${regard.address}"`);
        }
      }, 'drawer-destructive');
    }
    if (kind === 'dag') {
      child_offer('ENTER NODE', 'move the session into the indicated node', (): void => {
        const regard: RegardValue | null = subjects.regard_get(id);
        if (regard !== null) {
          terminal.line_run(`cd "${regard.address}"`);
        }
      });
      child_offer('BACK', 'return to the previous listing inside the node', (): void => {
        const record = nodeOverlays.get(id);
        const previous: string | undefined = record?.history.pop();
        if (record !== undefined && previous !== undefined) {
          rootedListing_show(id, record.panel, previous);
        }
      });
      child_offer('CLEAR DETAIL', 'dismiss the node facts (a click on empty space does too)', (): void => {
        dagPanels.get(id)?.detail_clear();
      });
    }
  };
  pane_chrome_wire('files', 'files', filesPrimary.mount);
  pane_chrome_wire('dag', 'dag', dagPrimary.mount);
  pane_chrome_wire('pacs', 'pacs', element_require('pacs-workspace'));

  // Keyboard machinery, tmux-shaped: Ctrl-B is the prefix — it opens the
  // focused pane's drawer with keyboard focus on its first verb (Tab walks,
  // Enter fires); Esc closes any open drawer before anything else claims it.
  // Focus citizenship: the console is a pane for the prefix key's
  // purposes. The operator's last touch decides — console area in,
  // workspace tree out.
  let consoleFocused: boolean = false;
  const consoleFocused_set = (value: boolean): void => {
    consoleFocused = value;
  };
  for (const eventName of ['click', 'focusin'] as const) {
    document.addEventListener(eventName, (event: Event): void => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('#drawer') !== null) consoleFocused = true;
      else if (event.target.closest('#layout-root') !== null) consoleFocused = false;
    });
  }

  const drawers_close = (): boolean => {
    let closed: boolean = false;
    for (const drawer of document.querySelectorAll<HTMLElement>('.pane-drawer:not([hidden])')) {
      drawer.hidden = true;
      closed = true;
    }
    return closed;
  };
  window.addEventListener(
    'keydown',
    (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // The command line is the topmost transient: its Esc closes it and
        // nothing else.
        if (!palette.hidden) {
          palette_close();
          event.stopImmediatePropagation();
          return;
        }
        // Esc is a contextual back: transient chrome first (drawer, then
        // zoom), then one navigation pop — node immersion back to the
        // graph, the graph back to the feed list. Each press retreats
        // exactly one level; never a walk back up invisible browser depth.
        if (drawers_close()) {
          event.stopImmediatePropagation();
          sound_play('audio3');
          return;
        }
        if (document.body.dataset['zoom'] !== undefined) {
          // The zoom listener (bubble phase) takes this press.
          return;
        }
        const overlayId: string | undefined = [...nodeOverlays.keys()].pop();
        if (overlayId !== undefined) {
          nodeOverlay_close(overlayId);
          event.stopImmediatePropagation();
          sound_play('audio3');
          return;
        }
        for (const panel of dagPanels.values()) {
          if (panel.nav_pop()) {
            event.stopImmediatePropagation();
            sound_play('audio3');
            return;
          }
        }
        return;
      }
      // Arrows walk an open drawer's verbs (Tab still works); wrap at the
      // ends. Only claimed while a drawer verb actually holds focus.
      if (
        (event.key === 'ArrowRight' || event.key === 'ArrowLeft' ||
         event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
        document.activeElement instanceof HTMLButtonElement
      ) {
        const drawer: HTMLElement | null = document.activeElement.closest('.pane-drawer');
        if (drawer !== null && !drawer.hidden) {
          const verbs: HTMLButtonElement[] = [...drawer.querySelectorAll<HTMLButtonElement>('button')];
          const at: number = verbs.indexOf(document.activeElement);
          const forward: boolean = event.key === 'ArrowRight' || event.key === 'ArrowDown';
          const next: HTMLButtonElement | undefined =
            verbs[(at + (forward ? 1 : verbs.length - 1)) % verbs.length];
          next?.focus();
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      // Prefix-: — a drawer opened by the prefix hands ':' to the command
      // line (and a second Ctrl-B does the same).
      if (event.key === ':' && document.querySelector('.pane-drawer:not([hidden])') !== null) {
        drawers_close();
        palette_open();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.key === 'b' && event.ctrlKey && !event.altKey && !event.metaKey) {
        // The prefix belongs to argus EVERYWHERE — the terminal implements
        // no readline Ctrl-B, so an exclusion only donated the key to the
        // browser's bookmarks. Claim it unconditionally.
        if (document.querySelector('.pane-drawer:not([hidden])') !== null) {
          // Second prefix press: the command line.
          drawers_close();
          palette_open();
          event.preventDefault();
          return;
        }
        // Past the terminal exclusion the prefix belongs to argus, drawer
        // or no drawer — the browser must never see it (bookmarks!).
        event.preventDefault();
        // A zoomed tree pane is the only one on stage: the prefix key must
        // reach its drawer, whatever the layout focus was before the zoom.
        const zoomed: string | undefined = document.body.dataset['zoom'];
        const consoleHasIt: boolean =
          zoomed === 'console' || (zoomed === undefined && consoleFocused);
        const focused: string =
          zoomed !== undefined && zoomed !== 'console'
            ? zoomed
            : (layout.focused_get() ?? 'files');
        const drawer: HTMLElement | null = consoleHasIt
          ? element_require('console-drawer')
          : (paneInstance_get(focused)?.mount?.querySelector<HTMLElement>('.pane-drawer') ?? null);
        if (drawer === null) {
          return;
        }
        event.preventDefault();
        drawer.hidden = !drawer.hidden;
        if (!drawer.hidden) {
          drawer.querySelector<HTMLButtonElement>('button')?.focus();
        }
        sound_play('audio3');
      }
    },
    { capture: true },
  );

  // A claimed empty pane becomes what its command projected.
  const pane_claim = (emptyId: string, kind: ClaimKind, envelopes: WireEnvelope[]): void => {
    if (kind === 'pacs') {
      // The PACS workspace claims the whole region by design.
      layout.preset_apply('pacs');
      orphans_dispose();
      for (const envelope of envelopes) {
        pacsPanel.envelope_observe(envelope);
      }
      return;
    }
    const instance: PaneInstance = instance_spawn(kind);
    layout.leaf_replace(emptyId, instance.id);
    paneInstance_dispose(emptyId);
    layout.mount_remove(emptyId);
    const panel: FilesPanel | DagPanel | undefined =
      kind === 'files' ? filesPanels.get(instance.id) : dagPanels.get(instance.id);
    for (const envelope of envelopes) {
      panel?.envelope_observe(envelope);
    }
  };

  paneFactory_register('files', (id: string): PaneInstance => filesInstance_build(id, false));
  paneFactory_register('dag', (id: string): PaneInstance => dagInstance_build(id, false));
  paneFactory_register('view', viewInstance_build);
  paneFactory_register('empty', (id: string): PaneInstance => {
    const mount: HTMLElement = template_stamp('tpl-pane-empty');
    new EmptyPanel(mount, {
      execute: (line: string): Promise<ExecuteOutcome> =>
        client.line_execute(line, { silent: true, observe: false }),
      claim: (kind: ClaimKind, envelopes: WireEnvelope[]): void => pane_claim(id, kind, envelopes),
    });
    return { id, kind: 'empty', mount };
  });

  // FILES-01: home. RUNS-02: home + the feed chooser. PACS-03: toggles the
  // PACS tree against home.
  element_require('gutter-files').addEventListener('click', (): void => {
    // A gutter press is a preset declaration and must be deterministic:
    // FILES-01 always yields the full files pane. The DAG rejoins home only
    // when a feed next comes into view (the summon), never as leftovers.
    dagShown = false;
    home_apply();
    layout.focus_set('files');
    consoleFocused_set(false);
  });
  element_require('gutter-runs').addEventListener('click', (): void => {
    // The DAG takes the whole workspace, PACS-style, and always lands on
    // the feed list: a graph retained from an earlier visit is dismissed
    // before the roster paints.
    layout.preset_apply('dag');
    orphans_dispose();
    dagPanel.list_reset();
    dagPanel.feedsChooser_request();
    layout.focus_set('dag');
    consoleFocused_set(false);
  });
  // CONSOLE-05: a given always renders its target — the console open with
  // the prompt live; never a toggle (the lid and the drawer's CLOSE retract).
  element_require('gutter-console').addEventListener('click', (): void => {
    if (element_require('drawer').classList.contains('drawer-closed')) {
      element_require('drawer-toggle').click();
    }
    terminal.focus_take();
    consoleFocused_set(true);
  });
  element_require('gutter-tools').addEventListener('click', (): void => {
    // A given always renders its target (gutter law) — no toggling;
    // dismissal is the pane drawer's CLOSE.
    layout.preset_apply('pacs');
    orphans_dispose();
    layout.focus_set('pacs');
    consoleFocused_set(false);
  });

  // ------------------------------------------------------------ the language
  // Every gesture as a sentence (docs/aegis.adoc: the argus language). The
  // host hands the language the same controls the mouse uses.
  const paneKind_get = (id: string): string | null => paneInstance_get(id)?.kind ?? null;
  const argusHost: ArgusHost = {
    focused_get: (): string | null => {
      const zoomed: string | undefined = document.body.dataset['zoom'];
      if (zoomed !== undefined && zoomed !== 'console') return zoomed;
      // Before any click nothing is focused; the first shown pane is the
      // sentence's natural default target.
      return layout.focused_get() ?? layout.panes_shown()[0] ?? null;
    },
    focus_set: (id: string): boolean => {
      if (paneInstance_get(id) === undefined) return false;
      layout.focus_set(id);
      return true;
    },
    panes_shown: (): string[] => layout.panes_shown(),
    paneRect_get: (id: string): DOMRect | null => {
      const leaf: HTMLElement | null = document.querySelector<HTMLElement>(`.layout-leaf[data-leaf="${id}"]`);
      return leaf?.getBoundingClientRect() ?? null;
    },
    paneMount_get: (id: string): HTMLElement | null => paneInstance_get(id)?.mount ?? null,
    paneKind_get,
    paneLinked_get: (id: string): boolean => subjects.group_of(id) !== id,
    feed_enter: (feedId: number): void => dagPanel.feed_enter(feedId),
    consoleZoom_toggle,
    node_immerse: (paneId: string): boolean => {
      const regard: RegardValue | null = subjects.regard_get(paneId);
      const match: RegExpMatchArray | null = regard?.address.match(/_(\d+)(?:\/data)?\/?$/) ?? null;
      if (match === null) return false;
      return dagPanels.get(paneId)?.node_flyTo(parseInt(match[1] ?? '', 10)) ?? false;
    },
    session_run: async (line: string): Promise<string> => {
      try {
        const outcome: ExecuteOutcome = await client.line_execute(line, { silent: true, observe: false });
        return outcome.envelopes.map((envelope): string => envelope.renderedErr ?? envelope.rendered).join('\n');
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    desktop_serialize: (): string => {
      const tree = layout.tree_get();
      if (tree === null) return '# empty desktop';
      const lines: string[] = [];
      type Node = { pane: string } | { dir: 'row' | 'col'; first: Node; second: Node };
      const firstLeaf = (node: Node): string => 'pane' in node ? node.pane : firstLeaf(node.first);
      const anchorId: string = firstLeaf(tree as Node);
      const anchorKind: string | null = paneKind_get(anchorId);
      lines.push(`view ${anchorKind === 'dag' ? 'runs' : anchorKind === 'pacs' ? 'pacs' : 'files'}`);
      let counter: number = 1;
      const dress = (paneId: string, ordinal: number): void => {
        const kind: string | null = paneKind_get(paneId);
        if (kind === 'dag' && paneId !== anchorId) lines.push(`pane %${ordinal} claim runs`);
        if (kind === 'files' && paneId !== anchorId && !(subjects.group_of(paneId) !== paneId)) {
          lines.push(`pane %${ordinal} claim files`);
        }
        if (kind === 'dag') {
          const mount: HTMLElement | undefined = paneInstance_get(paneId)?.mount;
          const strategy: string = mount?.querySelector('.dag-strategy')?.textContent?.toLowerCase() ?? 'ranked';
          const projection: string = mount?.querySelector('.dag-projection')?.textContent?.toLowerCase() ?? '3d';
          if (strategy !== 'ranked') lines.push(`dag %${ordinal} layout ${strategy}`);
          if (projection !== '3d') lines.push(`dag %${ordinal} projection ${projection}`);
        }
      };
      const build = (node: Node, ordinal: number): void => {
        if ('pane' in node) {
          dress(node.pane, ordinal);
          return;
        }
        const secondAnchor: string = firstLeaf(node.second);
        const secondKind: string | null = paneKind_get(secondAnchor);
        const binding: string = secondKind === 'view'
          ? 'viewer'
          : secondKind === 'files' && subjects.group_of(secondAnchor) !== secondAnchor
            ? 'fs'
            : 'unlinked';
        lines.push(`pane %${ordinal} bind ${binding}`);
        lines.push(`pane %${ordinal} split ${node.dir === 'col' ? 'right' : 'below'}`);
        const newOrdinal: number = ++counter;
        build(node.first, ordinal);
        build(node.second, newOrdinal);
      };
      build(tree as Node, counter);
      const headerFace: string | undefined = document.body.dataset['header'];
      if (headerFace !== undefined) lines.push(`header ${headerFace}`);
      const drawerEl: HTMLElement | null = document.getElementById('drawer');
      if (drawerEl?.classList.contains('drawer-closed')) lines.push('console close');
      return lines.join('\n');
    },
  };

  // The command line: prefix-: (tmux tradition) or the LANG capsule. One
  // floating line; sentences run client-side, anything else falls through
  // to the session console with full echo.
  const palette: HTMLElement = element_require('lang-palette');
  const paletteInput: HTMLInputElement = element_require('lang-input') as HTMLInputElement;
  const paletteResult: HTMLElement = element_require('lang-result');
  const langPill: HTMLElement = element_require('lang-pill');
  const palette_open = (): void => {
    drawers_close();
    palette.hidden = false;
    langPill.classList.add('lang-live');
    paletteResult.textContent = '';
    paletteInput.value = '';
    paletteInput.focus();
    sound_play('audio3');
  };
  const palette_close = (): void => {
    palette.hidden = true;
    langPill.classList.remove('lang-live');
    paletteResult.textContent = '';
  };
  // LCARS has no keyboard: the gutter given is a show/remove toggle, and
  // it wears a lit dress while the line is on stage.
  langPill.addEventListener('click', (): void => {
    if (palette.hidden) palette_open();
    else palette_close();
  });
  const LANG_SUBJECT_WORDS: string[] = [
    'pane', 'view', 'runs', 'node', 'dag', 'file', 'header', 'console', 'back', 'desktop', 'argus',
  ];
  const LANG_FOLLOWERS: Record<string, string[]> = {
    pane: ['split', 'zoom', 'close', 'bind', 'claim', 'focus'],
    view: ['files', 'runs', 'pacs'],
    runs: ['enter'],
    node: ['enter', 'immerse', 'back', 'clear'],
    dag: ['layout', 'projection', 'scale', 'pulse', 'census', 'physics'],
    physics: ['charge', 'link', 'collide', 'gravity', 'reset'],
    file: ['home', 'back', 'download', 'delete'],
    header: ['stats', 'dag', 'away', 'restore'],
    console: ['open', 'close', 'toggle', 'zoom', 'height'],
    desktop: ['save', 'load', 'show', 'list', 'delete'],
    split: ['left', 'right', 'above', 'below'],
    bind: ['unlinked', 'fs', 'viewer'],
    claim: ['files', 'runs', 'pacs'],
    layout: ['ranked', 'molecule'],
    projection: ['2d', '3d'],
    scale: ['time', 'size'],
    argus: ['verbs'],
  };
  paletteInput.addEventListener('keydown', (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      palette_close();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const words: string[] = paletteInput.value.split(/\s+/);
      const prefix: string = words[words.length - 1] ?? '';
      const context: string = words.length <= 1 ? '' : (words[words.length - 2] ?? '');
      const pool: string[] = words.length <= 1
        ? LANG_SUBJECT_WORDS
        : LANG_FOLLOWERS[context] ?? LANG_FOLLOWERS[words[0] ?? ''] ?? [];
      const match: string | undefined = pool.find((word: string): boolean => word.startsWith(prefix.toLowerCase()));
      if (match !== undefined) {
        words[words.length - 1] = match;
        paletteInput.value = `${words.join(' ')} `;
      }
      return;
    }
    if (event.key === 'Enter') {
      const line: string = paletteInput.value.trim();
      if (line.length === 0) { palette_close(); return; }
      void argusLine_run(argusHost, line).then((result: string | null): void => {
        if (result !== null) {
          paletteResult.textContent = result;
          terminal.output_write('data', `: ${line}\n${result}\n`);
          paletteInput.value = '';
          paletteInput.select();
        } else {
          // Not an argus sentence: the session console takes it, visibly.
          palette_close();
          terminal.line_run(line);
        }
      });
    }
  });

  // Boot: the remembered preset, or home.
  layout.preset_apply(layout.savedPreset_get() ?? 'files');

  const drawerStatus: HTMLElement = element_require('drawer-status');
  const mode_show = (mode: string): void => {
    drawerStatus.textContent = `MODE: [${mode}]`;
  };

  const terminal: ArgusTerminal = new ArgusTerminal(
    element_require('terminal'),
    async (line: string): Promise<void> => {
      // The argus language claims its reserved subjects client-side; the
      // sentence never touches the wire.
      const local: string | null = await argusLine_run(argusHost, line);
      if (local !== null) {
        terminal.output_write('data', `${local}\n`);
        // No wire round-trip means no promptline push: the console must
        // unlock itself or every following line queues forever.
        terminal.prompt_draw();
        mode_show('READY');
        return;
      }
      mode_show('BUSY');
      const startedAt: number = performance.now();
      try {
        const outcome: ExecuteOutcome = await client.line_execute(line);
        terminal.outcome_write(outcome);
        // The panel is slaved to the working directory: any command that
        // moved it (an fs.cwd model) triggers a silent listing refresh,
        // whose fs.listing envelope repaints the panel on observation.
        if (outcome.envelopes.some((envelope): boolean => envelope.model?.kind === 'fs.cwd')) {
          void client.line_execute('ls', { silent: true });
        }
      } catch (error: unknown) {
        const reason: string = error instanceof Error ? error.message : String(error);
        terminal.output_write('err', `\x1b[31m${reason}\x1b[0m\n`);
      }
      progress.clear();
      statusBar.activity_clear();
      // The felt latency, measured: command round-trip in the MODE strip.
      mode_show(`READY ${Math.round(performance.now() - startedAt)}ms`);
      terminal.prompt_draw();
    },
    (prefix: string) => client.line_complete(prefix),
  );

  // Progress describes a running command, so nothing it draws may outlive
  // one; the submit handler clears the region once the command settles.
  const progress: ArgusProgress = new ArgusProgress(
    terminal.progressRegion_get(),
    (text: string): void => terminal.output_write('err', text),
  );

  const attached: { client: ArgusClient; attach: AttachInfo } = await ArgusClient.session_attach(
    wsUrl_resolve(),
    token,
    {
      output_receive: (channel: OutputChannel, chunk: string): void => terminal.output_write(channel, chunk),
      progress_receive: (message: ProgressMessage): void => {
        progress.write(message);
        statusBar.progress_observe(message);
        cascade?.progress_observe(message);
        for (const panel of dagPanels.values()) {
          panel.progress_observe(message);
        }
        pacsPanel.progress_observe(message);
      },
      promptline_receive: (context: PromptContext): void => {
        terminal.promptContext_set(context);
        statusBar.promptContext_show(context);
        cascade?.promptContext_observe(context);
        dagPanel.promptContext_observe(context);
      },
      telemetry_receive: (index: { jobs: number; feeds: number }): void =>
        cascade?.index_observe(index),
      session_receive: (surface: string, envelope: WireEnvelope): void =>
        terminal.session_write(surface, envelope),
      envelope_observe: (envelope: WireEnvelope): void => {
        // The claim rule for console-issued models: a DAG-shaped model goes
        // to the focused DAG instance when one is focused, else the primary.
        const kind: string | undefined = envelope.model?.kind;
        if (kind === 'feed.dag' || kind === 'feed.list') {
          const focused: string | null = layout.focused_get();
          const target: DagPanel =
            focused !== null && dagPanels.has(focused)
              ? (dagPanels.get(focused) as DagPanel)
              : dagPanel;
          target.envelope_observe(envelope);
        } else {
          filesPanel.envelope_observe(envelope);
          pacsPanel.envelope_observe(envelope);
        }
        cycler.envelope_observe(envelope);
      },
      close_handle: (): void => {
        statusBar.connection_show(false);
        cascade?.connection_show(false);
        mode_show('OFFLINE');
      },
    },
  );
  const client: ArgusClient = attached.client;

  statusBar.attach_show(attached.attach);
  statusBar.connection_show(true);
  cascade?.connection_show(true);
  aboutFace_fill(attached.attach);

  // Seed the ambient cycler: the registered pipelines are already listed
  // in /bin, so one silent ls names them all.
  void client.line_execute('ls /bin', { silent: true }).then((outcome: ExecuteOutcome): void => {
    const listing: WireEnvelope | undefined = outcome.envelopes.find(
      (envelope: WireEnvelope): boolean => envelope.model?.kind === 'fs.listing',
    );
    const data: FsListing[] | undefined = listing?.model?.data as FsListing[] | undefined;
    const names: string[] = (data ?? [])
      .flatMap((entry: FsListing) => entry.items)
      .filter((item): boolean => item.type === 'pipeline')
      .map((item): string => item.name);
    cycler.names_set(names);
  });
  mode_show('READY');
  terminal.banner_write(BANNER_LINES);
  terminal.prompt_draw();
  terminal.focus_take();

  drawer_wire(
    element_require('drawer'),
    element_require('drawer-strip'),
    element_require('drawer-toggle'),
    terminal,
  );
  // The console joins the drawer grammar: its header is a handle, its
  // drawer carries only the verbs that apply (zoom via the shared
  // data-pane path; CLOSE retracts through the lid's own toggle).
  const consoleDrawer: HTMLElement = element_require('console-drawer');
  element_require('console-handle').addEventListener('click', (event: Event): void => {
    if (event.target instanceof Element && event.target.closest('button') !== null) {
      return;
    }
    consoleDrawer.hidden = !consoleDrawer.hidden;
    if (!consoleDrawer.hidden) {
      consoleDrawer.querySelector<HTMLButtonElement>('button')?.focus();
    }
    sound_play('audio3');
  });
  consoleDrawer.querySelector<HTMLElement>('.console-retract')?.addEventListener('click', (): void => {
    consoleDrawer.hidden = true;
    element_require('drawer-toggle').click();
  });
  consoleZoom_set = zoom_wire(terminal);
  panelSounds_wire();
  window.addEventListener('resize', (): void => terminal.size_fit());
}

/**
 * Page entry: use the URL token when present, otherwise show the attach
 * form and start on submit.
 */
function page_boot(): void {
  cascade = cascade_build();
  headerFaces_wire();
  audioPill_wire();
  themePill_wire();
  const params: URLSearchParams = new URLSearchParams(window.location.search);
  const urlToken: string | null = params.get('token');
  const attachForm: HTMLElement = element_require('attach-form');
  const attachError: HTMLElement = element_require('attach-error');

  const start: (token: string) => void = (token: string): void => {
    surface_start(token).then(
      (): void => {
        attachForm.classList.add('attach-hidden');
      },
      (error: unknown): void => {
        attachForm.classList.remove('attach-hidden');
        attachError.textContent = error instanceof Error ? error.message : String(error);
      },
    );
  };

  const tokenInput: HTMLInputElement = element_require('attach-token') as HTMLInputElement;
  element_require('attach-submit').addEventListener('click', (): void => {
    if (tokenInput.value.trim().length > 0) {
      start(tokenInput.value.trim());
    }
  });
  tokenInput.addEventListener('keydown', (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && tokenInput.value.trim().length > 0) {
      start(tokenInput.value.trim());
    }
  });

  if (urlToken !== null && urlToken.length > 0) {
    // The token rode the URL; go straight to the session without the form.
    attachForm.classList.add('attach-hidden');
    start(urlToken);
  }
}

page_boot();
