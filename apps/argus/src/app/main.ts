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
import { feedListModelSchema, FEED_LIST_MODEL_KIND, feedDagModelSchema, pipelineDiagramModelSchema, pluginInfoModelSchema, dicomSeriesModelSchema, dicomTagsModelSchema, imageViewModelSchema, DICOM_MODEL_KINDS, IMAGE_MODEL_KINDS, type DicomSeriesModel, type DicomTagsModel, DAG_MODEL_KINDS, PLUGIN_INFO_MODEL_KIND, type PipelineDiagramNode, type PluginInfoModel, type PluginParameter, type PromptContext, type WireEnvelope, type WatchState, type LaneTelemetry, type CubeTelemetry, type JobsStateTelemetry } from '@fnndsc/menu';
import { DagScene, type SceneNode } from '../scene/dagScene.js';
import { DormantRegistry, DORMANT_CAP, localKeyStore, type GroupSnapshot, type DesktopAction } from './dormant.js';
import { PanesPanel } from '../features/panes/panel.js';
import { ansi_toHtml, html_escape } from '../console/ansi.js';
import {
  ArgusClient,
  type AttachInfo,
  type ExecuteOutcome,
  type OutputChannel,
  type ProgressMessage,
  type SurfaceAsk,
} from '../calypso/client.js';
import { ArgusTerminal } from '../console/terminal.js';
import { consolePalette_publish } from '../console/ansi.js';
import { ArgusProgress } from '../console/progress.js';
import { FilesPanel, type FileAction, type FsListing, type FsListingEntry, extension_isImage, type PreviewProvider, type GlimpseNode } from '../features/files/panel.js';
import type { ListingAction } from '../features/roster/row.js';
import { FILE_ROW_ROSTER, FILES_SELECTION_ROSTER, RUNS_ROW_ROSTER, type FileRowFacts, type FilesSelectionFacts, type RunsRowFacts } from '../features/roster/verbs.js';
import { GatherPanel, type GatherSeries, type GatherFeed } from '../features/gather/panel.js';
import { Cohort } from '../features/gather/cohort.js';
import { LauncherPanel, type LauncherTile, type LauncherRow } from '../features/launcher/panel.js';
import { runLine_compose, runLine_executable, runLine_flagGet, runLine_flagSet, runLine_hasTitle, runLine_titleAppend, pipelineNode_selector, type RunFlagValue } from '../features/files/runLine.js';
import { DagPanel } from '../features/dag/panel.js';
import { paneAsk_open, paneAsk_abandon, type PaneAskRequest } from '../features/ask/paneAsk.js';
import { PacsPanel } from '../features/pacs/panel.js';
import { EmptyPanel, type ClaimKind } from '../features/empty/panel.js';
import { ViewerPanel } from '../features/view/panel.js';
import { ImagePanel, type SeriesChoice } from '../features/image/panel.js';
import { TagsPanel } from '../features/tags/panel.js';
import { DICOM_FILE_PATTERN, SERIES_FOLDER_PATTERN, seriesFolder_is, VOLUME_FILE_PATTERN, IMAGE_LAYOUTS, IMAGE_COLORMAPS, type ImageLayout, type ImageColormap } from '../features/image/engine.js';
import { SubjectBus, type RegardValue } from './subjects.js';
import { StatusBar } from './status.js';
import { IndexInstrument } from './indexInstrument.js';
import { LaneInstrument } from './laneInstrument.js';
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
// TheLCARS.com's stylesheet is NOT imported. ARGUS's frame is its own, written
// from `tests/smoke/canon/lcars.json` — the computed style of this surface's own
// rendered page — and proven against it at zero differences across 275 elements.
// The theme directory still supplies the FONT the frame names, when an operator
// has put their own LCARS-26.zip where the build can find it; where they have
// not, the type falls back and the frame is unchanged.
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

/** Files the surface opens as the table they are, not as their bytes. */
const TABLE_FILE_PATTERN: RegExp = /\.(csv|tsv)$/i;

/** Watches the header so its slide distance is never a stale measurement. */
let headerHeightObserver: ResizeObserver | null = null;
/**
 * The header's last AT-REST extent. Zoom-from-away cannot measure the header
 * directly — clearing the away state to zoom catches it mid-slide, and a
 * mid-slide measurement is short — so it reads the last rested height here.
 */
let headerRestHeight: number = 0;

/**
 * Keeps `--zoom-header-height` equal to the header's current extent.
 *
 * The header slides off by a measured distance, and its height is not
 * fixed: version rows arrive from the daemon after attach, and a face can
 * be swapped. Measuring once, at the moment of the gesture, left whatever
 * grew afterwards on stage. A ceiling or a pixel of slack does not fix
 * that; keeping the measurement current does.
 *
 * @param header - The header wrap that slides.
 * @param body - The element carrying the custom property.
 */
function headerHeight_track(header: HTMLElement, body: HTMLElement): void {
  const sync = (): void => {
    // Only while the header is at rest. Zooming hides the lid and the
    // status readouts, so a header measured mid-slide is shorter than the
    // distance it has to travel, and tracking it there would shorten the
    // slide until the header reappeared.
    if (body.dataset['zoom'] !== undefined || body.dataset['header'] === 'away') return;
    headerRestHeight = Math.ceil(header.getBoundingClientRect().bottom);
    body.style.setProperty('--zoom-header-height', `${headerRestHeight}px`);
  };
  sync();
  if (headerHeightObserver !== null) return;
  headerHeightObserver = new ResizeObserver(sync);
  headerHeightObserver.observe(header);
}

/** Shortest the console may be dragged, so its strip stays grabbable. */
/**
 * How long PULSE stays lit after it is pressed.
 *
 * The wave itself is the scene's business; this only says the press landed,
 * long enough to read and short enough that the frame is at rest again
 * before anyone looks away.
 */
const DIAGRAM_PULSE_LIT_MS: number = 2200;

const DRAWER_MIN_HEIGHT_PX: number = 120;

/**
 * Space kept above a dragged console.
 *
 * Enough for the page header and the drawer's own bar, so a console pulled
 * to its limit still shows the controls that shrink it again.
 */
const DRAWER_HEADROOM_PX: number = 96;

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
): (closed: boolean) => void {
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
    // The only bounds are the ones the screen imposes: a floor so the strip
    // stays grabbable, and a ceiling so the console cannot push its own
    // header off the top. Everything between is the operator's to choose.
    const ceiling: number = Math.max(DRAWER_MIN_HEIGHT_PX, window.innerHeight - DRAWER_HEADROOM_PX);
    const wanted: number = dragStartHeight + (event.clientY - dragStartY);
    const height: number = Math.min(Math.max(DRAWER_MIN_HEIGHT_PX, wanted), ceiling);
    drawer.style.height = `${height}px`;
    terminal.size_fit();
  });
  window.addEventListener('mouseup', (): void => {
    dragging = false;
    drawer.classList.remove('drawer-dragging');
  });

  return closed_set;
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
  // The header state set aside for the duration of a zoom (see below).
  let headerBeforeZoom: string | undefined;

  const zoom_set = (pane: string | null): void => {
    for (const marked of document.querySelectorAll('.pane-zoomed, .pane-zoomed-path')) {
      marked.classList.remove('pane-zoomed', 'pane-zoomed-path');
    }
    if (pane === null) {
      delete body.dataset['zoom'];
      // Give the header back the state zoom set aside.
      if (headerBeforeZoom !== undefined) {
        body.dataset['header'] = headerBeforeZoom;
        headerBeforeZoom = undefined;
      }
    } else {
      // A scrolled page would carry its offset into the clamped zoom view,
      // hiding the pane's top edge; zoom always starts from the origin.
      window.scrollTo(0, 0);
      // Zoom presents from the header-present geometry: its own slide is the
      // one that reclaims the header's space. If the header is already away it
      // has slid the wrap up once already, so leaving that state on with zoom
      // slides the pane up twice — its top frame, and its controls, off the
      // page. Set the away state aside for the duration; restore it on unzoom.
      // Synchronous with the data-zoom set below, so no header flash paints.
      if (body.dataset['header'] === 'away') {
        headerBeforeZoom = 'away';
        delete body.dataset['header'];
        // The header is mid-slide as its away state clears, so it cannot be
        // measured now; use its last rested extent for the slide distance.
        if (headerRestHeight > 0) body.style.setProperty('--zoom-header-height', `${headerRestHeight}px`);
      } else if (header !== null) {
        // The header's height is content-driven; measure its viewport bottom
        // (not offsetHeight — the first bar's top margin collapses OUT of the
        // wrap, and an offsetHeight slide left that margin's worth of header
        // crushed on stage).
        headerHeight_track(header, body);
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
/** The band's floor and the headroom it leaves the workspace, in pixels. */
const BAND_MIN_HEIGHT_PX: number = 96;
const BAND_HEADROOM_PX: number = 220;
/** Where the operator's chosen band height is remembered, per browser. */
const BAND_HEIGHT_KEY: string = 'argus.headerBand.height';

/**
 * Wires the header band's drag strip: the boundary it shares with the body
 * is a control, exactly as the console drawer's is from the other side.
 *
 * The height is ONE height for every face, so a face switch never moves
 * the workspace, and it is remembered: an operator who wants a tall cohort
 * should not have to ask for it twice. Dragged below the floor the band
 * takes the floor rather than vanishing — a band nobody can see is a band
 * they cannot drag back.
 */
function headerBand_wire(): void {
  const root: HTMLElement = document.documentElement;
  const strip: HTMLElement | null = document.getElementById('header-strip');
  const header: HTMLElement | null = document.querySelector<HTMLElement>('.wrap:not(#gap)');
  if (strip === null || header === null) return;

  const height_apply = (pixels: number): void => {
    const ceiling: number = Math.max(BAND_MIN_HEIGHT_PX, window.innerHeight - BAND_HEADROOM_PX);
    const wanted: number = Math.min(Math.max(BAND_MIN_HEIGHT_PX, pixels), ceiling);
    root.style.setProperty('--header-band-h', `${wanted}px`);
    try { window.localStorage.setItem(BAND_HEIGHT_KEY, String(wanted)); } catch { /* a private window keeps nothing */ }
  };

  const remembered: string | null = ((): string | null => {
    try { return window.localStorage.getItem(BAND_HEIGHT_KEY); } catch { return null; }
  })();
  if (remembered !== null && Number.isFinite(Number(remembered))) height_apply(Number(remembered));

  /** The strip rides the boundary, so it follows the band's own foot. */
  const strip_place = (): void => {
    const box: DOMRect = header.getBoundingClientRect();
    strip.style.top = `${Math.max(0, box.bottom - 5)}px`;
  };
  strip_place();
  window.addEventListener('resize', strip_place);
  new MutationObserver(strip_place).observe(document.body, { attributes: true, attributeFilter: ['data-header'] });
  window.setInterval(strip_place, 500);

  let dragging: boolean = false;
  let startY: number = 0;
  let startHeight: number = 0;
  strip.addEventListener('mousedown', (event: MouseEvent): void => {
    const face: HTMLElement | null = document.querySelector<HTMLElement>('.header-face');
    dragging = true;
    startY = event.clientY;
    startHeight = face === null ? BAND_MIN_HEIGHT_PX : face.getBoundingClientRect().height;
    event.preventDefault();
  });
  window.addEventListener('mousemove', (event: MouseEvent): void => {
    if (!dragging) return;
    height_apply(startHeight + (event.clientY - startY));
    strip_place();
  });
  window.addEventListener('mouseup', (): void => { dragging = false; strip_place(); });
}

/** Set once the surface is up: puts the cohort on the main panel. */
let cohortStage_run: (() => void) | null = null;

function headerFaces_wire(): void {
  const body: HTMLElement = document.body;
  const header: HTMLElement | null = document.querySelector<HTMLElement>('.wrap:not(#gap)');

  const face_select = (face: string): void => {
    if (body.dataset['header'] === face) {
      // Second press on the selected face: the header itself departs, gliding
      // up by its measured height while it leaves the flow (the CSS takes it
      // absolute), so the workspace flows up to fill the top exactly.
      if (header !== null) {
        headerHeight_track(header, body);
      }
      body.dataset['header'] = 'away';
    } else {
      body.dataset['header'] = face;
    }
  };
  document.querySelector('.panel-1')?.addEventListener('click', (): void => face_select('stats'));
  document.querySelector('.panel-2')?.addEventListener('click', (): void => face_select('dag'));
  document.querySelector('.panel-gather')?.addEventListener('click', (): void => face_select('gather'));
  // The band is not a pane, so its own frame opens on its own declaration:
  // the strip toggles it, a press inside it acts, a press on the fill or
  // anywhere else on the band retracts it, as a pane's frame does.
  const bandField: HTMLElement | null = document.querySelector<HTMLElement>('.header-gather-field');
  bandField?.querySelector('.gather-stage')?.addEventListener('click', (event: Event): void => {
    event.stopPropagation();
    cohortStage_run?.();
  });
  bandField?.querySelector('.mode-strip')?.addEventListener('click', (): void => {
    const open: boolean = body.dataset['headerFrame'] === 'open';
    if (open) delete body.dataset['headerFrame'];
    else body.dataset['headerFrame'] = 'open';
  });

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
    // Esc peels one layer at a time: a zoom first, then the gutter, then the
    // header — so the header restores only when nothing inner is still away.
    if (
      event.key === 'Escape' &&
      body.dataset['header'] === 'away' &&
      body.dataset['zoom'] === undefined &&
      body.dataset['gutter'] !== 'away'
    ) {
      header_restore();
    }
  });
}

/**
 * The themes the pill cycles through: four schemes of the imported look,
 * and PHAROS, the house visual language in its clinical palette (docs/pharos.adoc),
 * which is not a scheme of that look but a theme of its own on the same
 * tokens.
 */
const LCARS_SCHEMES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'lower-decks', label: 'LOWER DECKS' },
  { key: 'gold', label: 'CERRITOS GOLD' },
  { key: 'medical', label: 'MEDICAL' },
  { key: 'nemesis', label: 'NEMESIS' },
  { key: 'pharos', label: 'PHAROS' },
];

/** The localStorage key remembering where a session begins. */
const LANDING_STORAGE_KEY: string = 'argus-landing';

/** How often the dashboard re-reads what each domain holds, while it is on stage. */
const DASHBOARD_TICK_MS: number = 15_000;

/**
 * Whether this browser begins at the launcher.
 *
 * A browser that has never said starts there once: the launcher is the
 * answer to "where am I, what can I do, what next", and the resting
 * workspace answers none of them at once. Having seen it, the operator's
 * own choice stands — the capsule on the launcher itself sets this.
 *
 * @returns True when a session should open on the launcher.
 */
function landing_isLauncher(): boolean {
  try {
    return (window.localStorage.getItem(LANDING_STORAGE_KEY) ?? 'launcher') === 'launcher';
  } catch {
    return true;
  }
}

/**
 * Remembers where a session begins.
 *
 * @param on - True to begin at the launcher, false to begin as last left.
 */
function landing_set(on: boolean): void {
  try {
    window.localStorage.setItem(LANDING_STORAGE_KEY, on ? 'launcher' : 'last');
  } catch {
    // A browser without storage still gets the session-long choice.
  }
}

/** The localStorage key remembering the theme. */
const LCARS_STORAGE_KEY: string = 'argus-theme';
/** The key the choice was remembered under before the attribute was renamed. */
const LCARS_STORAGE_KEY_FORMER: string = 'argus-lcars';

/** The scheme a browser that has never chosen one starts in. */
const LCARS_DEFAULT_KEY: string = 'medical';

/** Scheme keys that were renamed, so a remembered choice survives. */
const LCARS_RENAMED: Readonly<Record<string, string>> = { sickbay: 'medical' };

/**
 * Wires the theme pill: each press advances to the next theme. The theme
 * is one declaration (`data-theme` on the root element); the palettes and
 * the ornament live in CSS. The choice persists per browser.
 */
function themePill_wire(): void {
  const pill: HTMLElement = element_require('theme-pill');
  const fallback: number = Math.max(
    LCARS_SCHEMES.findIndex((scheme): boolean => scheme.key === LCARS_DEFAULT_KEY),
    0,
  );
  let index: number = fallback;
  try {
    const saved: string | null =
      window.localStorage.getItem(LCARS_STORAGE_KEY) ?? window.localStorage.getItem(LCARS_STORAGE_KEY_FORMER);
    // A remembered scheme survives its own renaming; a browser that never
    // chose gets the default rather than whichever scheme is listed first.
    const wanted: string | null = saved === null ? null : (LCARS_RENAMED[saved] ?? saved);
    const found: number = LCARS_SCHEMES.findIndex((scheme): boolean => scheme.key === wanted);
    index = found >= 0 ? found : fallback;
  } catch {
    index = fallback;
  }
  // The scheme lives on the root element: the theme's derived variables
  // (--panel-4-color and kin) are resolved where they are defined — :root —
  // so a body-level override would leave them holding the original palette.
  const root: HTMLElement = document.documentElement;
  const paint = (): void => {
    const scheme = LCARS_SCHEMES[index] ?? LCARS_SCHEMES[0]!;
    if (scheme.key === 'lower-decks') {
      delete root.dataset['theme'];
    } else {
      root.dataset['theme'] = scheme.key;
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
    // A narrow header elides a long value rather than wrapping it; the
    // whole fact stays reachable on hover.
    figure.title = value;
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
  const indexInstrument: IndexInstrument = new IndexInstrument(element_require('index-instrument'), (): number => Date.now(), {
    // The ERRORED figure is a control: it opens the runs roster filtered to
    // the feeds it counted. The pane it acts on is put on stage first.
    errored_open: (): void => runs_show('status:error'),
  });
  const laneInstrument: LaneInstrument = new LaneInstrument(element_require('lane-instrument'));
  // The beat's age moves on the surface's own clock, not only on beats.
  window.setInterval((): void => laneInstrument.tick(), 500);

  // Panel rosters: every live controller by instance id, for routing —
  // targeted progress, and the claim rule for console-issued models.
  const filesPanels: Map<string, FilesPanel> = new Map();
  /** The GATHER panes on stage, by pane id (one cohort each). */
  const gatherPanels: Map<string, GatherPanel> = new Map();
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
    // A pane's regard just changed — re-light the PACS rows' verbs to match.
    pacsStage_relight();
  });

  /** Builds the token-gated /vfs URL serving a path's bytes. */
  const vfsUrl_build = (path: string): string =>
    `/vfs?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;

  /**
   * Reads at most `maxBytes` of a file's head through the /vfs route,
   * cancelling the body as soon as enough has arrived — a preview never
   * pulls a whole log across the wire.
   */
  const fileHead_fetch = async (path: string, maxBytes: number): Promise<string> => {
    const response: Response = await fetch(vfsUrl_build(path));
    if (!response.ok || response.body === null) {
      // The route serves what CUBE STORES. A file a VFS provider makes —
      // a package's manifest, a readout under /proc — is perfectly real to
      // the session and unknown to the route, which answered 404 and left
      // the preview blank: a file that reads fine in the console looked
      // like an empty file in the pane. So ask the session, which can read
      // anything it can list. A refusal is carried through rather than
      // swallowed, because a blank tile is the one thing that says nothing.
      const read: FileText = await fileText_fetch(path);
      return read.text.slice(0, maxBytes);
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
    const decoder: TextDecoder = new TextDecoder();
    let text: string = '';
    while (text.length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    void reader.cancel().catch((): void => { /* the body is already released */ });
    return text.slice(0, maxBytes);
  };
  /**
   * A pipeline's authored graph, for a card-sized glimpse. A plugin needs
   * no such fetch: it is one node whatever it declares, and the card draws
   * that node itself.
   */
  const pipelineGlimpse_fetch = async (path: string): Promise<GlimpseNode[] | null> => {
    const specifier: string = /_id(\d+)$/.exec(path)?.[1] ?? path.replace(/^.*\//, '');
    const outcome: ExecuteOutcome = await client.line_execute(`pipeline diagram ${specifier}`, { silent: true, observe: false });
    for (const envelope of outcome.envelopes) {
      if (envelope.model?.kind !== DAG_MODEL_KINDS.pipelineDiagram) continue;
      const parsed = pipelineDiagramModelSchema.safeParse(envelope.model.data);
      if (!parsed.success) continue;
      return parsed.data.nodes.map((node: PipelineDiagramNode): GlimpseNode => ({
        id: node.id,
        parentIds: [...node.parentIds, ...(node.joinParentIds ?? [])],
      }));
    }
    return null;
  };
  /** What a files pane's PREVIEW projection fetches through. */
  const previewProvider: PreviewProvider = {
    imageUrl: vfsUrl_build,
    textHead: fileHead_fetch,
    pipelineGlimpse: pipelineGlimpse_fetch,
  };

  /**
   * A file read's outcome: its text, or why it could not be read.
   *
   * @property ok - Whether the session returned contents.
   * @property text - The contents, or the refusal in the session's words.
   */
  interface FileText {
    ok: boolean;
    text: string;
  }

  /**
   * Fetches a file's text through a silent, pane-local cat.
   *
   * A refusal is an answer. CUBE lists files a shared feed's guest may not
   * read, so a failed read is ordinary and must be reported: joining the
   * rendered text alone turned a 403 into an empty pane, which reads as an
   * empty file.
   */
  const fileText_fetch = (path: string): Promise<FileText> =>
    client
      .line_execute(`cat "${path}"`, { silent: true, observe: false })
      .then((outcome: ExecuteOutcome): FileText => {
        const refused: boolean = outcome.envelopes.some(
          (envelope): boolean => envelope.status === 'error',
        );
        if (!refused) {
          return {
            ok: true,
            text: ansi_strip(outcome.envelopes.map((envelope): string => envelope.rendered).join('\n')),
          };
        }
        const said: string = outcome.envelopes
          .flatMap((envelope): string[] => (envelope.errors ?? []).map((entry): string => entry.message))
          .concat(outcome.envelopes.map((envelope): string => envelope.renderedErr ?? ''))
          .map((line): string => ansi_strip(line).trim())
          .filter((line): boolean => line !== '')
          .join('\n');
        return { ok: false, text: said === '' ? 'the session refused this read and said nothing further' : said };
      });

  // Lowers a file activation. The primary browser is slaved to the session
  // cwd and navigates by real `cd`; a rooted browser (a split's instance)
  // navigates independently by targeted silent listings. A file activation
  // is an indication: it writes the pane's group regard, and when the group
  // holds a viewer, the viewer renders it — the browser overlays its own
  // content only as the viewerless fallback.
  // A rooted browser's own navigation history, for its BACK verb; the
  // primary's back is the session's own `cd -`.
  const rootedHistory: Map<string, string[]> = new Map();
  // Which browsers follow the session cwd. The primary does by default; a
  // split-born browser is rooted by default; either can be re-bound from
  // its drawer (FOLLOW CWD / ROOT HERE) or the language.
  const filesFollow: Map<string, boolean> = new Map();
  // Each browser's binding pair, so a change made anywhere — drawer,
  // language, or a split born rooted — is read back by the control that
  // states it.
  const cwdBindSyncs: Map<string, () => void> = new Map();
  const cwdBind_sync_register = (id: string, sync: () => void): void => {
    cwdBindSyncs.set(id, sync);
  };
  const cwdBind_sync = (id: string): void => {
    cwdBindSyncs.get(id)?.();
  };
  const filesFollow_set = (id: string, on: boolean): void => {
    filesFollow.set(id, on);
    cwdBind_sync(id);
    const panel: FilesPanel | undefined = filesPanels.get(id);
    panel?.follow_set(on);
    if (on && panel !== undefined) {
      // A browser that starts following shows the cwd at once.
      void client
        .line_execute('ls', { silent: true, observe: false })
        .then((outcome: ExecuteOutcome): void => {
          for (const envelope of outcome.envelopes) panel.envelope_observe(envelope);
        });
    }
  };

  /**
   * Delivers files the operator picked into the folder on stage.
   *
   * A browser cannot reach the machine the daemon runs on, so `upload` is
   * not a verb this surface can speak: the bytes go over the daemon's own
   * `/vfs` route, which writes them through the kernel. What the operator
   * sees is the console, as with any other verb — what is being put where,
   * and what became of each file.
   *
   * @param id - The pane whose listing is on stage.
   * @param place - The folder the files land in.
   * @param chosen - The files the operator picked.
   */
  const files_deliver = async (id: string, place: string, chosen: File[]): Promise<void> => {
    for (const file of chosen) {
      const target: string = `${place}/${file.name}`;
      terminal.line_note(`putting ${file.name} in ${place}…`);
      try {
        const response: Response = await fetch(vfsUrl_build(target), {
          method: 'POST',
          body: file,
        });
        if (!response.ok) {
          terminal.line_note(`upload: ${file.name}: ${(await response.text()).trim() || response.statusText}`);
          continue;
        }
        terminal.line_note(`✓ ${target}`);
      } catch (error: unknown) {
        terminal.line_note(`upload: ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // The listing must show what landed in it; a browser that says nothing
    // changed is a browser the operator stops believing.
    listing_refresh(id, place);
  };

  /**
   * Asks a browser for its place again, after something changed it.
   *
   * A following browser re-lists through the session, so the transcript
   * shows the same `ls` an operator would have typed; a rooted one asks for
   * its own place silently, which is how it navigates already.
   *
   * @param id - The pane to refresh.
   * @param place - The folder it is showing.
   */
  const listing_refresh = (id: string, place: string): void => {
    const panel: FilesPanel | undefined = filesPanels.get(id);
    if (panel === undefined) return;
    if (filesFollow.get(id) === true) terminal.line_run('ls');
    else rootedListing_show(id, panel, place);
  };

  /**
   * Asks for a name and makes a directory in a place: the MKDIR block on
   * the frame and the `.` row's NEW DIR are one gesture with two homes.
   *
   * @param id - The browser pane asking.
   * @param place - The directory to make it in.
   */
  const directory_make = (id: string, place: string): void => {
    void ask_onPane(id, { message: `New directory in ${place}: `, kind: 'text', commit: 'MAKE IT' })
      .then((name: string | null): void => {
        const wanted: string = (name ?? '').trim();
        // An abandoned question makes nothing, and says nothing: the
        // operator withdrew it, which is not an error to report.
        if (wanted === '') return;
        terminal.line_run(`mkdir "${place}/${wanted}"`);
        // `mkdir` renders what it made; it does not re-list the folder
        // it made it in, so the browser asks for the place again.
        listing_refresh(id, place);
      });
  };

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

  /**
   * Highlights the /bin description grammar client-side when the daemon
   * sent plain text: section headings, `Key:` labels, flags, and quoted
   * values. ANSI-colored text is rendered as sent.
   */
  const binText_highlight = (text: string): string => {
    if (/\x1b\[/.test(text)) return ansi_toHtml(text);
    // Passes run inline-first, line-anchored last: the later patterns are
    // anchored at line starts and cannot match inside markup the earlier
    // ones inserted.
    return html_escape(text)
      .replace(/(&quot;[^&]*&quot;)/g, '<span class="man-str">$1</span>')
      .replace(/(^|\s)(--?[a-zA-Z][\w-]*)/g, '$1<span class="man-flag">$2</span>')
      .replace(/^(\s{0,2})([A-Za-z_ ]+):(\s)/gm, '$1<span class="man-key">$2:</span>$3')
      .replace(/^([A-Z][A-Z ]{2,})$/gm, '<span class="man-head">$1</span>');
  };

  /**
   * What a /bin entry contributes to the one graph view: a summary above the
   * stage (empty when the graph says it all), the graph itself, and how one
   * of its nodes reads out.
   *
   * @property text - Summary HTML shown above the stage; '' for none.
   * @property nodes - The graph, as the scene wants it.
   * @property facts_show - Fills the overlay for one node, selected or immersed,
   *   writing into the form's line when the view is a form.
   */
  interface BinGraph {
    text: string;
    nodes: SceneNode[];
    facts_show: (facts: HTMLElement, nodeId: string, immersed: boolean, form: BinForm | null) => void;
  }

  /**
   * The graph as a form: the line a bound catalogue holds, read and written
   * by the dive's VALUE cells. The line is the only state — a value typed
   * here is a flag there, and a hand edit there is what a cell reads here.
   *
   * @property line_get - The line as the strip holds it.
   * @property line_set - Writes the line back to the strip.
   * @property run - Runs the line, as RUN in the row zone does.
   */
  interface BinForm {
    line_get: () => string;
    line_set: (line: string) => void;
    run: () => void;
  }

  /**
   * One row of a node's readout: a label and what it says, and — in a form —
   * the flag the row edits, with the kind of value it takes.
   */
  interface FactRow {
    label: string;
    value: string;
    edit?: { flag: string; type: string; placeholder: string };
  }

  /**
   * Opens a /bin entry as the graph it is.
   *
   * Both kinds take this path: a pipeline is many nodes, a plugin is one,
   * and there is no third rendering. What used to be a plugin's wall of
   * scraped text is now the same stage, the same mode frame and the same
   * dive-in gesture every other entry answers to.
   *
   * @param panel - The pane to open the view in.
   * @param path - The /bin entry.
   * @param graph_fetch - Reads the entry, once the view is up.
   */
  const binGraph_show = (
    panel: FilesPanel,
    path: string,
    graph_fetch: () => Promise<BinGraph | null>,
    form: BinForm | null,
  ): void => {
    let scene: DagScene | null = null;
    let modeRelease: (() => void) | null = null;
    const mount: HTMLElement | null = panel.contentHtml_show(path, '', {
      diagram: true,
      release: (): void => {
        binDive = null;
        modeRelease?.();
        modeRelease = null;
        panel.mode_annunciate('');
        scene?.dispose();
        scene = null;
      },
    });
    if (mount === null) return;

    void graph_fetch().then((graph: BinGraph | null): void => {
      if (!mount.isConnected) return;
      if (graph === null || graph.nodes.length === 0) {
        mount.textContent = 'NOTHING TO DRAW FOR THIS ENTRY';
        mount.classList.add('files-diagram-empty');
        return;
      }
      if (graph.text !== '') panel.contentText_set(graph.text);
      const facts: HTMLElement = document.createElement('div');
      facts.className = 'dag-facts';
      mount.appendChild(facts);
      const built: DagScene = new DagScene(mount, {
        // A node's substance already arrived with the graph, so a touch
        // reads it out and a dive goes in. Nothing is fetched for either.
        select: (node: SceneNode): void => graph.facts_show(facts, node.id, false, form),
        activate: (node: SceneNode): void => dive(node),
        deselect: (): void => facts.replaceChildren(),
      }, {});
      const dive = (node: SceneNode): void => {
        built.flight_into(node.id, (): void => {
          binDive = { scene: built, facts };
          graph.facts_show(facts, node.id, true, form);
        });
      };
      scene = built;
      built.graph_set({ nodes: graph.nodes }, { wave: false });
      built.size_fit();
      modeRelease = diagramModes_wire(mount, built, panel, form === null ? undefined : form.run);
      // A level of one opens itself: a plugin is one node, and the only
      // thing to do on its stage is go in. The camera still flies, so the
      // dive reads as the same gesture a pipeline's node answers to.
      const only: SceneNode | undefined = graph.nodes.length === 1 ? graph.nodes[0] : undefined;
      if (only !== undefined) dive(only);
    });
  };

  /**
   * Reads a registered pipeline as its authored graph.
   *
   * @param path - The /bin entry.
   * @returns The graph, or null when the pipeline has no diagram.
   */
  const pipelineGraph_fetch = async (path: string): Promise<BinGraph | null> => {
    const specifier: string = /_id(\d+)$/.exec(path)?.[1] ?? path.replace(/^.*\//, '');
    // Asked together: the summary is a cache-only read and the diagram a
    // slow one, and making the stage wait on the text buys nothing.
    const [summary, diagram]: [ExecuteOutcome, ExecuteOutcome] = await Promise.all([
      client.line_execute(`cat "${path}"`, { silent: true, observe: false }),
      client.line_execute(`pipeline diagram ${specifier}`, { silent: true, observe: false }),
    ]);
    const text: string = summary.envelopes.map((envelope): string => envelope.rendered).join('\n');
    for (const envelope of diagram.envelopes) {
      if (envelope.model?.kind !== DAG_MODEL_KINDS.pipelineDiagram) continue;
      const parsed = pipelineDiagramModelSchema.safeParse(envelope.model.data);
      if (!parsed.success) continue;
      const authored: Map<string, PipelineDiagramNode> = new Map(
        parsed.data.nodes.map((node: PipelineDiagramNode): [string, PipelineDiagramNode] => [node.id, node]),
      );
      return {
        text: binText_highlight(text),
        nodes: parsed.data.nodes.map((node: PipelineDiagramNode): SceneNode => ({
          id: node.id,
          label: node.label,
          parentIds: node.parentIds,
          joinParentIds: node.joinParentIds,
        })),
        facts_show: (facts: HTMLElement, nodeId: string, immersed: boolean, form: BinForm | null): void => {
          const titles: string[] = parsed.data.nodes.map((node: PipelineDiagramNode): string => node.label);
          facts_paint(facts, pipelineNodeRows_build(authored.get(nodeId), immersed, form !== null, titles), immersed, form);
        },
      };
    }
    return null;
  };

  /**
   * Reads a registered plugin as the one-node graph it is.
   *
   * @param path - The /bin entry.
   * @returns The graph, or null when the kernel could not read the plugin.
   */
  const pluginGraph_fetch = async (path: string): Promise<BinGraph | null> => {
    const entry: string = path.replace(/^.*\//, '');
    const outcome: ExecuteOutcome = await client.line_execute(`plugin info "${entry}"`, { silent: true, observe: false });
    for (const envelope of outcome.envelopes) {
      if (envelope.model?.kind !== PLUGIN_INFO_MODEL_KIND) continue;
      const parsed = pluginInfoModelSchema.safeParse(envelope.model.data);
      if (!parsed.success) continue;
      const model: PluginInfoModel = parsed.data;
      return {
        text: '',
        nodes: [{ id: entry, label: model.name, parentIds: [], joinParentIds: [] }],
        facts_show: (facts: HTMLElement, _nodeId: string, immersed: boolean, form: BinForm | null): void => {
          facts_paint(facts, pluginRows_build(model, immersed, form !== null), immersed, form);
        },
      };
    }
    return null;
  };

  /**
   * Opens a /bin entry as context.
   *
   * @param panel - The pane to open it in.
   * @param path - The entry's path.
   * @param kind - Whether the entry is a plugin or a pipeline.
   */
  const binEntry_show = (id: string, panel: FilesPanel, path: string, kind: 'plugin' | 'pipeline'): void => {
    binGraph_show(panel, path, (): Promise<BinGraph | null> =>
      kind === 'plugin' ? pluginGraph_fetch(path) : pipelineGraph_fetch(path), binForm_of(id, panel, path, kind));
  };

  /**
   * The form a /bin entry's graph is, when the pane is a catalogue bound to
   * an input: the strip's line, started afresh for this executable unless
   * it already runs it (a hand edit stands; another entry's line does not).
   *
   * @param id - The pane.
   * @param panel - Its files panel.
   * @param path - The entry on stage.
   * @param kind - Whether it is a plugin or a pipeline.
   * @returns The form, or null when the pane is a browser.
   */
  const binForm_of = (id: string, panel: FilesPanel, path: string, kind: 'plugin' | 'pipeline'): BinForm | null => {
    const binding: CatalogueBinding | undefined = catalogueBindings.get(id);
    if (binding === undefined) return null;
    const executable: string = path.replace(/^.*\//, '');
    if (runLine_executable(panel.commandLine_get()) !== executable) {
      panel.commandLine_set(runLine_compose(binding.input, executable));
    }
    return {
      line_get: (): string => panel.commandLine_get(),
      line_set: (line: string): void => panel.commandLine_set(line),
      run: (): void => { void run_press(id, executable, kind); },
    };
  };


/**
 * Wires the pane's mode frame to a diagram on stage.
 *
 * A pane has ONE frame, and its blocks answer to what the field holds: the
 * listing's projection and filter step aside for the modes a graph has.
 * Offering LIST over a pipeline's DAG was a control that could not act.
 *
 * PULSE is a verb here, not a state. The cockpit animates nothing at rest —
 * a law written after rotating thumbnails were proposed and rejected — so
 * the wave runs once, when a hand asks for it. And a registered pipeline has
 * never run, so what the wave replays is dependency order, not history.
 *
 * @param mount - The diagram's mount, used to find the pane's frame.
 * @param scene - The scene the blocks act on.
 * @param panel - The panel whose bar annunciates the modes in force.
 * @returns A function releasing the listeners when the view closes.
 */

  /**
   * The /bin diagram currently flown into, if any: the scene holding the
   * camera and the overlay to clear when it comes home.
   */
  let binDive: { scene: DagScene; facts: HTMLElement } | null = null;

  /**
   * Leaves a /bin node, flying the camera back to where it was.
   *
   * @returns True when a dive was in progress and this ended it.
   */
  function binDive_leave(): boolean {
    const dive: { scene: DagScene; facts: HTMLElement } | null = binDive;
    if (dive === null) return false;
    binDive = null;
    dive.scene.flight_back((): void => {
      dive.facts.classList.remove('dag-facts-immersed');
      dive.facts.replaceChildren();
    });
    return true;
  }

  /**
   * Paints a node's readout as `text : detail` pairs.
   *
   * One painter for every /bin entry: a pipeline's node and a plugin differ
   * in what they have to say, never in how it is said.
   *
   * In a form, a row that edits a flag carries a VALUE cell: what the line
   * says for that flag now, written back to the line on every keystroke. A
   * boolean is a check, since the console takes it bare.
   *
   * @param facts - The overlay to fill.
   * @param rows - The rows, in reading order.
   * @param immersed - Whether the camera has flown into the node.
   * @param form - The line the cells read and write, or null for a readout.
   */
  function facts_paint(
    facts: HTMLElement,
    rows: ReadonlyArray<FactRow>,
    immersed: boolean,
    form: BinForm | null,
  ): void {
    facts.replaceChildren();
    facts.classList.toggle('dag-facts-immersed', immersed);
    for (const { label, value, edit } of rows) {
      const row: HTMLDivElement = document.createElement('div');
      row.className = 'telemetry-row';
      const name: HTMLSpanElement = document.createElement('span');
      name.className = 'telemetry-label';
      name.textContent = label;
      row.appendChild(name);
      if (edit === undefined || form === null) {
        const figure: HTMLSpanElement = document.createElement('span');
        figure.className = 'telemetry-value';
        figure.textContent = value;
        row.appendChild(figure);
      } else {
        const current: RunFlagValue = runLine_flagGet(form.line_get(), edit.flag);
        const input: HTMLInputElement = document.createElement('input');
        input.className = 'telemetry-input';
        input.spellcheck = false;
        input.autocomplete = 'off';
        input.title = `${edit.flag} — ${value}`;
        if (edit.type === 'boolean') {
          input.type = 'checkbox';
          input.checked = current === true;
          input.addEventListener('change', (): void => {
            form.line_set(runLine_flagSet(form.line_get(), edit.flag, input.checked ? true : null));
          });
        } else {
          input.type = 'text';
          input.placeholder = edit.placeholder;
          input.value = current === null || current === true ? '' : current;
          input.addEventListener('input', (): void => {
            form.line_set(runLine_flagSet(form.line_get(), edit.flag, input.value));
          });
        }
        const hint: HTMLSpanElement = document.createElement('span');
        hint.className = 'telemetry-hint';
        hint.textContent = value;
        row.append(input, hint);
      }
      facts.appendChild(row);
    }
  }

  /**
   * What a pipeline node has to say: what it WILL run with — a plugin, a
   * version, and the arguments the author fixed. All of it rides the
   * `pipeline.diagram` model already, so neither a touch nor a dive fetches
   * anything.
   *
   * Immersed, every argument is listed. Selected, the node is one of many
   * on stage, so the readout says what it is plus how much there is to
   * see — a glance is not a wall of text, the complaint that started this
   * epic.
   *
   * As a form, the node's header reads `title · @id` and each authored
   * argument is a VALUE cell writing `--<node>.<param>` — the node its
   * title when shell-safe and unique, else `@<pipingId>`, as the kernel
   * resolves it. Only edited values reach the line: a sparse overlay on
   * what the author fixed.
   *
   * @param node - The authored node, when the model carried one.
   * @param immersed - Whether the camera has flown into it.
   * @param form - Whether the view is a form.
   * @param titles - Every node title in the pipeline, for the selector.
   * @returns The rows to paint.
   */
  function pipelineNodeRows_build(
    node: PipelineDiagramNode | undefined,
    immersed: boolean,
    form: boolean,
    titles: ReadonlyArray<string>,
  ): FactRow[] {
    if (node === undefined) return [];
    const args: ReadonlyArray<{ name: string; value?: unknown }> = node.arguments ?? [];
    const rows: FactRow[] = [
      { label: 'NODE', value: `${node.label} · @${node.id}` },
      { label: 'PLUGIN', value: node.pluginName },
      ...(node.pluginVersion !== undefined ? [{ label: 'VERSION', value: node.pluginVersion }] : []),
    ];
    if (immersed) {
      // An authored node with nothing fixed says so: an empty panel would
      // read as a failure to load rather than as a plugin run on defaults.
      const selector: string = pipelineNode_selector(node.label, node.id, titles);
      rows.push(...(args.length === 0
        ? [{ label: 'ARGUMENTS', value: 'none — this node runs on the plugin\'s defaults' }]
        : args.map((argument): FactRow => ({
          label: argument.name,
          value: String(argument.value ?? ''),
          ...(form ? { edit: { flag: `--${selector}.${argument.name}`, type: typeof argument.value === 'boolean' ? 'boolean' : 'string', placeholder: String(argument.value ?? '') } } : {}),
        }))));
    } else {
      rows.push({ label: 'ARGUMENTS', value: args.length === 0 ? 'none' : `${args.length} — open the node to read them` });
    }
    return rows;
  }

  /**
   * What a plugin has to say: what it CAN run with — every parameter it
   * declares, with the flag as an operator types it.
   *
   * The pipeline node's readout says the arguments an author already fixed;
   * a plugin's says the ones nobody has fixed yet. Same gesture, same
   * shape, and the difference is honest.
   *
   * As a form, every parameter is a VALUE cell writing its flag into the
   * line; what the readout said (type, required, default, help) stays as
   * the cell's hint.
   *
   * @param model - The plugin model.
   * @param immersed - Whether the camera has flown into the node.
   * @param form - Whether the view is a form.
   * @returns The rows to paint.
   */
  function pluginRows_build(model: PluginInfoModel, immersed: boolean, form: boolean): FactRow[] {
    const rows: FactRow[] = [
      { label: 'PLUGIN', value: model.name },
      { label: 'VERSION', value: model.version },
      { label: 'TYPE', value: model.type.toUpperCase() },
    ];
    const parameters: ReadonlyArray<PluginParameter> = model.parameters;
    if (!immersed) {
      rows.push({ label: 'PARAMETERS', value: parameters.length === 0
        ? 'none'
        : `${parameters.length} — open the node to read them` });
      return rows;
    }
    if (parameters.length === 0) {
      rows.push({ label: 'PARAMETERS', value: 'none — this plugin takes no arguments' });
      return rows;
    }
    for (const parameter of parameters) {
      const parts: string[] = [parameter.type];
      if (!parameter.optional) parts.push('required');
      const fallback: string = parameter.default === undefined || parameter.default === null ? '' : String(parameter.default);
      if (fallback !== '') parts.push(`default ${fallback}`);
      const meta: string = parts.join(' · ');
      rows.push({
        label: parameter.flag,
        value: parameter.help === undefined ? meta : `${meta} — ${parameter.help}`,
        // The cell's ghost is the default alone: the hint beside it says the rest.
        ...(form ? { edit: { flag: parameter.flag, type: parameter.type, placeholder: fallback } } : {}),
      });
    }
    return rows;
  }

  function diagramModes_wire(mount: HTMLElement, scene: DagScene, panel: FilesPanel, run?: () => void): () => void {
  const body: HTMLElement | null = mount.closest<HTMLElement>('.files-body');
  const strategyPill: HTMLElement | null = body?.querySelector<HTMLElement>('.diagram-strategy') ?? null;
  const projectionPill: HTMLElement | null = body?.querySelector<HTMLElement>('.diagram-projection') ?? null;
  const pulsePill: HTMLElement | null = body?.querySelector<HTMLElement>('.diagram-pulse') ?? null;
  // RUN rides the graph's frame only when the graph is a form.
  const runPill: HTMLElement | null = run === undefined ? null : body?.querySelector<HTMLElement>('.diagram-run') ?? null;
  const run_press = (): void => run?.();

  const modes_annunciate = (): void => {
    // Only what is NOT the default is worth saying; a bar that repeats the
    // resting state says nothing and costs a glance.
    const parts: string[] = [];
    if (scene.strategy_get() !== 'ranked') parts.push('MOLECULE');
    if (scene.projection_get() !== '3d') parts.push('2D');
    panel.mode_annunciate(parts.join(' · '));
  };

  const strategy_flip = (): void => {
    scene.strategy_set(scene.strategy_get() === 'ranked' ? 'molecule' : 'ranked');
    if (strategyPill !== null) strategyPill.textContent = scene.strategy_get().toUpperCase();
    modes_annunciate();
  };
  const projection_flip = (): void => {
    scene.projection_set(scene.projection_get() === '3d' ? '2d' : '3d');
    if (projectionPill !== null) projectionPill.textContent = scene.projection_get().toUpperCase();
    modes_annunciate();
  };
  const pulse_fire = (): void => {
    scene.wave_start();
    pulsePill?.classList.add('pulse-running');
    window.setTimeout((): void => pulsePill?.classList.remove('pulse-running'), DIAGRAM_PULSE_LIT_MS);
  };

  if (strategyPill !== null) strategyPill.textContent = scene.strategy_get().toUpperCase();
  if (projectionPill !== null) projectionPill.textContent = scene.projection_get().toUpperCase();
  strategyPill?.addEventListener('click', strategy_flip);
  projectionPill?.addEventListener('click', projection_flip);
  pulsePill?.addEventListener('click', pulse_fire);
  runPill?.addEventListener('click', run_press);
  modes_annunciate();

  return (): void => {
    strategyPill?.removeEventListener('click', strategy_flip);
    projectionPill?.removeEventListener('click', projection_flip);
    pulsePill?.removeEventListener('click', pulse_fire);
    runPill?.removeEventListener('click', run_press);
    pulsePill?.classList.remove('pulse-running');
  };
  }

  const fileAction_handle = (
    id: string,
    panel: FilesPanel,
    action: FileAction,
  ): void => {
    if (action.kind === 'dir') {
      if (filesFollow.get(id) === true) {
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
    if (action.kind === 'plugin' || action.kind === 'pipeline') {
      binEntry_show(id, panel, action.path, action.kind);
      return;
    }
    // A volume or a DICOM slice is an image: it opens beside the browser,
    // never as bytes in a text view.
    if (imagery_is(action.path)) {
      void image_open(id, action.path).then((line: string): void => terminal.line_note(line));
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
    void fileText_fetch(action.path).then((read: FileText): void => {
      if (!read.ok) {
        panel.contentRefused_show(action.path, read.text);
        return;
      }
      // A CSV is a table, and every table on this surface is a listing.
      if (TABLE_FILE_PATTERN.test(action.path)) panel.contentTable_show(action.path, read.text);
      else panel.content_show(action.path, read.text);
    });
  };

  /**
   * Whether a path names something an image pane draws rather than a text
   * view: a NIfTI/MGZ volume, or a DICOM slice.
   *
   * One rule, asked by every surface that answers a file click. The browser
   * knew it and the node dive did not, so a volume a run had just produced
   * was read as text inside its own node and refused by the kernel — the
   * one file in the feed the operator most wanted to see.
   *
   * @param path - The file's path.
   * @returns True when an image pane is what opens it.
   */
  const imagery_is = (path: string): boolean =>
    VOLUME_FILE_PATTERN.test(path) || DICOM_FILE_PATTERN.test(path);

  /** Stamps a files body (frame members + panel) from the files template. */
  const filesBody_stamp = (): HTMLElement => {
    const body: HTMLElement | null = template_stamp('tpl-pane-files').querySelector<HTMLElement>('.files-body');
    if (body === null) throw new Error('tpl-pane-files has no files-body');
    return body;
  };

  /**
   * The feed a path names, by the kernel's own rule.
   *
   * `aclTarget_resolve` matches `/feeds/feed_<id>/` anywhere in a path, so a
   * file deep inside a feed shares as its feed does. The rule is repeated
   * here rather than imported because a browser surface holds no kernel
   * code; it is one regex and the kernel owns the meaning.
   *
   * @param path - The row's path.
   * @returns The feed id, or null when nothing in the path names one.
   */
  /**
   * The plugin instance whose own `data/` a path is, when it is one:
   * `…/<plugin>_<id>/data` (with or without a trailing slash). Inside a
   * feed only such a directory can be processed — the kernel appends to the
   * node whatever was named beneath it.
   *
   * @param path - The path.
   * @returns The instance id, or null.
   */
  /** The session's user, as the prompt context last named it; null before the first. */
  let promptUser: string | null = null;
  /** The session's identity (user and CUBE), as the prompt last named it. */
  let promptIdentity: string | null = null;

  const nodeOf_path = (path: string): number | null => {
    const match: RegExpMatchArray | null = /_(\d+)\/data\/?$/.exec(path);
    return match === null ? null : parseInt(match[1] ?? '', 10);
  };

  /** What a bound catalogue processes: the input, and where a run of it lands. */
  interface CatalogueBinding {
    input: string;
    feed: number | null;
    node: number | null;
  }
  const catalogueBindings: Map<string, CatalogueBinding> = new Map();

  const feedOf_path = (path: string): number | null => {
    // A feed has two addresses: the folder it stores its output in, and the
    // projection the graph renders it as. Both name the same feed, and a
    // row that knew only the first offered a node under /proc a NEW feed
    // rather than the one it is already in.
    const held: RegExpMatchArray | null = path.match(/\/(?:feeds|jobs)\/feed_(\d+)(?:\/|$)/);
    return held === null ? null : Number(held[1]);
  };

  /**
   * Whether a path is a projection: the kernel renders it and nothing
   * writes it, so the verbs that would write have nothing to act on.
   *
   * @param path - The path a row or a field names.
   * @returns True for `/proc`, `/net`, `/etc` and `/usr/share`.
   */
  const path_isProjection = (path: string): boolean => /^\/(proc|net|etc|usr)(\/|$)/.test(path);

  /**
   * What a row may be told to do.
   *
   * Every verb lowers to a session command the operator can read in the
   * transcript — never a silent mutation behind a capsule. DELETE lowers to
   * `rm -i`, so the KERNEL raises the confirmation and one confirmation
   * grammar serves every surface; MOVE and COPY lower to a one-operand `mv`
   * and `cp`, whose missing destination is the ask that opens the errand.
   *
   * @param id - The pane whose row this is.
   * @param entry - The row's entry.
   * @param path - The row's path.
   * @returns The verbs this row is offered.
   */
  const rowVerbs_of = (
    id: string,
    entry: FsListingEntry,
    path: string,
  ): ReadonlyArray<ListingAction<FsListingEntry>> => {
    const quoted: string = `"${path}"`;
    const directory: boolean = entry.type === 'dir' || entry.type === 'vfs' || entry.type === 'job';
    // Which verbs a row is offered is the roster's to say
    // (features/roster/verbs.ts); what each one does is this pane's.
    const feed: number | null = feedOf_path(path);
    const facts: FileRowFacts = {
      kind: entry.type === 'plugin' || entry.type === 'pipeline'
        ? 'catalogue'
        : directory && seriesFolder_is(path, entry.name)
          ? 'seriesFolder'
          : entry.type === 'file' ? 'file' : 'directory',
      feed,
      node: feed === null ? null : nodeOf_path(path),
      bound: catalogueBindings.has(id),
      projection: path_isProjection(path),
    };
    const runs: Record<string, () => void> = {
      image: (): void => {
        void image_open(id, path).then((line: string): void => terminal.line_note(line));
      },
      download: (): void => { window.open(vfsUrl_build(path), '_blank'); },
      // PROCESS acts on the place: a bound catalogue opens beside this pane.
      process: (): void => process_open(id, { input: path, feed, node: feed === null ? null : nodeOf_path(path) }),
      // GATHER takes the PLACE into the session's cohort, beside whatever
      // PACS series are already in it. The member is keyed by its path,
      // since a directory has no series UID and the path is what a run
      // would be given.
      gather: (): void => cohort_gather([{
        kind: 'dir',
        seriesUID: path,
        description: entry.name,
        imagery: seriesFolder_is(path, entry.name),
        modality: seriesFolder_is(path, entry.name) ? 'MR' : '—',
        patient: promptUser ?? '',
        vfsPath: path,
        folderPath: path,
      }]),
      // RUN runs the line on the catalogue's input, as the console would.
      run: (): void => { void run_press(id, entry.name, entry.type === 'pipeline' ? 'pipeline' : 'plugin'); },
      move: (): void => verbLine_run(id, `mv ${quoted}`),
      copy: (): void => verbLine_run(id, `cp ${quoted}`),
      delete: (): void => verbLine_run(id, `rm ${directory ? '-ri' : '-i'} ${quoted}`),
      share: (): void => verbLine_run(id, `setfacl ${quoted}`),
    };
    return FILE_ROW_ROSTER.rules
      .filter((rule): boolean => rule.offered(facts))
      .map((rule): ListingAction<FsListingEntry> => ({
        label: rule.label(facts),
        run: (): void => runs[rule.name]?.(),
      }));
  };

  /**
   * Reads an access list out of a silent `getfacl`.
   *
   * The envelope's own model carries the identities; the rendered text is
   * for a terminal. A feed shared with nobody says so rather than showing
   * an empty space that reads as a failed read.
   *
   * @param outcome - What the silent command returned.
   * @returns The readout for the row.
   */
  const shares_read = (outcome: ExecuteOutcome): string => {
    for (const envelope of outcome.envelopes) {
      const model: unknown = envelope.model;
      if (typeof model !== 'object' || model === null) continue;
      const data: unknown = (model as { kind?: unknown; data?: unknown }).data;
      if ((model as { kind?: unknown }).kind !== 'fs.acl' || !Array.isArray(data)) continue;
      const names: string[] = [];
      for (const held of data as Array<{ usernames?: unknown }>) {
        if (Array.isArray(held.usernames)) names.push(...held.usernames.map(String));
      }
      return names.length === 0 ? 'SHARED WITH NOBODY' : `SHARED WITH ${names.join(', ')}`;
    }
    return 'ACCESS UNREAD';
  };

  // Builds one files pane instance from the template; a catalogue is the
  // same pane wearing catalogue traits, for `/bin` bound to an input.
  const filesInstance_build = (id: string, primary: boolean, catalogue: boolean = false): PaneInstance => {
    const mount: HTMLElement = template_stamp('tpl-pane-files');
    const panel: FilesPanel = new FilesPanel(
      pane_find(mount, '.files-panel'),
      (action: FileAction): void => fileAction_handle(id, panel, action),
      previewProvider,
      { catalogue },
    );
    // A selection's verbs are the row's verbs over many rows, and the kernel
    // already takes many operands — so each is ONE line the operator could
    // have typed, not twenty lines they must audit.
    panel.selectionVerbs_declare((rows) => {
      const paths: string[] = rows.map(([path]): string => path);
      const quoted: string = paths.map((path: string): string => `"${path}"`).join(' ');
      const files: boolean = rows.every(([, entry]): boolean => entry.type === 'file');
      const feeds: number[] = [];
      for (const path of paths) {
        const feed: number | null = feedOf_path(path);
        if (feed !== null && !feeds.includes(feed)) feeds.push(feed);
      }
      const facts: FilesSelectionFacts = { count: paths.length, feeds };
      const runs: Record<string, () => void> = {
        // -I asks ONCE for the whole list: twenty questions to remove
        // twenty files is a confirmation an operator learns to dismiss.
        delete: (): void => verbLine_run(id, `rm -rI ${quoted}`),
        // `-t` with no value: every operand is a SOURCE and the target is
        // asked for. Without it `mv a b` is a rename of a onto b — the
        // right reading of that line, and the wrong thing for a set.
        move: (): void => terminal.line_run(`mv -t ${quoted}`),
        copy: (): void => terminal.line_run(`cp -t ${quoted}`),
        // A grant is per feed, so a selection of twenty files in one feed
        // is ONE grant: the capsule names the feeds, not the files.
        share: (): void => terminal.line_run(
          `setfacl ${feeds.map((feed: number): string => `feed_${feed}`).join(' ')}`,
        ),
      };
      void files;
      return FILES_SELECTION_ROSTER.rules
        .filter((rule): boolean => rule.offered(facts))
        .map((rule): ListingAction<void> => ({
          label: rule.label(facts),
          run: (): void => runs[rule.name]?.(),
        }));
    });
    panel.rowVerbs_declare(
      (entry, path: string) => rowVerbs_of(id, entry, path),
      (_entry, path: string): void => {
        // Indicating IS the regard: a viewer in the group renders what the
        // operator pointed at, without their having to open it first.
        subjects.regard_write(id, { address: path, modelKind: 'fs.file' });
        // A verb that grants access says what is already granted. The read
        // is silent (an instrument, not a command the operator issued) and
        // lands beside the verbs when it arrives.
        if (feedOf_path(path) === null) return;
        void client
          .line_execute(`getfacl "${path}"`, { silent: true, observe: false })
          .then((outcome: ExecuteOutcome): void => {
            panel.rowReadout_show(path, shares_read(outcome));
          })
          .catch((): void => { panel.rowReadout_show(path, 'ACCESS UNREAD'); });
      },
    );
    filesPanels.set(id, panel);
    rootedHistory.set(id, []);
    filesFollow.set(id, primary);
    cwdBind_sync(id);
    panel.follow_set(primary);
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

  // The image pane: a series or a volume on a guest engine's field, inside
  // mise's frame (docs/aegis.adoc: an-instruments-field-is-foreign,
  // focus-stays-in-the-field).
  const imagePanels: Map<string, ImagePanel> = new Map();
  const imageInstance_build = (id: string): PaneInstance => {
    const mount: HTMLElement = template_stamp('tpl-pane-image');
    const panel: ImagePanel = new ImagePanel(mount, {
      source: { url_of: vfsUrl_build },
      note: (line: string): void => terminal.line_note(line),
      regard: (path: string): void => subjects.regard_write(id, { address: path, modelKind: 'dicom.instance' }),
      file_put: async (path: string, body: Blob): Promise<number> => {
        try {
          return (await fetch(vfsUrl_build(path), { method: 'POST', body })).status;
        } catch {
          return 0;
        }
      },
      // The overlay reads the header of the series on the field. Same ask
      // the tags pane makes, same silence: an instrument never interrupts.
      tags_read: (path: string): Promise<DicomTagsModel | null> => tags_ask(path),
      tags_open: (): void => {
        terminal.line_note(tagsPane_open(id));
      },
    });
    imagePanels.set(id, panel);
    return {
      id,
      kind: 'image',
      mount,
      dispose: (): void => {
        panel.dispose();
        imagePanels.delete(id);
        subjects.pane_leave(id);
      },
    };
  };

  // The tags pane: a DICOM instance's elements, following the image pane's
  // slice through the group's regard (docs/aegis.adoc: tags-follow-the-image).
  const tagsPanels: Map<string, TagsPanel> = new Map();
  const tagsInstance_build = (id: string): PaneInstance => {
    const mount: HTMLElement = template_stamp('tpl-pane-tags');
    const panel: TagsPanel = new TagsPanel(mount, {
      note: (line: string): void => terminal.line_note(line),
    });
    tagsPanels.set(id, panel);
    return {
      id,
      kind: 'tags',
      mount,
      dispose: (): void => {
        tagsPanels.delete(id);
        subjects.pane_leave(id);
      },
    };
  };

  /** Asks the kernel for a file's tags, silently, and paints them on a tags pane. */
  const tags_ask = async (path: string): Promise<DicomTagsModel | null> => {
    try {
      const outcome: ExecuteOutcome = await client.line_execute(`dcm tags "${path}"`, { silent: true, observe: false });
      for (const envelope of outcome.envelopes) {
        if (envelope.model?.kind !== DICOM_MODEL_KINDS.tags) continue;
        const parsed = dicomTagsModelSchema.safeParse(envelope.model.data);
        if (parsed.success) return parsed.data;
      }
    } catch {
      /* answered below */
    }
    return null;
  };
  const tagsPane_follow = (id: string, path: string): void => {
    const panel: TagsPanel | undefined = tagsPanels.get(id);
    if (panel === undefined || panel.path_get() === path) return;
    void tags_ask(path).then((model: DicomTagsModel | null): void => {
      if (model === null) {
        terminal.line_note(`tags: ${path}: not a readable DICOM file`);
        return;
      }
      tagsPanels.get(id)?.model_show(model);
    });
  };

  /**
   * Opens the tags pane that follows an image pane: the one already in its
   * link group, else a new one split beside it. It joins the group, so the
   * retained regard replays and the slice on screen is the first thing it
   * shows.
   */
  const tagsPane_open = (imageId: string): string => {
    const shown: Set<string> = new Set(layout.panes_shown());
    const group: string = subjects.group_of(imageId);
    for (const id of tagsPanels.keys()) {
      if (shown.has(id) && subjects.group_of(id) === group) {
        layout.focus_set(id);
        return 'image tags';
      }
    }
    if (!shown.has(imageId)) return 'image tags: the image pane is not on stage';
    const spawned: PaneInstance = instance_spawn('tags', imageId);
    if (!layout.leaf_split(imageId, replayPlace?.dir ?? 'col', spawned.id, replayPlace?.before ?? false)) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return 'image tags: could not open beside the image pane';
    }
    birth_record(spawned.id, imageId, replayPlace?.dir ?? 'col', replayPlace?.before ?? false);
    return 'image tags';
  };

  /**
   * Asks the kernel what a folder is as a series. Silent: an instrument's
   * question, not a command the operator issued.
   */
  const series_ask = async (path: string): Promise<DicomSeriesModel | null> => {
    try {
      const outcome: ExecuteOutcome = await client.line_execute(`dcm series "${path}"`, { silent: true, observe: false });
      for (const envelope of outcome.envelopes) {
        if (envelope.model?.kind !== DICOM_MODEL_KINDS.series) continue;
        const parsed = dicomSeriesModelSchema.safeParse(envelope.model.data);
        if (parsed.success) return parsed.data;
      }
    } catch {
      /* a refusal is answered below */
    }
    return null;
  };

  /** The folders under a path, from a silent listing. */
  const subfolders_ask = async (path: string): Promise<string[]> => {
    try {
      const outcome: ExecuteOutcome = await client.line_execute(`ls "${path}"`, { silent: true, observe: false });
      for (const envelope of outcome.envelopes) {
        if (envelope.model?.kind !== 'fs.listing') continue;
        const listing = envelope.model.data as { path?: string; entries?: Array<{ name: string; type: string }> };
        const base: string = (listing.path ?? path).replace(/\/$/, '');
        return (listing.entries ?? [])
          .filter((entry): boolean => entry.type === 'dir')
          .map((entry): string => `${base}/${entry.name}`);
      }
    } catch {
      /* no listing, no folders */
    }
    return [];
  };

  /**
   * The image pane that answers for a pane: itself when it is one, else
   * the image pane in its link group, else a new one split beside it.
   */
  const imagePane_for = (fromId: string | null, anchor?: { address: string; modelKind: string }): ImagePanel | null => {
    // A series is a group anchored on its own address. When an anchor is
    // given (a viewer opened from PACS, which has no host group of its own),
    // the group's regard is set to the series so it IS that series' group,
    // and a viewer already on stage regarding the same series is reused
    // rather than spawning a second viewer for it.
    const anchor_set = (id: string): void => { if (anchor !== undefined) subjects.regard_write(id, anchor); };
    if (fromId !== null && imagePanels.has(fromId)) { anchor_set(fromId); return imagePanels.get(fromId) ?? null; }
    const shown: Set<string> = new Set(layout.panes_shown());
    if (anchor !== undefined) {
      for (const [id, panel] of imagePanels) {
        if (shown.has(id) && subjects.regard_get(id)?.address === anchor.address) { anchor_set(id); return panel; }
      }
    }
    const group: string | null = fromId !== null ? subjects.group_of(fromId) : null;
    for (const [id, panel] of imagePanels) {
      if (shown.has(id) && group !== null && subjects.group_of(id) === group) return panel;
    }
    const host: string | null = fromId !== null && shown.has(fromId) ? fromId : errandHost_find();
    if (host === null) return null;
    const spawned: PaneInstance = instance_spawn('image', fromId ?? undefined);
    if (!layout.leaf_split(host, replayPlace?.dir ?? 'col', spawned.id, replayPlace?.before ?? false)) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return null;
    }
    birth_record(spawned.id, host, replayPlace?.dir ?? 'col', replayPlace?.before ?? false);
    anchor_set(spawned.id);
    return imagePanels.get(spawned.id) ?? null;
  };

  /**
   * Opens a path as an image: a series folder, a study folder (its first
   * series, the rest offered to `image series <n>`), one DICOM file (its
   * series, starting at that slice), or a NIfTI/MGZ volume. Never a blank
   * field: what could not open is said by name.
   *
   * @returns The console line to print.
   */
  const image_open = async (fromId: string | null, path: string, options: { force?: boolean } = {}, onOpen?: (id: string) => void): Promise<string> => {
    launcher_yield();
    // The pane is on stage before the kernel is asked. The ask is a header
    // read over a wire and can take seconds; a press that shows nothing for
    // those seconds is a press the operator repeats.
    // A viewer opened without a host group (from PACS) anchors its own group
    // on the series (or volume) it shows, so it is that series' group: the
    // pane drawer reaches it, and a second IMAGE on the same series reuses it.
    // A viewer opened from a pane that has a group (a files row) joins that
    // group as before, so no anchor is passed.
    const anchor: { address: string; modelKind: string } | undefined = fromId !== null ? undefined
      : VOLUME_FILE_PATTERN.test(path)
        ? { address: path, modelKind: 'image.volume' }
        : { address: DICOM_FILE_PATTERN.test(path) ? path.slice(0, path.lastIndexOf('/')) : path.replace(/\/$/, ''), modelKind: 'dicom.series' };
    const panel: ImagePanel | null = imagePane_for(fromId, anchor);
    if (panel === null) return 'image: no pane to open beside';
    // Structure-first: the pane exists now (spawned + split synchronously), so
    // hand its id back before the header read over the wire — a replay resolves
    // its next action's target against it without waiting for pixels to land.
    const openedId: string | null = imagePane_idOf(panel);
    if (openedId !== null) onOpen?.(openedId);
    if (VOLUME_FILE_PATTERN.test(path)) {
      panel.opening_show(path);
      void panel.volume_show(path);
      return `image ${path}`;
    }
    const isFile: boolean = DICOM_FILE_PATTERN.test(path);
    const folder: string = isFile ? path.slice(0, path.lastIndexOf('/')) : path.replace(/\/$/, '');
    panel.opening_show(folder);
    let series: DicomSeriesModel | null = await series_ask(folder);
    let siblings: SeriesChoice[] = [];
    if (series === null && !isFile) {
      // A study folder: hang its first series, list the rest.
      const folders: string[] = (await subfolders_ask(folder)).slice(0, 32);
      for (const candidate of folders) {
        const found: DicomSeriesModel | null = await series_ask(candidate);
        if (found === null) continue;
        siblings = folders.map((sibling: string): SeriesChoice => ({ path: sibling, label: sibling.split('/').pop() ?? sibling }));
        series = found;
        break;
      }
    }
    if (series === null) {
      panel.opening_fail(path, 'NOT A READABLE SERIES');
      return `image: ${path}: not a readable DICOM series, study, or volume`;
    }
    const startAt: number = isFile ? Math.max(1, series.files.indexOf(path) + 1) : 1;
    void panel.series_show(series, { siblings, startAt, ...(options.force === true ? { force: true } : {}) });
    return `image ${series.path}${siblings.length > 1 ? ` (1 of ${siblings.length} series)` : ''}`;
  };

  /**
   * Opens a series' own CFS folder as a file browser, joined to the series'
   * group so the browser and its viewer are one restorable group. A browser
   * already showing this folder is reused; a viewer on stage for the series
   * lends its group, else the browser anchors the group on the folder.
   */
  /**
   * PROCESS: opens `/bin` as a catalogue bound to an input, right of the pane
   * the verb was pressed in and joined to its group, so the operator picks
   * what to run from a listing — the same gesture as every other choice.
   *
   * @param fromId - The pane PROCESS was pressed in.
   * @param binding - The input, and the feed/node a run of it lands in.
   */
  const process_open = (fromId: string, binding: CatalogueBinding): void => {
    launcher_yield();
    const shown: Set<string> = new Set(layout.panes_shown());
    for (const [id, bound] of catalogueBindings) {
      if (shown.has(id) && bound.input === binding.input) { layout.focus_set(id); return; }
    }
    const host: string = shown.has(fromId) ? fromId : (errandHost_find() ?? fromId);
    const spawned: PaneInstance = instance_spawn('catalogue', fromId);
    if (!layout.leaf_split(host, replayPlace?.dir ?? 'col', spawned.id, replayPlace?.before ?? false)) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return;
    }
    birth_record(spawned.id, host, replayPlace?.dir ?? 'col', replayPlace?.before ?? false);
    catalogueBindings.set(spawned.id, binding);
    const panel: FilesPanel | undefined = filesPanels.get(spawned.id);
    if (panel === undefined) return;
    panel.binding_set({
      input: binding.input,
      place: binding.feed === null ? 'new feed' : `feed ${binding.feed}${binding.node === null ? '' : ` · node ${binding.node}`}`,
    });
    panel.feedOpen_declare((feedId: number): void => feed_open(spawned.id, feedId));
    rootedListing_show(spawned.id, panel, '/bin');
    recent_lead(panel);
    layout.focus_set(spawned.id);
  };

  /** How many executables the catalogue leads with, and how far back it looks for them. */
  const RECENT_SHOWN: number = 5;
  const RECENT_LOOKBACK: number = 40;

  /**
   * Leads a catalogue with what this operator ran lately: the kernel's own
   * instance listing (newest first, as a model), reduced to the distinct
   * executables of the operator's runs, the feed root's copy left out.
   *
   * @param panel - The catalogue.
   */
  const recent_lead = (panel: FilesPanel): void => {
    const fields: string = 'id,plugin_name,plugin_version,owner_username';
    void client.line_execute(`plugininstance list --limit ${RECENT_LOOKBACK} --fields ${fields}`, { silent: true, observe: false })
      .then((outcome: ExecuteOutcome): void => {
        const names: string[] = [];
        for (const envelope of outcome.envelopes) {
          if (envelope.model?.kind !== 'plugininstance.list' || !Array.isArray(envelope.model.data)) continue;
          for (const row of envelope.model.data as Array<{ pluginName?: unknown; pluginVersion?: unknown; owner?: unknown }>) {
            if (typeof row.pluginName !== 'string' || typeof row.pluginVersion !== 'string') continue;
            if (promptUser !== null && typeof row.owner === 'string' && row.owner !== promptUser) continue;
            if (row.pluginName === 'pl-dircopy') continue;
            const name: string = `${row.pluginName}-v${row.pluginVersion}`;
            if (!names.includes(name)) names.push(name);
            if (names.length >= RECENT_SHOWN) break;
          }
        }
        panel.recent_set(names.length === 0 ? null : names);
      })
      .catch((): void => { /* no history is no block */ });
  };

  /**
   * Opens a feed's graph in a runs pane beside the pane that asks, joined to
   * its group — what a run's FEED capsule does.
   *
   * @param fromId - The pane asking.
   * @param feedId - The feed.
   */
  const feed_open = (fromId: string, feedId: number): void => {
    launcher_yield();
    const shown: Set<string> = new Set(layout.panes_shown());
    for (const [id, panel] of dagPanels) {
      if (id !== 'dag' && shown.has(id) && panel.feed_get() === feedId) { layout.focus_set(id); return; }
    }
    const host: string = shown.has(fromId) ? fromId : (errandHost_find() ?? fromId);
    const spawned: PaneInstance = instance_spawn('dag', fromId);
    if (!layout.leaf_split(host, replayPlace?.dir ?? 'col', spawned.id, replayPlace?.before ?? false)) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return;
    }
    birth_record(spawned.id, host, replayPlace?.dir ?? 'col', replayPlace?.before ?? false);
    dagPanels.get(spawned.id)?.feed_enter(feedId);
  };

  /**
   * RUN: runs an executable on the catalogue's input. The line the strip
   * holds is authoritative; empty, it is composed — a `cd` to the input
   * (which is how the kernel takes its input) then the executable, and for
   * a new feed a title, asked once with the input's name to hand. The line
   * is echoed as if typed; the kernel's answer names the feed, which lights
   * the strip's FEED capsule. A refusal reads beside the row's verbs.
   *
   * The line stands as the strip holds it when it runs this executable (a
   * dive's values and hand edits alike); otherwise it starts afresh. A new
   * feed's title is asked once, when the line has none. A pipeline runs on
   * a node, so off one it is refused by name rather than sent to fail.
   *
   * @param id - The catalogue pane.
   * @param executable - The row's executable name.
   * @param kind - Whether it is a plugin or a pipeline.
   */
  const run_press = async (id: string, executable: string, kind: 'plugin' | 'pipeline'): Promise<void> => {
    const binding: CatalogueBinding | undefined = catalogueBindings.get(id);
    const panel: FilesPanel | undefined = filesPanels.get(id);
    if (binding === undefined || panel === undefined) return;
    const refuse = (reason: string): void => {
      terminal.output_write('err', `\x1b[31m${reason}\x1b[0m\n`);
      const indicated: string | null = panel.indicated_get();
      if (indicated !== null) panel.rowReadout_show(indicated, reason.toUpperCase().slice(0, 80));
    };
    if (kind === 'pipeline' && binding.node === null) {
      refuse(`${executable}: a pipeline runs on a node — PROCESS a node of a feed`);
      return;
    }
    let line: string = panel.commandLine_get();
    if (line === '' || runLine_executable(line) !== executable) line = runLine_compose(binding.input, executable);
    if (binding.feed === null && !runLine_hasTitle(line)) {
      const suggested: string = binding.input.split('/').filter(Boolean).pop() ?? 'feed';
      const title: string | null = await ask_onPane(id, { message: 'Feed title: ', kind: 'text', suggest: suggested, commit: 'RUN' });
      const wanted: string = (title ?? '').trim();
      if (wanted === '') return;
      line = runLine_titleAppend(line, wanted);
    }
    panel.commandLine_set(line);
    terminal.line_echo(line);
    let outcome: ExecuteOutcome;
    try {
      outcome = await client.line_execute(line, { silent: true });
    } catch (error: unknown) {
      refuse(error instanceof Error ? error.message : String(error));
      return;
    }
    terminal.outcome_write(outcome);
    if (outcome.envelopes.some((envelope): boolean => envelope.model?.kind === 'fs.cwd')) {
      void client.line_execute('ls', { silent: true });
    }
    const scheduled: WireEnvelope | undefined = outcome.envelopes.find(
      (envelope: WireEnvelope): boolean => envelope.model?.kind === 'run.scheduled',
    );
    const data: { feedId?: unknown } | undefined = scheduled?.model?.data as { feedId?: unknown } | undefined;
    if (typeof data?.feedId === 'number') {
      panel.run_show(data.feedId);
      return;
    }
    const refusal: string = outcome.envelopes
      .map((envelope: WireEnvelope): string => envelope.renderedErr ?? '')
      .join(' ')
      .replace(/\x1b\[[0-9;]*m/g, '')
      .trim()
      .split('\n')[0] ?? '';
    const indicated: string | null = panel.indicated_get();
    if (indicated !== null) panel.rowReadout_show(indicated, refusal === '' ? 'NOT SCHEDULED' : refusal.toUpperCase().slice(0, 80));
  };

  const dir_open = (folderPath: string): void => {
    launcher_yield();
    const shown: Set<string> = new Set(layout.panes_shown());
    for (const [id] of filesPanels) {
      if (shown.has(id) && subjects.regard_get(id)?.address === folderPath) { layout.focus_set(id); return; }
    }
    let inheritFrom: string | undefined;
    for (const [id, panel] of imagePanels) {
      if (shown.has(id) && (subjects.regard_get(id)?.address === folderPath || panel.state_get()?.path === folderPath)) { inheritFrom = id; break; }
    }
    const host: string | null = errandHost_find();
    if (host === null) return;
    const spawned: PaneInstance = instance_spawn('files', inheritFrom);
    if (!layout.leaf_split(host, replayPlace?.dir ?? 'col', spawned.id, replayPlace?.before ?? false)) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return;
    }
    birth_record(spawned.id, host, replayPlace?.dir ?? 'col', replayPlace?.before ?? false);
    if (inheritFrom === undefined) subjects.regard_write(spawned.id, { address: folderPath, modelKind: 'dicom.series' });
    const panel: FilesPanel | undefined = filesPanels.get(spawned.id);
    if (panel !== undefined) rootedListing_show(spawned.id, panel, folderPath);
  };

  /**
   * The GATHER pane: a cohort as a listing, born beside the PACS workspace
   * and joined to its group. Its rows' IMAGE and PROCESS open into that
   * group; DISMISS closes the pane (the cohort is forgotten on the surface
   * only — a saved manifest is a file in ~/gather).
   *
   * @param id - The pane id.
   * @returns The instance.
   */
  const gatherInstance_build = (id: string): PaneInstance => {
    const mount: HTMLElement = template_stamp('tpl-pane-gather');
    const panel: GatherPanel = new GatherPanel(mount, pane_find(mount, '.gather-rows'), {
      command_run: (line: string): void => { void client.line_execute(line, { silent: true }); },
      command_show: (line: string): void => terminal.line_run(line),
      note: (text: string): void => terminal.line_note(text),
      image_open: (folderPath: string): void => {
        void image_open(id, folderPath).then((line: string): void => terminal.line_note(line));
      },
      process_open: (folderPath: string): void => process_open(id, { input: folderPath, feed: null, node: null }),
      name_ask: (suggest: string): Promise<string | null> =>
        ask_onPane(id, { message: 'Cohort name: ', kind: 'text', suggest, commit: 'NAME IT' }),
      changed: (): void => pacsStage_relight(),
      dismiss: (): void => {
        if (!layout.leaf_close(id)) home_apply();
        orphans_dispose();
        pacsStage_relight();
      },
      // The cohort's feed is made by the line the operator could have typed:
      // echoed, run, its answer written; the kernel's model names the feed
      // and the root a run appends to.
      feed_create: async (line: string): Promise<GatherFeed | null> => {
        terminal.line_echo(line);
        let outcome: ExecuteOutcome;
        try {
          outcome = await client.line_execute(line, { silent: true });
        } catch (error: unknown) {
          terminal.output_write('err', `\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`);
          return null;
        }
        terminal.outcome_write(outcome);
        for (const envelope of outcome.envelopes) {
          if (envelope.model?.kind !== 'feed.created') continue;
          const data = envelope.model.data as { feedId?: unknown; rootInstanceId?: unknown; path?: unknown };
          if (typeof data.feedId === 'number' && typeof data.rootInstanceId === 'number' && typeof data.path === 'string') {
            return { feedId: data.feedId, rootInstanceId: data.rootInstanceId, path: data.path };
          }
        }
        return null;
      },
      cohort_process: (binding: { input: string; feed: number; node: number }): void => process_open(id, binding),
      feed_open: (feedId: number): void => feed_open(id, feedId),
    }, cohort);
    gatherPanels.set(id, panel);
    return {
      id,
      kind: 'gather',
      mount,
      dispose: (): void => {
        gatherPanels.delete(id);
        subjects.pane_leave(id);
      },
    };
  };

  /**
   * The session's cohort, which rides the header band.
   *
   * ONE cohort per session, and it belongs to the session rather than to
   * any pane: a cohort spans PACS series, and will span directories, so it
   * cannot live in whichever pane happened to start it. The header is the
   * one region that does not change when the body does, so gathering never
   * rearranges the workspace — which is the whole reason it moved here.
   */
  let headerCohort: GatherPanel | null = null;

  /**
   * The session's cohort itself, which neither view owns.
   *
   * The band shows it; a pane on the main panel can show the same one at
   * the same time, for a cohort too big for a band. Two reflections of one
   * set, which is the rule the badge registry already follows for a series
   * shown in two places.
   */
  const cohort: Cohort<GatherSeries> = new Cohort<GatherSeries>();

  /** Whether the operator sent the band away since the last gather. */
  let bandDismissed: boolean = false;

  /**
   * Where the session keeps the cohort it is working on.
   *
   * A cohort belongs to the SESSION, so it outlives the page: a refresh
   * keeps it, and a second surface attached to the same session sees the
   * same one. A working file, not a format — SAVE still writes the named
   * manifest beside it, which is the thing meant to be kept.
   */
  const COHORT_FILE: string = '~/gather/current.json';

  /** Writes are debounced: gathering a study is twenty changes, one file. */
  let cohortWrite: number | null = null;

  /** Holds the cohort as the session's, after the surface changed it. */
  const cohort_keep = (): void => {
    if (cohortWrite !== null) window.clearTimeout(cohortWrite);
    cohortWrite = window.setTimeout((): void => {
      cohortWrite = null;
      const held: ReadonlyArray<GatherSeries> = headerCohort?.entries_get() ?? [];
      const kept: string = JSON.stringify({
        version: 1,
        name: headerCohort?.name_get() ?? null,
        feed: headerCohort?.feed_get() ?? null,
        series: held,
      });
      // Silent: this is the surface keeping its own state, not an act the
      // operator took, and the transcript is for what they did.
      void client.line_execute('mkdir ~/gather', { silent: true, observe: false });
      void client.line_execute(
        `touch --withContents '${kept.replace(/'/g, "'\\''")}' ${COHORT_FILE}`,
        { silent: true, observe: false },
      );
    }, 1200);
  };

  /** Reads back the cohort the session was working on, at boot. */
  const cohort_restore = async (): Promise<void> => {
    const read: FileText = await fileText_fetch(COHORT_FILE);
    if (!read.ok) return;
    try {
      const held = JSON.parse(read.text) as { series?: unknown };
      if (!Array.isArray(held.series) || held.series.length === 0) return;
      if (headerCohort === null) headerCohort = headerCohort_build();
      for (const entry of held.series as GatherSeries[]) headerCohort.series_add(entry);
      headerGather_annunciate();
      pacsStage_relight();
    } catch {
      // A working file the operator may have edited: a cohort that cannot
      // be read is not a reason to refuse the session.
    }
  };

  /**
   * Builds the cohort into the header's third face.
   *
   * Its handlers are the pane's, with the two that were about a pane made
   * honest: a cohort in the band has no pane to close, so DISMISS empties
   * and retracts instead, and what it opens (an image, a catalogue) lands
   * in the BODY, where work happens.
   *
   * @returns The panel.
   */
  const headerCohort_build = (): GatherPanel => {
    const face: HTMLElement = element_require('header-gather');
    const host: string = 'pacs';
    return new GatherPanel(face, pane_find(face, '.gather-rows'), {
      command_run: (line: string): void => { void client.line_execute(line, { silent: true }); },
      command_show: (line: string): void => terminal.line_run(line),
      note: (text: string): void => terminal.line_note(text),
      image_open: (folderPath: string): void => {
        void image_open(host, folderPath).then((line: string): void => terminal.line_note(line));
      },
      process_open: (folderPath: string): void => process_open(host, { input: folderPath, feed: null, node: null }),
      name_ask: (suggest: string): Promise<string | null> =>
        ask_onPane(host, { message: 'Cohort name: ', kind: 'text', suggest, commit: 'NAME IT' }),
      changed: (): void => {
        pacsStage_relight();
        headerGather_annunciate();
        cohort_keep();
      },
      dismiss: (): void => {
        // A band is not a pane: there is nothing to close. Sending the face
        // away is what DISMISS means here, and the cohort it forgot is
        // already empty by the time this runs.
        document.body.dataset['header'] = 'away';
        bandDismissed = true;
        headerGather_annunciate();
      },
      feed_create: async (line: string): Promise<GatherFeed | null> => {
        terminal.line_echo(line);
        let outcome: ExecuteOutcome;
        try {
          outcome = await client.line_execute(line, { silent: true });
        } catch (error: unknown) {
          terminal.output_write('err', `\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`);
          return null;
        }
        terminal.outcome_write(outcome);
        for (const envelope of outcome.envelopes) {
          if (envelope.model?.kind !== 'feed.created') continue;
          const data = envelope.model.data as { feedId?: unknown; rootInstanceId?: unknown; path?: unknown };
          if (typeof data.feedId === 'number' && typeof data.rootInstanceId === 'number' && typeof data.path === 'string') {
            return { feedId: data.feedId, rootInstanceId: data.rootInstanceId, path: data.path };
          }
        }
        return null;
      },
      cohort_process: (binding: { input: string; feed: number; node: number }): void => process_open(host, binding),
      feed_open: (feedId: number): void => feed_open(host, feedId),
    }, cohort);
  };

  /**
   * Puts the cohort on the main panel, as a pane.
   *
   * A band is right for reading and curating; a cohort of two hundred
   * members with a filter on wants a whole field. It is the SAME cohort —
   * neither view owns the set — so nothing is copied and nothing can
   * drift. The band retracts as it goes, having done its job.
   */
  const cohort_stage = (): void => {
    const shown: Set<string> = new Set(layout.panes_shown());
    const standing: string | null = [...gatherPanels.keys()].find((id: string): boolean => shown.has(id)) ?? null;
    if (standing !== null) {
      layout.focus_set(standing);
    } else {
      const host: string = errandHost_find() ?? 'pacs';
      const spawned: PaneInstance = instance_spawn('gather', 'pacs');
      if (!layout.leaf_split(host, 'col', spawned.id, false)) {
        paneInstance_dispose(spawned.id);
        layout.mount_remove(spawned.id);
        return;
      }
      birth_record(spawned.id, host, 'col', false);
      gatherPanels.get(spawned.id)?.render_now();
    }
    document.body.dataset['header'] = 'away';
    bandDismissed = true;
  };

  /**
   * The block says whether the session is holding anything, and no more.
   *
   * A plate is a NAME — `01-GATHER`, as `02-CALYPSO` is — so the count
   * does not get glued to it. Holding something lights the block and
   * holding nothing dims it, which is the armed-and-resting idiom the
   * capsules already use; how many, and which, is what the face itself
   * says on its own state line.
   */
  const headerGather_annunciate = (): void => {
    const pill: HTMLElement | null = document.querySelector<HTMLElement>('#header-gather-pill');
    if (pill === null) return;
    const held: number = headerCohort?.entries_get().length ?? 0;
    pill.classList.toggle('panel-gather-empty', held === 0);
  };

  /**
   * Takes series into the session's cohort.
   *
   * The band reveals itself the first time, so the operator sees where the
   * thing they gathered went; after they have deliberately sent it away it
   * stays away and only the count moves, until they open it again.
   *
   * @param entries - The series to gather.
   */
  const cohort_gather = (entries: ReadonlyArray<GatherSeries>): void => {
    if (headerCohort === null) headerCohort = headerCohort_build();
    for (const entry of entries) headerCohort.series_add(entry);
    const away: boolean = document.body.dataset['header'] === 'away';
    if (!bandDismissed || !away) {
      document.body.dataset['header'] = 'gather';
      bandDismissed = false;
    }
    headerGather_annunciate();
    cohort_keep();
  };

  /**
   * Gathers series into the cohort on stage, opening the GATHER pane below
   * the PACS listing (joined to its group) when there is none.
   *
   * @param entries - The series to gather.
   * @param host - The pane the GATHER pane splits from; the PACS workspace by default.
   * @returns The GATHER pane's id, or null when no pane could be opened.
   */
  const gather_open = (entries: ReadonlyArray<GatherSeries>, host: string = 'pacs'): string | null => {
    const shown: Set<string> = new Set(layout.panes_shown());
    let id: string | null = [...gatherPanels.keys()].find((paneId: string): boolean => shown.has(paneId)) ?? null;
    if (id === null) {
      const from: string = shown.has(host) ? host : (errandHost_find() ?? host);
      const spawned: PaneInstance = instance_spawn('gather', 'pacs');
      if (!layout.leaf_split(from, replayPlace?.dir ?? 'row', spawned.id, replayPlace?.before ?? false)) {
        paneInstance_dispose(spawned.id);
        layout.mount_remove(spawned.id);
        return null;
      }
      birth_record(spawned.id, from, replayPlace?.dir ?? 'row', replayPlace?.before ?? false);
      id = spawned.id;
    }
    const panel: GatherPanel | undefined = gatherPanels.get(id);
    if (panel === undefined) return null;
    for (const entry of entries) panel.series_add(entry);
    return id;
  };

  const viewInstance_build = (id: string): PaneInstance => {
    const mount: HTMLElement = template_stamp('tpl-pane-view');
    const panel: ViewerPanel = new ViewerPanel(
      pane_find(mount, '.view-body'),
      pane_find(mount, '.view-title'),
      {
        content_fetch: async (path: string): Promise<string> => (await fileText_fetch(path)).text,
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
    // A record whose element is no longer in the document is a ghost: the
    // pane was rebuilt (a layout change, a preset) while a node was open,
    // which takes the overlay's DOM with it and leaves this map holding a
    // dead reference. That reference then refused EVERY later dive on this
    // pane — and a refused dive is not nothing, because the camera has
    // already flown inside. One wedged pane looked like a broken viewer.
    const held = nodeOverlays.get(id);
    if (held !== undefined && !held.element.isConnected) nodeOverlays.delete(id);
    if (canvas === null || nodeOverlays.has(id)) {
      // By the time this runs the camera is already INSIDE the node — the
      // fly-in dollies to just shy of its surface, which is the whole point
      // of the gesture. Returning quietly therefore does not cancel a dive;
      // it strands the operator looking at the inside of a sphere, filling
      // the pane with one flat colour, with the scene held so nothing even
      // moves. It reads exactly like a crash, and an operator reported it
      // as one. So: fly back out, and say what happened.
      terminal.line_note(
        `dag: ${vfsPath}: ${canvas === null ? 'this pane has no scene to fly in' : 'a node is already open here'} — flew back out`,
      );
      dagPanels.get(id)?.flight_back((): void => undefined);
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
    // The node's browser is a files body like any other: the same frame
    // (rule, elbow, spine, mode bar) and the same caps grid.
    const body: HTMLElement = filesBody_stamp();
    body.classList.add('node-overlay-body');
    element.append(header, body);
    const history: string[] = [];
    const panel: FilesPanel = new FilesPanel(pane_find(body, '.files-panel'), (action: FileAction): void => {
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
      // A run's own output is usually a volume, and a volume is an image:
      // it opens beside the graph, joined to its group, exactly as it does
      // from the browser. Reading it as text is what the kernel refuses.
      if (imagery_is(action.path)) {
        void image_open(id, action.path).then((line: string): void => terminal.line_note(line));
        return;
      }
      if (extension_isImage(action.path)) {
        panel.contentImage_show(action.path, vfsUrl_build(action.path));
        return;
      }
      void fileText_fetch(action.path).then((read: FileText): void => {
        if (!read.ok) {
          panel.contentRefused_show(action.path, read.text);
          return;
        }
        // A CSV is a table, and every table on this surface is a listing.
        if (TABLE_FILE_PATTERN.test(action.path)) panel.contentTable_show(action.path, read.text);
        else panel.content_show(action.path, read.text);
      });
    }, previewProvider);
    // A listing inside a node is a listing. Declaring no row verbs left the
    // façade with nothing to hide behind an indication, so it kept its old
    // bargain — one click activates — and the node's browser alone behaved
    // unlike every other listing on the surface: a click walked into the
    // row instead of indicating it, and the frame never opened. The verbs
    // are the same ones the browser offers, computed by the same roster, so
    // a node's own `data` is offered PROCESS here exactly as it is outside.
    panel.rowVerbs_declare(
      (entry, path: string) => rowVerbs_of(id, entry, path),
      (_entry, path: string): void => {
        // Indicating IS the regard, on the DAG pane's own group: the
        // overlay shares its identity, so a slaved viewer follows.
        subjects.regard_write(id, { address: path, modelKind: 'fs.file' });
      },
    );
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
        watch_set: (subject: string, on: boolean): void => {
          if (on) client.watch_send(subject);
          else client.unwatch_send(subject);
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
        node_process: (node: { vfsPath: string; instanceId: number; label: string }): void => {
          // The graph addresses a node by its projection; the catalogue is
          // bound to the place a run will `cd` into, which is the node's own
          // data under the session's home. Same place, two names — and the
          // kernel appends to the instance it finds at the path.
          const feed: number | null = feedOf_path(node.vfsPath)
            ?? (/\/feed_(\d+)(?:\/|$)/.exec(node.vfsPath) === null
              ? null
              : Number((/\/feed_(\d+)(?:\/|$)/.exec(node.vfsPath) as RegExpExecArray)[1]));
          const input: string = promptUser === null
            ? node.vfsPath
            : node.vfsPath.replace(/^\/proc\/jobs\//, `/home/${promptUser}/feeds/`);
          process_open(id, { input, feed, node: node.instanceId });
        },
        feed_regard: (procPath: string): void => {
          subjects.regard_write(id, { address: procPath, modelKind: 'feed' });
        },
        // `setfacl` grants to an identity on a FEED, so the roster is where
        // sharing belongs — a browser row offers it only because the path
        // it holds names a feed. DELETE is the kernel's own removal, which
        // asks before it acts.
        feed_verbs: (feed) => {
          const facts: RunsRowFacts = { feedId: feed.id };
          const runs: Record<string, () => void> = {
            share: (): void => terminal.line_run(`setfacl feed_${feed.id}`),
            delete: (): void => terminal.line_run(`feed rm feed_${feed.id}`),
          };
          return RUNS_ROW_ROSTER.rules
            .filter((rule): boolean => rule.offered(facts))
            .map((rule) => ({
              label: rule.label(facts),
              run: (): void => runs[rule.name]?.(),
            }));
        },
        feed_indicated: (feed): void => {
          subjects.regard_write(id, { address: `/proc/jobs/feed_${feed.id}`, modelKind: 'feed' });
          // Who holds it is a readout, not a verb: it says what the grant
          // capsule would be adding to.
          void client
            .line_execute(`getfacl feed_${feed.id}`, { silent: true, observe: false })
            .then((outcome: ExecuteOutcome): void => {
              dagPanels.get(id)?.rowReadout_show(feed.id, shares_read(outcome));
            })
            .catch((): void => { dagPanels.get(id)?.rowReadout_show(feed.id, 'ACCESS UNREAD'); });
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
  // PANES is a gutter domain like FILES/RUNS/PACS: its mount is a primary the
  // layout can raise, its card grid wired once the dormant set and restore
  // exist below.
  const launcherMount: HTMLElement = template_stamp('tpl-pane-launcher');
  paneInstance_adopt({ id: 'launcher', kind: 'launcher', mount: launcherMount });
  const panesMount: HTMLElement = template_stamp('tpl-pane-panes');
  paneInstance_adopt({ id: 'panes', kind: 'panes', mount: panesMount });
  const filesPanel: FilesPanel = filesPanels.get('files') as FilesPanel;
  const dagPanel: DagPanel = dagPanels.get('dag') as DagPanel;

  const cycler: PipelineCycler = new PipelineCycler(
    element_require('pipeline-cycler'),
    element_require('pipeline-cycler-name'),
    (line: string): void => {
      void client.line_execute(line, { silent: true });
    },
  );


  /**
   * A pane on stage to open an errand beside.
   *
   * The focused pane when it is in the current tree, otherwise the tree's
   * first leaf: an errand has to land somewhere the operator can see, and
   * the alternative is a question asked of nobody.
   *
   * @returns A pane id in the current tree, or null when there is no tree.
   */
  const errandHost_find = (): string | null => {
    const tree: LayoutNode | null = layout.tree_get();
    if (tree === null) return null;
    const leaves: string[] = [];
    const walk = (node: LayoutNode): void => {
      if ('pane' in node) { leaves.push(node.pane); return; }
      walk(node.first);
      walk(node.second);
    };
    walk(tree);
    const focused: string | null = layout.focused_get();
    if (focused !== null && leaves.includes(focused)) return focused;
    return leaves[0] ?? null;
  };

  /**
   * The question a `path` ask puts on stage, as an errand.
   *
   * An ask is never a box: it borrows the instrument that already shows the
   * space being asked about. A location wants a browser, so one opens beside
   * the pane that asked — a NEW one, since hijacking the operator's own
   * browser would lose their place and leave the layout changed after the
   * errand — anchored where the ask said, and it closes when the errand
   * ends either way.
   *
   * The errand's own controls ride the pane's mode frame, which is where a
   * control that acts on the whole field belongs: the question as a caption
   * (a readout — it answers no press), the composed path as an editable
   * field, MKDIR for a folder that does not exist yet, and one verb that
   * commits, reading whatever the kernel said it does.
   *
   * @param request - The question, its anchor and its suggestion.
   * @returns The location the operator committed, or null when abandoned.
   */
  const errand_open = async (request: SurfaceAsk): Promise<string | null> => {
    // Beside a pane that is actually on stage. The focused pane can be one
    // the current preset does not hold — focus outlives a preset change —
    // and splitting beside a pane that is not in the tree fails silently,
    // which is an errand that never opens and a question nobody is asked.
    const host: string | null = errandHost_find();
    if (host === null) return null;
    const spawned: PaneInstance = instance_spawn('files');
    if (!layout.leaf_split(host, replayPlace?.dir ?? 'col', spawned.id, replayPlace?.before ?? false)) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return null;
    }
    birth_record(spawned.id, host, replayPlace?.dir ?? 'col', replayPlace?.before ?? false);
    const panel: FilesPanel | undefined = filesPanels.get(spawned.id);
    const anchor: string = request.path?.anchor ?? '~';
    if (panel !== undefined) rootedListing_show(spawned.id, panel, anchor);

    const body: HTMLElement | null = spawned.mount.querySelector<HTMLElement>('.files-body');
    if (body === null) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return null;
    }
    // The errand's controls ride a bar of their own across the top of the
    // pane, not the mode frame: the frame is a narrow rail against the
    // spine — right for a column of capsules, hopeless for a caption and a
    // path — and the frame keeps answering to what the FIELD holds, which
    // an errand does not change. The bar belongs to the errand and leaves
    // with it.
    const bar: HTMLElement = document.createElement('div');
    bar.className = 'errand-bar';
    body.insertBefore(bar, body.firstChild);

    const caption: HTMLElement = document.createElement('span');
    caption.className = 'errand-caption';
    caption.textContent = request.message.trim();
    const field: HTMLInputElement = document.createElement('input');
    field.className = 'errand-path';
    field.spellcheck = false;
    const commit: HTMLButtonElement = document.createElement('button');
    commit.className = 'pacs-capsule errand-commit';
    commit.textContent = request.commit ?? 'USE THIS';
    // The path typed IS the answer, whole. The bar used to carry a MKDIR
    // of its own, which made the folder the path lives IN — so a field
    // holding a directory made its parent, which already existed, and the
    // browser appeared to walk up a level for no reason. The command that
    // asked makes the holding folder itself and says so, or refuses by
    // name, which is what a terminal does; and a browser's own frame still
    // carries MKDIR for making a place before choosing it.
    bar.append(caption, field, commit);

    /** Composes the answer from where the browser stands. */
    const path_compose = (): void => {
      const here: string = panel?.path_current() ?? anchor;
      const suggest: string | undefined = request.path?.suggest;
      field.value = request.path?.wantsDirectory === true || suggest === undefined
        ? here
        : `${here.replace(/\/$/, '')}/${suggest}`;
    };
    path_compose();
    // Walking the browser re-composes, so the field always names where the
    // operator is standing — until they edit it, which is their last word.
    let edited: boolean = false;
    field.addEventListener('input', (): void => { edited = true; });
    const walked = (): void => { if (!edited) path_compose(); };
    spawned.mount.addEventListener('click', walked);

    terminal.question_set(true);
    return new Promise((resolve: (answer: string | null) => void): void => {
      const settle = (answer: string | null): void => {
        spawned.mount.removeEventListener('click', walked);
        terminal.question_set(false);
        errandClose = null;
        layout.leaf_close(spawned.id);
        paneInstance_dispose(spawned.id);
        layout.mount_remove(spawned.id);
        resolve(answer);
      };
      errandClose = (): void => settle(null);
      commit.addEventListener('click', (): void => settle(field.value.trim() === '' ? null : field.value.trim()));
      field.addEventListener('keydown', (event: KeyboardEvent): void => {
        if (event.key === 'Enter') settle(field.value.trim() === '' ? null : field.value.trim());
      });
    });
  };

  /** Abandons the errand on stage, when there is one. */
  let errandClose: (() => void) | null = null;

  /** Opens or retracts the console drawer; set once the drawer is wired. */
  let consoleClosed_set: ((closed: boolean) => void) | null = null;

  /**
   * The pane whose pressed verb is running a line.
   *
   * A verb lowers to a command, and the command may have a question of its
   * own — `rm -i` asks before it removes. That question belongs where the
   * press was, not in the console: the operator is looking at the row they
   * just acted on. The session still SPEAKS in the console and the
   * transcript still keeps the exchange; what moves is where the answer is
   * given. Cleared as soon as it is used, so an unrelated question later
   * does not inherit a stale pane.
   */
  let askingPane: string | null = null;

  /**
   * Runs a row's or a field's verb as the visible command it is, and
   * remembers which pane pressed it.
   *
   * @param id - The pane whose verb this is.
   * @param line - The command the operator could have typed.
   */
  const verbLine_run = (id: string, line: string): void => {
    askingPane = id;
    terminal.line_run(line);
  };

  /**
   * Puts a question on the pane that provoked it.
   *
   * A transient question belongs where the hand is. Every surface question
   * used to go to the console, and a console can be closed: PROCESS on a
   * cohort asked for a name into a drawer of zero height, so the press
   * read as dead and the surface waited on a question nobody could see.
   * The pane asks now, and the console still records the exchange, so the
   * scrollback stays the whole story of the session.
   *
   * @param id - The pane asking.
   * @param request - The question.
   * @returns The answer, or null when abandoned.
   */
  const ask_onPane = async (id: string, request: PaneAskRequest): Promise<string | null> => {
    const mount: HTMLElement | undefined = paneInstance_get(id)?.mount;
    // A pane that is not on stage cannot carry a question; the console can,
    // and it exposes itself to do it.
    if (mount === undefined) {
      consoleClosed_set?.(false);
      return terminal.ask_open({
        message: request.message,
        kind: request.kind,
        ...(request.suggest === undefined ? {} : { suggest: request.suggest }),
      });
    }
    const noted: (answer: string | null) => void = terminal.ask_note(request.message);
    const answer: string | null = await paneAsk_open(mount, request);
    // A secret never enters the transcript, not even as a length.
    noted(request.kind === 'secret' && answer !== null ? '\u2022\u2022\u2022\u2022\u2022\u2022' : answer);
    return answer;
  };

  const pacsPanel: PacsPanel = new PacsPanel(element_require('pacs-workspace'), {
    command_run: (line: string): void => {
      // The claim rule: a pane's own request resolves to it alone. The
      // DAG pane's own commands already come back this way, and the PACS
      // pane needs the same — asking the session for the registered
      // servers is worth nothing if the answer goes nowhere.
      // A query or a retrieve is a big, auditable action the operator took
      // through a button, so it is echoed into the console — the transcript
      // is the whole story of the session, not only of what was typed —
      // then run silently so a long retrieve never locks the prompt. The
      // incidental probes (`pacs list`, `mkdir ~/gather`) are not echoed.
      if (/^(pacs query|pull )/.test(line)) terminal.line_echo(line);
      void client.line_execute(line, { silent: true }).then((outcome: ExecuteOutcome): void => {
        for (const envelope of outcome.envelopes) pacsPanel.envelope_observe(envelope);
      });
    },
    command_show: (line: string): void => {
      terminal.line_run(line);
    },
    note: (text: string): void => terminal.line_note(text),
    image_open: (folderPath: string): void => {
      void image_open(null, folderPath).then((line: string): void => terminal.line_note(line));
    },
    dir_open: (folderPath: string): void => dir_open(folderPath),
    // PROCESS on a series or a study: a catalogue bound to its folder,
    // beside the PACS workspace. A PACS folder is outside any feed.
    process_open: (folderPath: string): void => process_open('pacs', { input: folderPath, feed: null, node: null }),
    // GATHER: the cohort is a pane beside the workspace, not a tray under it.
    // The cohort is the session's, in the band: gathering takes a series
    // wherever the operator is standing, and never moves the workspace.
    gather_add: (entry: GatherSeries): void => cohort_gather([entry]),
    gathered_is: (seriesUID: string): boolean => headerCohort?.has(seriesUID) === true,
    workspace_close: (): void => home_apply(),
  });
  paneInstance_adopt({ id: 'pacs', kind: 'pacs', mount: element_require('pacs-workspace') });

  /**
   * Lights the PACS rows' verbs from the live stage: a folder gets a viewer
   * bit when a shown image pane regards it, a browser bit when a shown files
   * pane regards it. Called on every stage change, so a series' IMAGE and DIR
   * light when their panes open and go dark when they leave — a restore lights
   * them for free as the panes come back.
   */
  const pacsStage_relight = (): void => {
    const shown: Set<string> = new Set(layout.panes_shown());
    const lit: Map<string, { viewer: boolean; browser: boolean }> = new Map();
    for (const instance of paneInstances_list()) {
      if (!shown.has(instance.id)) continue;
      const raw: string | undefined = subjects.regard_get(instance.id)?.address;
      if (raw === undefined) continue;
      const kind: string | null = paneKind_get(instance.id);
      if (kind !== 'image' && kind !== 'files') continue;
      // A viewer anchors on the folder with its trailing slash stripped; a
      // browser keeps it — normalise so both light the same series row.
      const address: string = raw.replace(/\/$/, '');
      const entry = lit.get(address) ?? { viewer: false, browser: false };
      if (kind === 'image') entry.viewer = true;
      else entry.browser = true;
      lit.set(address, entry);
    }
    pacsPanel.stage_lit(lit);
  };

  // The tiling tree: presets are the gutter's trees; a feed in view varies
  // home by materializing the DAG pane (files left, DAG right); splits
  // carve the current tree until the next preset resets to givens.
  const layout: LayoutManager = new LayoutManager(
    element_require('layout-root'),
    new Map([
      ['dag', dagPrimary.mount],
      ['files', filesPrimary.mount],
      ['pacs', element_require('pacs-workspace')],
      ['launcher', launcherMount],
      ['panes', panesMount],
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
  // PANES-06 is a full-workspace preset too: the grid of dormant groups.
  layout.preset_register('panes', (): LayoutNode => ({ pane: 'panes' }));
  // The launcher owns the stage as well: it is where a session begins, and
  // what it says is the whole of what is on screen.
  layout.preset_register('launcher', (): LayoutNode => ({ pane: 'launcher' }));
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
  // Groups that have left the stage are not gone: a snapshot of each is kept
  // dormant so the PANES view can bring it back. Rehydrated from the surface's
  // own storage on load — dormant, never onto the stage.
  // Each pane's origin: the pane it split from at creation, so a desktop
  // records what each action acted FROM (its target), not a guessed context.
  /**
   * How each pane was born, for replaying a desktop faithfully: the pane it
   * split FROM, the split's orientation and side, and — for a pane the drawer's
   * SPLIT pill created — the binding it was created with (`view`/`fs`/`empty`).
   * A desktop replays by re-running each birth, so a stacked or before-split
   * pane returns where it was, not as another column on the right.
   */
  const paneBirth: Map<string, { parent: string; dir: 'row' | 'col'; before: boolean; binding?: string }> = new Map();
  const birth_record = (childId: string, parent: string, dir: 'row' | 'col', before: boolean, binding?: string): void => {
    paneBirth.set(childId, { parent, dir, before, ...(binding !== undefined ? { binding } : {}) });
  };
  /**
   * Re-runs the drawer SPLIT pill's spawn: a pane of `binding` split from
   * `parentId` at `dir`/`before`, an `fs` binding wired to follow the parent's
   * regard at the directory level. The one code path the pill and a desktop
   * replay share, so a pill-born pane returns exactly as it was made.
   *
   * @returns The new pane's id, or null when the split failed.
   */
  const pillPane_spawn = (parentId: string, binding: 'view' | 'fs' | 'empty', dir: 'row' | 'col', before: boolean): string | null => {
    const spawned: PaneInstance = binding === 'view' ? instance_spawn('view', parentId)
      : binding === 'fs' ? instance_spawn('files', parentId)
      : instance_spawn('empty');
    if (!layout.leaf_split(parentId, dir, spawned.id, before)) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return null;
    }
    birth_record(spawned.id, parentId, dir, before, binding);
    if (binding === 'fs') {
      const browser_show = (value: RegardValue): void => {
        const panel: FilesPanel | undefined = filesPanels.get(spawned.id);
        if (panel === undefined) return;
        const dirPath: string = value.modelKind === 'fs.file' ? (value.address.replace(/\/[^/]*$/, '') || '/') : value.address;
        rootedListing_show(spawned.id, panel, dirPath);
      };
      subjects.regard_subscribe(spawned.id, browser_show);
      const current: RegardValue | null = subjects.regard_get(parentId);
      if (current !== null) browser_show(current);
    }
    return spawned.id;
  };
  const dormant: DormantRegistry = new DormantRegistry(DORMANT_CAP, localKeyStore());
  // The dormant set is read (and, at slice 3, restored) by the PANES view.
  // Exposed for verification until that view exists.
  Object.assign(globalThis as Record<string, unknown>, {
    __argusDormant: {
      list: (): GroupSnapshot[] => dormant.list(),
      get: (id: string): GroupSnapshot | undefined => dormant.get(id),
      dismiss: (id: string): boolean => dormant.dismiss(id),
    },
  });

  /** A glyph standing in for a pane whose surface is not a raster (a listing, tags). */
  const kindGlyph_of = (id: string): string => {
    if (id === 'pacs') return '⊞';
    if (id === 'dag') return '⋔';
    const kind: string | null = paneKind_get(id);
    if (kind === 'image') return '▣';
    if (kind === 'tags') return '≣';
    return '▤';
  };

  /**
   * A strip of the whole stage: each shown pane drawn as a tile in stage order,
   * at a width proportional to the width it holds on screen — a raster where a
   * pane has a canvas, a glyph tile where it does not. This is the card's
   * figure, so a desktop reads as the arrangement it is (PACS | DIR | viewer),
   * not as one lone viewer.
   */
  const stageStrip_capture = (stageIds: readonly string[]): string | undefined => {
    if (stageIds.length === 0) return undefined;
    // A true mini-map: each pane drawn at its real position and size, scaled
    // into the figure — so a stack reads as a stack and a column as a column,
    // whatever order the panes were opened. Measured from the live boxes.
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
    const budget: number = 240;
    const scale: number = budget / spanW;
    const canvasH: number = Math.max(40, Math.min(260, Math.round(spanH * scale)));
    try {
      const off: HTMLCanvasElement = document.createElement('canvas');
      off.width = budget;
      off.height = canvasH;
      const ctx: CanvasRenderingContext2D | null = off.getContext('2d');
      if (ctx === null) return undefined;
      const style: CSSStyleDeclaration = getComputedStyle(document.documentElement);
      const accent: string = style.getPropertyValue('--harvestgold').trim() || '#c9a15a';
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, budget, canvasH);
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

  /** Whether a desktop replay is in flight; capture is suppressed during it. */
  let desktopReplaying: boolean = false;
  /**
   * The split a replayed open must use, set from the action being replayed so a
   * pane returns at its captured orientation and side; null in normal use, when
   * an automatic open falls to the column-after default.
   */
  let replayPlace: { dir: 'row' | 'col'; before: boolean } | null = null;

  /** Console-line verbs that tune an open viewer rather than open one. */
  const IMAGE_SUBVERBS: ReadonlySet<string> = new Set(['layout', 'slice', 'series', 'wl', 'colormap', 'save', 'tags', 'load', 'guard', 'ghost']);

  /**
   * Captures the current stage as a DESKTOP: a script of console lines that
   * reproduces it when replayed — the domain, its content (a PACS query, a
   * viewer at its layout/slice/W-L/colormap/ghost, its tags), and, by replay,
   * the tiles as they were. A desktop is a replay of actions, not a pixel
   * snapshot. Keyed by the on-stage viewer's series so returning to the same
   * arrangement updates its one card. A stage with no viewer is a bare domain,
   * reachable from its gutter button, so it is not carded.
   */
  const stageDesktop_capture = (): void => {
    if (desktopReplaying) return;
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
      const kind: string | null = paneKind_get(id);
      const birth = paneBirth.get(id);
      const target: number = actionIndexOf.get(birth?.parent ?? '') ?? 0;
      // The real split the pane was born with \u2014 a stacked or before-split pane
      // carries its own orientation and side, not the column-right default.
      const place = { dir: birth?.dir ?? 'col', side: (birth?.before ? 'before' : 'after') as 'before' | 'after' };
      const emit = (action: DesktopAction): void => { actionIndexOf.set(id, actions.length); actions.push(action); };
      if (id === 'pacs' || id === 'files' || id === 'dag') {
        const domain = (preset === 'dag' ? 'runs' : preset) as 'pacs' | 'files' | 'runs';
        const query: string | null = preset === 'pacs' ? pacsPanel.query_get() : null;
        // The runs domain with a graph on stage is content, as a PACS
        // query is: the feed, and the view the operator chose for it.
        const dagPanel: DagPanel | undefined = preset === 'dag' ? dagPanels.get('dag') : undefined;
        const feed: number | null = dagPanel !== undefined && dagPanel.graph_isShown() ? dagPanel.feed_get() : null;
        const dagView: string[] = feed !== null && dagPanel !== undefined ? dagPanel.view_lines() : [];
        if (feed !== null && label === undefined) label = dagPanel?.feedTitle_get();
        emit({
          op: 'domain',
          domain,
          ...(query !== null ? { query } : {}),
          ...(feed !== null ? { feed } : {}),
          ...(dagView.length > 0 ? { view: dagView } : {}),
        });
      } else if (birth?.binding === 'fs' || birth?.binding === 'view' || birth?.binding === 'empty') {
        // A drawer SPLIT-pill pane replays as its own birth, whatever it holds.
        emit({ op: birth.binding, target, ...place });
      } else if (kind === 'image') {
        const panel = imagePanels.get(id);
        const state = panel?.state_get() ?? null;
        if (panel === undefined || state === null || state.path === null) continue;
        const view: string[] = [];
        if (state.layout !== 'single') view.push(`image layout ${state.layout}`);
        if (state.colormap !== undefined && state.colormap !== 'gray') view.push(`image colormap ${state.colormap}`);
        if (state.voi !== undefined && state.voi !== null) view.push(`image wl ${state.voi.lower} ${state.voi.upper}`);
        if (state.slice > 1) view.push(`image slice ${state.slice}`);
        if (state.ghost !== undefined && state.ghost !== null && state.layout === 'slab') view.push(`image ghost ${state.ghost}`);
        emit({ op: 'image', path: state.path, target, ...place, ...(view.length > 0 ? { view } : {}) });
        if (anchor === undefined) {
          anchor = state.path;
          const series = panel.series_get();
          const parts: string[] = [series?.seriesDescription ?? '', series?.modality ?? ''].filter((part): boolean => part !== '');
          if (parts.length > 0) label = parts.join(' \u00b7 ');
        }
      } else if (catalogueBindings.has(id)) {
        // A catalogue is a files pane by kind and a catalogue by its binding:
        // what PROCESS was pressed on, where a run lands, and the line RUN
        // would run, verbatim. Asked before the files branch, or it would
        // be logged as a browser at /bin.
        const bound: CatalogueBinding | undefined = catalogueBindings.get(id);
        if (bound === undefined) continue;
        const line: string = filesPanels.get(id)?.commandLine_get() ?? '';
        emit({
          op: 'catalogue', input: bound.input, target, ...place,
          ...(bound.feed !== null ? { feed: bound.feed } : {}),
          ...(bound.node !== null ? { node: bound.node } : {}),
          ...(line !== '' ? { line } : {}),
        });
        if (label === undefined) label = `PROCESS ${bound.input.split('/').filter(Boolean).pop() ?? bound.input}`;
      } else if (kind === 'files') {
        const path: string | null = filesPanels.get(id)?.path_current() ?? null;
        if (typeof path !== 'string' || path.length === 0) continue;
        emit({ op: 'dir', path, target, ...place });
      } else if (kind === 'gather') {
        // The cohort travels with the desktop: its series, and its name.
        const panel: GatherPanel | undefined = gatherPanels.get(id);
        if (panel === undefined) continue;
        const series: GatherSeries[] = [...panel.entries_get()];
        const name: string | null = panel.name_get();
        const made: GatherFeed | null = panel.feed_get();
        emit({
          op: 'gather', series, target, ...place,
          ...(name !== null ? { name } : {}),
          ...(made !== null ? { feed: made.feedId, root: { instance: made.rootInstanceId, path: made.path } } : {}),
        });
        if (label === undefined) label = name ?? `GATHER · ${series.length} series`;
      } else if (kind === 'dag') {
        // A run's graph beside its catalogue: the feed it graphs.
        const graphed: number | null = dagPanels.get(id)?.feed_get() ?? null;
        if (graphed === null) continue;
        emit({ op: 'graph', feed: graphed, target, ...place });
      } else if (kind === 'tags') {
        emit({ op: 'tags', target, ...place });
      }
    }
    // A desktop is any arrangement with content beyond the bare domain — a
    // wall of browsers, a runs layout, a viewer and its tags. A single primary
    // pane is NOT carded: it is one gutter press away. It used to take a VIEWER
    // to be carded at all, so a files or runs layout with no image left nothing
    // behind; content of any kind is enough now.
    // A bare domain is one gutter press away and is not carded; a domain
    // with a feed on stage is content, like every pane opened beside it.
    const content = actions.filter((action): boolean => action.op !== 'domain' || action.feed !== undefined);
    if (content.length === 0) return;
    const thumbnail: string | undefined = stageStrip_capture(stageIds);
    const memberOf: Record<string, string> = { image: 'viewer', view: 'viewer', dir: 'files', fs: 'files', tags: 'tags', empty: 'pane', domain: 'dag', catalogue: 'catalogue', graph: 'dag', gather: 'gather' };
    const members: string[] = [...new Set(content.map((action): string => memberOf[action.op] ?? 'pane'))];
    // A viewer desktop is keyed by its series, so returning to it updates the
    // one card. A viewer-less desktop is keyed by the SET of content it holds,
    // so the same arrangement of browsers updates its own card rather than
    // minting a new one each time it is left.
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
      if (instance.id === 'files' || instance.id === 'dag' || instance.id === 'pacs'
        || instance.id === 'panes' || instance.id === 'launcher') continue;
      paneInstance_dispose(instance.id);
      layout.mount_remove(instance.id);
    }
    pacsStage_relight();
  };

  /**
   * Enters a gutter domain. The one chokepoint every domain switch routes
   * through: it captures the outgoing stage as a desktop BEFORE the preset
   * changes (so the context a switch would lose becomes a PANES card), then
   * applies the new preset and disposes what it left behind.
   */
  const domain_enter = (preset: string): void => {
    stageDesktop_capture();
    layout.preset_apply(preset);
    orphans_dispose();
  };



  const home_apply = (): void => {
    domain_enter('files');
    dagPanel.size_fit();
  };

  /** The image pane id backing a panel, for wiring members after a restore. */
  const imagePane_idOf = (panel: ImagePanel): string | null =>
    [...imagePanels.entries()].find(([, value]): boolean => value === panel)?.[0] ?? null;

  /**
   * Brings a dormant group back onto the stage: leaves the PANES domain,
   * re-opens the series or volume it regarded at its saved view state
   * (layout, slice, window/level, colormap, ghost), and re-opens its tags
   * member. The group is taken out of the dormant set — it is live again, and
   * re-snapshots when it next leaves.
   */
  const group_restore = async (id: string): Promise<void> => {
    const snapshot: GroupSnapshot | undefined = dormant.get(id);
    if (snapshot === undefined || snapshot.actions === undefined) return;
    dormant.dismiss(id);
    // Replay the action log. `produced[i]` is the pane action i made, so an
    // action's `target` resolves to the exact pane it split from — the domain
    // for a from-PACS open, a viewer for its tags, whatever it actually was —
    // and each open is launched FROM that pane (focus it first), reproducing
    // the arrangement's order and geometry.
    const paneOf = (kind: string): string[] => paneInstances_list().filter((instance): boolean => layout.panes_shown().includes(instance.id) && paneKind_get(instance.id) === kind).map((instance): string => instance.id);
    desktopReplaying = true;
    try {
      const produced: Array<string | null> = [];
      // Structure-first: every pane's FRAME opens synchronously and its id is
      // known at once, so the whole arrangement appears in one pass and the
      // slow parts — a series' header read, a query — load in parallel behind
      // it. No pane waits for another's pixels; nothing sleeps a fixed guess.
      for (const action of snapshot.actions) {
        const host: string | null = produced[action.target ?? 0] ?? null;
        // The split this pane was born with — replayed opens read it so a
        // stacked or before-split pane returns where it was.
        const place = { dir: action.dir ?? 'col', before: action.side === 'before' };
        if (action.op === 'domain') {
          // The domain switch must FINISH before the content panes open, or its
          // orphan sweep would dispose the panes opened after it. domain_enter
          // is synchronous — call it directly rather than a deferred console
          // line — so the preset is applied and swept before this pass moves
          // on. The query then fires async; no pane targets its results.
          const preset: string = action.domain === 'runs' ? 'dag' : action.domain === 'pacs' ? 'pacs' : 'files';
          domain_enter(preset);
          if (action.query !== undefined) terminal.line_run(action.query);
          if (action.feed !== undefined) {
            // The graph comes back as the roster would bring it, then the
            // view the operator had chosen, once the graph has landed.
            const feed: number = action.feed;
            const view: readonly string[] = action.view ?? [];
            const dagPanel: DagPanel | undefined = dagPanels.get('dag');
            dagPanel?.feed_enter(feed);
            if (view.length > 0 && dagPanel !== undefined) {
              const landed = (tries: number): void => {
                if (dagPanel.graph_isShown() && dagPanel.feed_get() === feed) {
                  for (const line of view) terminal.line_run(line);
                  return;
                }
                if (tries > 0) window.setTimeout((): void => landed(tries - 1), 250);
              };
              landed(240);
            }
          }
          produced.push(preset);
        } else if (action.op === 'image' && action.path !== undefined) {
          if (host !== null) layout.focus_set(host);
          let viewerId: string | null = null;
          replayPlace = place;
          const done: Promise<string> = image_open(null, action.path, {}, (openedId: string): void => { viewerId = openedId; });
          replayPlace = null;
          produced.push(viewerId);
          // The saved view state lands when the series does — applied on the
          // viewer's own completion, never blocking the other panes.
          const view: readonly string[] | undefined = action.view;
          const vid: string | null = viewerId;
          if (view !== undefined && view.length > 0 && vid !== null) {
            void done.then((): void => { for (const line of view) { layout.focus_set(vid); terminal.line_run(line); } }).catch((): void => { /* the pane stands; its view state simply did not land */ });
          }
        } else if (action.op === 'dir' && action.path !== undefined) {
          if (host !== null) layout.focus_set(host);
          const before: Set<string> = new Set(paneOf('files'));
          replayPlace = place;
          dir_open(action.path);
          replayPlace = null;
          produced.push(paneOf('files').find((paneId): boolean => !before.has(paneId)) ?? null);
        } else if (action.op === 'tags') {
          if (host !== null) layout.focus_set(host);
          const before: Set<string> = new Set(paneOf('tags'));
          replayPlace = place;
          terminal.line_run('image tags');
          replayPlace = null;
          produced.push(paneOf('tags').find((paneId): boolean => !before.has(paneId)) ?? null);
        } else if (action.op === 'catalogue' && action.input !== undefined) {
          // The catalogue returns bound as it was, its line intact and RUN
          // ready — the listing, not the dive: what to run is a choice again.
          if (host !== null) layout.focus_set(host);
          const catalogues = (): string[] => [...catalogueBindings.keys()].filter((paneId: string): boolean => layout.panes_shown().includes(paneId));
          const before: Set<string> = new Set(catalogues());
          replayPlace = place;
          process_open(host ?? 'files', { input: action.input, feed: action.feed ?? null, node: action.node ?? null });
          replayPlace = null;
          const opened: string | null = catalogues().find((paneId): boolean => !before.has(paneId)) ?? null;
          if (opened !== null && action.line !== undefined) filesPanels.get(opened)?.commandLine_set(action.line);
          produced.push(opened);
        } else if (action.op === 'gather' && action.series !== undefined) {
          // The cohort returns as it was gathered, named if it was named.
          if (host !== null) layout.focus_set(host);
          replayPlace = place;
          const opened: string | null = gather_open([...action.series], host ?? 'pacs');
          replayPlace = null;
          if (opened !== null && action.name !== undefined) gatherPanels.get(opened)?.name_set(action.name);
          if (opened !== null && action.feed !== undefined && action.root !== undefined) {
            gatherPanels.get(opened)?.feed_set({ feedId: action.feed, rootInstanceId: action.root.instance, path: action.root.path });
          }
          produced.push(opened);
        } else if (action.op === 'graph' && action.feed !== undefined) {
          if (host !== null) layout.focus_set(host);
          const before: Set<string> = new Set(paneOf('dag'));
          replayPlace = place;
          feed_open(host ?? 'files', action.feed);
          replayPlace = null;
          produced.push(paneOf('dag').find((paneId): boolean => !before.has(paneId)) ?? null);
        } else if (action.op === 'fs' || action.op === 'view' || action.op === 'empty') {
          // A drawer-pill pane replays as its own birth: the pill's spawn, at
          // the same parent, orientation and side.
          if (host === null) { produced.push(null); continue; }
          layout.focus_set(host);
          produced.push(pillPane_spawn(host, action.op, place.dir, place.before));
        } else {
          produced.push(null);
        }
      }
    } finally {
      desktopReplaying = false;
      pacsStage_relight();
    }
  };

  /**
   * The launcher is the EMPTY state, so the moment anything opens it is no
   * longer the truth: content arriving (a viewer, a browser, a catalogue)
   * takes the stage back to home, where a pane has somewhere to live. A
   * pane spawned against a stage that holds only the launcher has no host
   * and lands nowhere, which reads as a press that did nothing.
   */
  /** Opens the launcher: the domain a session begins in, and returns to. */
  const launcher_enter = (): void => {
    domain_enter('launcher');
    launcherPanel.render();
    layout.focus_set('launcher');
  };

  const launcher_yield = (): void => {
    if (layout.activePreset_get() !== 'launcher') return;
    dagShown = false;
    home_apply();
  };

  /**
   * What the launcher's blocks say, asked of the kernel at paint time.
   *
   * Cache-resident reads only: the roster the RUNS pane already keeps, a
   * listing of home, and the dormant set the surface holds itself. A first
   * screen that costs a visit to CUBE is a first screen that opens slowly.
   *
   * @returns The blocks, the one with most to say first.
   */
  const launcherTiles_build = async (): Promise<ReadonlyArray<LauncherTile>> => {
    const [roster, home]: [ExecuteOutcome, ExecuteOutcome] = await Promise.all([
      client.line_execute('proc feeds', { silent: true, observe: false }),
      client.line_execute('ls ~', { silent: true, observe: false }),
    ]);
    interface RosterFeed { id: number; title: string; status: string }
    let feeds: RosterFeed[] = [];
    for (const envelope of roster.envelopes) {
      const model = envelope.model;
      if (model === undefined || model.kind !== FEED_LIST_MODEL_KIND) continue;
      const parsed = feedListModelSchema.safeParse(model.data);
      if (parsed.success) feeds = parsed.data.feeds as RosterFeed[];
    }
    const errored: number = feeds.filter((feed: RosterFeed): boolean => /error/i.test(feed.status)).length;
    const live: number = feeds.filter((feed: RosterFeed): boolean => /running|scheduled|created|started/i.test(feed.status)).length;
    let entries: FsListingEntry[] = [];
    let homePath: string = '~';
    for (const envelope of home.envelopes) {
      if (envelope.model?.kind !== 'fs.listing') continue;
      const listings = envelope.model.data as Array<{ path?: unknown; items?: unknown }>;
      const first = listings[0];
      if (first !== undefined && Array.isArray(first.items)) {
        entries = first.items as FsListingEntry[];
        if (typeof first.path === 'string') homePath = first.path;
      }
    }
    const folders: FsListingEntry[] = entries.filter((entry: FsListingEntry): boolean => entry.type === 'dir');
    const desktops: GroupSnapshot[] = dormant.list();

    const analyses: LauncherTile = {
      key: 'analyses', name: 'ANALYSES', hue: '--october-sunset', numeral: '3',
      figures: [
        { text: `${feeds.length} FEEDS` },
        ...(live > 0 ? [{ text: `${live} RUNNING` }] : []),
        ...(errored > 0 ? [{ text: `${errored} ERRORED`, errored: true, open: (): void => runs_show('status:error') }] : []),
      ],
      rows: feeds.slice(0, 6).map((feed: RosterFeed): LauncherRow => ({
        text: `${feed.id}  ${feed.title}`,
        errored: /error/i.test(feed.status),
        open: (): void => { runs_show(); dagPanels.get('dag')?.feed_enter(feed.id); },
      })),
      verb: 'OPEN THE ROSTER',
      enter: (): void => runs_show(),
    };
    const files: LauncherTile = {
      key: 'files', name: 'FILES', hue: '--harvestgold', numeral: '2',
      figures: [{ text: `${entries.length} ENTRIES` }],
      rows: folders.slice(0, 5).map((entry: FsListingEntry): LauncherRow => ({
        text: entry.name,
        open: (): void => {
          dagShown = false;
          home_apply();
          const at: string = homePath.endsWith('/') ? `${homePath}${entry.name}` : `${homePath}/${entry.name}`;
          terminal.line_run(`cd "${at}"`);
        },
      })),
      verb: 'OPEN HOME',
      enter: (): void => { dagShown = false; home_apply(); layout.focus_set('files'); },
    };
    const pacsAnswer: string = pacsPanel.query_get() ?? '';
    const pacs: LauncherTile = {
      key: 'pacs', name: 'PACS', hue: '--daybreak', numeral: '4',
      figures: [{ text: pacsAnswer === '' ? 'NO ANSWER' : 'ANSWERED' }],
      // With nothing asked yet the block teaches instead of apologising:
      // the line it would take, dropped into the console ready to finish.
      rows: pacsAnswer === ''
        ? [
          { text: 'pacs query PatientID:…', open: (): void => terminal.line_offer('pacs query PatientID:') },
          { text: 'pacs query AccessionNumber:…', open: (): void => terminal.line_offer('pacs query AccessionNumber:') },
        ]
        : [{ text: pacsAnswer.slice(0, 48) }],
      verb: 'ASK A PACS',
      enter: (): void => { domain_enter('pacs'); layout.focus_set('pacs'); },
    };
    const panes: LauncherTile = {
      key: 'panes', name: 'PANES', hue: '--butter', numeral: '6',
      figures: [{ text: desktops.length === 0 ? 'EMPTY' : `${desktops.length} DESKTOPS` }],
      rows: desktops.slice(0, 5).map((group: GroupSnapshot): LauncherRow => ({
        text: group.label,
        open: (): void => { void group_restore(group.id); },
      })),
      verb: 'SEE DESKTOPS',
      enter: (): void => { domain_enter('panes'); panesPanel.render(); layout.focus_set('panes'); },
    };
    // The block with the most to say takes the wide seat.
    const rest: LauncherTile[] = [files, pacs, panes];
    return feeds.length >= entries.length ? [analyses, ...rest] : [files, analyses, pacs, panes];
  };

  const launcherPanel: LauncherPanel = new LauncherPanel(launcherMount, {
    tiles: launcherTiles_build,
    startHere_get: landing_isLauncher,
    startHere_set: landing_set,
  });
  // A dashboard read once is a dashboard that lies by the time it is read.
  // It re-asks on its own beat while it is the thing on screen, and asks
  // nothing at all when it is not — the roster's own rule, and the defect
  // the roster was carrying this morning.
  setInterval((): void => {
    if (layout.activePreset_get() !== 'launcher') return;
    if (!launcherMount.isConnected || document.visibilityState !== 'visible') return;
    launcherPanel.render();
  }, DASHBOARD_TICK_MS);

  const panesPanel: PanesPanel = new PanesPanel(panesMount, {
    list: (): GroupSnapshot[] => dormant.list(),
    restore: (id: string): void => { void group_restore(id); },
    dismiss: (id: string): void => { dormant.dismiss(id); },
  });
  const dag_summon = (): void => {
    const preset: string = layout.activePreset_get();
    // A preset that owns the whole workspace is the operator's own choice,
    // and the launcher owns it as PACS and RUNS do: a feed coming into view
    // must not paint a graph over the screen they are reading.
    if (preset === 'pacs' || preset === 'dag' || preset === 'launcher') {
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
    if (kind === 'tags') {
      subjects.regard_subscribe(instance.id, (value: RegardValue): void => {
        if (value.modelKind === 'dicom.instance') tagsPane_follow(instance.id, value.address);
      });
    }
    if (kind === 'view') {
      subjects.viewer_mark(instance.id);
      subjects.regard_subscribe(instance.id, (value: RegardValue): void => {
        // A DICOM instance is the tags pane's regard; a text viewer would
        // only cat its bytes.
        if (value.modelKind === 'dicom.instance') return;
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
        // A pill-born pane is a linked filesystem (follows the parent's regard
        // at the directory level), a slaved viewer, or a blank pane.
        const canonical: 'view' | 'fs' | 'empty' = binding === 'viewer' ? 'view' : binding === 'fs' ? 'fs' : 'empty';
        if (pillPane_spawn(id, canonical, dir, before) === null) return;
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
    if (kind === 'files' || kind === 'catalogue') {
      // Binding is a statement about this pane and its neighbours, so it
      // rides the binding group beside LINKED FS rather than standing among
      // verbs: what the next split creates, and what THIS browser follows,
      // are the same kind of sentence. The two read as a radio because they
      // are one — a browser either follows the session or holds its place.
      const binding: HTMLElement | null = drawer.querySelector<HTMLElement>('.drawer-binding');
      if (binding !== null) {
        const label: HTMLElement = document.createElement('span');
        label.className = 'drawer-label drawer-label-cwd';
        label.textContent = 'CWD';
        binding.appendChild(label);
        const cwdBind_offer = (text: string, follow: boolean, hint: string): HTMLButtonElement => {
          const capsule: HTMLButtonElement = document.createElement('button');
          capsule.className = 'pacs-capsule drawer-cwdbind';
          capsule.dataset['follow'] = follow ? 'on' : 'off';
          capsule.textContent = text;
          capsule.title = hint;
          capsule.addEventListener('click', (): void => {
            if ((filesFollow.get(id) === true) !== follow) filesFollow_set(id, follow);
            sound_play('audio3');
          });
          binding.appendChild(capsule);
          return capsule;
        };
        cwdBind_offer('FOLLOW CWD', true, "bind this browser to the session cwd (the console's browser)");
        cwdBind_offer('ROOT HERE', false, 'unbind from the cwd: this browser keeps its own place');
        // The pair reads the pane's state wherever the state was changed —
        // the drawer, the language, or a split being born rooted.
        cwdBind_sync_register(id, (): void => {
          const following: boolean = filesFollow.get(id) === true;
          for (const capsule of binding.querySelectorAll<HTMLElement>('.drawer-cwdbind')) {
            capsule.classList.toggle(
              'drawer-bind-selected',
              (capsule.dataset['follow'] === 'on') === following,
            );
          }
        });
        cwdBind_sync(id);
      }
      // HOME and BACK act on where the FIELD points, so they live on the
      // frame that answers to the field. A following browser's back and home
      // are the session's own; a rooted one walks its own history.
      const follows = (): boolean => filesFollow.get(id) === true;
      mount.querySelector<HTMLElement>('.files-home')?.addEventListener('click', (): void => {
        if (follows()) {
          terminal.line_run('cd ~');
          return;
        }
        const panel: FilesPanel | undefined = filesPanels.get(id);
        if (panel === undefined) return;
        const previous: string | null = panel.path_current();
        if (previous !== null) {
          rootedHistory.get(id)?.push(previous);
        }
        rootedListing_show(id, panel, '~');
      });
      mount.querySelector<HTMLElement>('.files-back')?.addEventListener('click', (): void => {
        if (follows()) {
          terminal.line_run('cd -');
          return;
        }
        const panel: FilesPanel | undefined = filesPanels.get(id);
        const previous: string | undefined = rootedHistory.get(id)?.pop();
        if (panel !== undefined && previous !== undefined) {
          rootedListing_show(id, panel, previous);
        }
      });
      // DOWNLOAD and DELETE act on a ROW, so the drawer offers neither. The
      // intents themselves live on (the console language reaches them, and
      // the row's own track carries them next); only their home is gone.

      // MKDIR and UPLOAD act on the PLACE the field holds, so they ride the
      // frame beside HOME and BACK. Both need the listing on stage, which
      // is the browser's own path and not necessarily the session's cwd.
      const here = (): string | null => filesPanels.get(id)?.path_current() ?? null;
      mount.querySelector<HTMLElement>('.files-mkdir')?.addEventListener('click', (): void => {
        const place: string | null = here();
        if (place !== null) directory_make(id, place);
      });
      // REFRESH asks for the listing on stage again: a verb on the field,
      // so it rides the frame with MKDIR and UPLOAD.
      mount.querySelector<HTMLElement>('.files-refresh')?.addEventListener('click', (): void => {
        const place: string | null = here();
        if (place !== null) listing_refresh(id, place);
      });
      const chooser: HTMLInputElement | null = mount.querySelector<HTMLInputElement>('.files-upload-input');
      mount.querySelector<HTMLElement>('.files-upload')?.addEventListener('click', (): void => {
        if (here() === null) return;
        // The operator's own machine is the browser's, and only the browser
        // may open a file there — so the picker is the surface's, and the
        // bytes travel to the daemon, which writes them through the kernel.
        chooser?.click();
      });
      chooser?.addEventListener('change', (): void => {
        const place: string | null = here();
        const chosen: FileList | null = chooser.files;
        if (place === null || chosen === null || chosen.length === 0) return;
        void files_deliver(id, place, Array.from(chosen));
        chooser.value = '';
      });
    }
    if (kind === 'dag') {
      // ENTER always lands in a place. A regard may point at a file (a
      // file click inside a node writes the same cell): the place is its
      // directory. Nothing regarded means the feed on stage.
      child_offer('ENTER NODE', 'move the session into the indicated node (its data directory)', (): void => {
        const regard: RegardValue | null = subjects.regard_get(id);
        const feedId: number | null = dagPanels.get(id)?.feed_get() ?? null;
        const place: string | null =
          regard === null ? (feedId === null ? null : `/proc/jobs/feed_${feedId}`)
          : regard.modelKind === 'fs.file' ? regard.address.replace(/\/[^/]*$/, '') || '/'
          : regard.address;
        if (place !== null) terminal.line_run(`cd "${place}"`);
      });
      child_offer('PROCESS NODE', 'run an executable on the indicated node\'s output (a catalogue opens beside)', (): void => {
        const regard: RegardValue | null = subjects.regard_get(id);
        const feedId: number | null = dagPanels.get(id)?.feed_get() ?? null;
        if (regard === null || feedId === null) return;
        const place: string = regard.modelKind === 'fs.file' ? regard.address.replace(/\/[^/]*$/, '') || '/' : regard.address;
        const node: number | null = nodeOf_path(place) ?? (/_(\d+)\/?$/.exec(place) === null ? null : parseInt(/_(\d+)\/?$/.exec(place)?.[1] ?? '', 10));
        if (node === null) return;
        process_open(id, { input: place.replace(/\/data\/?$/, '') + '/data', feed: feedId, node });
      });
      child_offer('ENTER FEED', 'move the session into the feed on stage (or the one picked in the roster)', (): void => {
        const feedId: number | null = dagPanels.get(id)?.feed_get() ?? null;
        if (feedId !== null) terminal.line_run(`cd "/proc/jobs/feed_${feedId}"`);
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
      child_offer('REFRESH', 'revisit the feed now (a watch keeps sampling it while it runs)', (): void => {
        dagPanels.get(id)?.refresh();
      });
    }
  };
  pane_chrome_wire('files', 'files', filesPrimary.mount);
  pane_chrome_wire('dag', 'dag', dagPrimary.mount);
  pane_chrome_wire('pacs', 'pacs', element_require('pacs-workspace'));
  pane_chrome_wire('launcher', 'launcher', launcherMount);
  pane_chrome_wire('panes', 'panes', panesMount);

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
  // The mode frame is transient chrome like a drawer: a frame that got out
  // of the way leaves a strip; the strip brings it back; the field (or
  // Esc) sends it away again. One retraction grammar, header and pane.
  const modeFrames_close = (): boolean => {
    let closed: boolean = false;
    for (const pane of document.querySelectorAll<HTMLElement>('.workspace-pane[data-modes="open"]')) {
      delete pane.dataset['modes'];
      closed = true;
    }
    // The PACS server strip is the same gesture wearing the form's clothes:
    // a band that unfolds from a cell and retracts to the field or to Esc.
    // It retracts with the frames so there is one grammar, not two.
    if (pacsPanel.serverStrip_isOpen()) {
      pacsPanel.serverStrip_close();
      closed = true;
    }
    return closed;
  };
  document.addEventListener('click', (event: Event): void => {
    if (!(event.target instanceof Element)) return;
    // A block inside the bar acts; the bar's plain fill (or the spine
    // itself, open) retracts it.
    if (event.target.closest('.mode-frame') !== null && event.target.closest('.mode-fill') === null) return;
    // The server cell and its strip act on their own clicks; letting the
    // document's retraction see them would close the strip with the very
    // press that opened it.
    if (event.target.closest('#pacs-server-strip') !== null
      || event.target.closest('#pacs-f-server') !== null) return;
    // A row of a listing whose verbs ride the frame is the frame's other
    // half: touching one puts its verbs there and opens the frame, and
    // the field's retraction must not close what the same press opened.
    // The façade retracts it when the row stands down.
    if (event.target.closest('.listing-framed .listing-row') !== null) return;
    const strip: HTMLElement | null = event.target.closest<HTMLElement>('.mode-strip');
    const pane: HTMLElement | null = strip?.closest<HTMLElement>('.workspace-pane') ?? null;
    const wasOpen: boolean = pane?.dataset['modes'] === 'open';
    const closedAny: boolean = modeFrames_close();
    if (strip !== null && pane !== null && !wasOpen) {
      pane.dataset['modes'] = 'open';
      sound_play('audio3');
      return;
    }
    if (closedAny) sound_play('audio3');
  });
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
        // The console's own question owns Escape wherever focus is. Bound
        // to the input line alone, it could not be abandoned by an operator
        // whose hands were on a row's verbs — and the command that asked
        // waited on an answer nobody could give any more.
        if (terminal.ask_abandon()) {
          event.stopImmediatePropagation();
          sound_play('audio3');
          return;
        }
        // A question standing on a pane is abandoned the same way and for
        // the same reason: retreating past it would leave the surface
        // waiting on an answer nobody is being asked for any more.
        if (paneAsk_abandon()) {
          event.stopImmediatePropagation();
          sound_play('audio3');
          return;
        }
        // An errand is a question standing on the stage: Esc abandons it
        // before anything else, because leaving it open while retreating
        // past it would leave a command waiting on an answer nobody is
        // being asked for any more.
        if (errandClose !== null) {
          errandClose();
          event.stopImmediatePropagation();
          sound_play('audio3');
          return;
        }
        // Esc is a contextual back: transient chrome first (drawer, then
        // zoom), then one navigation pop — node immersion back to the
        // graph, the graph back to the feed list. Each press retreats
        // exactly one level; never a walk back up invisible browser depth.
        // SELECT is transient chrome of its own: Esc leaves the mode before
        // it retreats anywhere, and leaving it keeps the selection — the
        // field still holds what was gathered.
        // An image field holding the keyboard gives it back first: one
        // press, one level (focus-stays-in-the-field).
        for (const panel of imagePanels.values()) {
          if (panel.field_release()) {
            event.stopImmediatePropagation();
            sound_play('audio3');
            return;
          }
        }
        let selectLeft: boolean = false;
        // An open question owns Esc: abandoning it is an answer, and a
        // press that also left a mode would answer two things at once.
        for (const panel of terminal.ask_isOpen() ? [] : filesPanels.values()) {
          if (panel.select_isOn()) {
            panel.select_toggle(false);
            selectLeft = true;
          }
        }
        if (selectLeft) {
          event.stopImmediatePropagation();
          sound_play('audio3');
          return;
        }
        const drawersClosed: boolean = drawers_close();
        const framesClosed: boolean = modeFrames_close();
        if (drawersClosed || framesClosed) {
          event.stopImmediatePropagation();
          sound_play('audio3');
          return;
        }
        if (document.body.dataset['zoom'] !== undefined) {
          // The zoom listener (bubble phase) takes this press.
          return;
        }
        // Inside a /bin node, the first Esc flies back out to the graph.
        // Immersion is a level of its own, ahead of closing the view that
        // holds it: Esc retreats exactly one level, never two.
        if (binDive_leave()) {
          event.stopImmediatePropagation();
          sound_play('audio3');
          return;
        }
        const overlayId: string | undefined = [...nodeOverlays.keys()].pop();
        if (overlayId !== undefined) {
          // Inside a node, a file view is a level of its own: the first
          // Esc returns to the node's listing, the next leaves the node.
          // Directory depth inside the node stays BACK's job — it is not
          // visible, and Esc never walks invisible depth.
          const record = nodeOverlays.get(overlayId);
          if (record !== undefined && record.panel.content_isShown()) {
            record.panel.listing_restore();
          } else {
            nodeOverlay_close(overlayId);
          }
          event.stopImmediatePropagation();
          sound_play('audio3');
          return;
        }
        // A camera parked inside a node with no overlay over it: the pane
        // is filled by the inside of one sphere and the scene is held, so
        // nothing moves and nothing reads as a control. Esc is the way out,
        // whatever left it there.
        const heldInside: [string, DagPanel] | undefined = [...dagPanels.entries()]
          .find(([, panel]: [string, DagPanel]): boolean => panel.inside_isHeld());
        if (heldInside !== undefined) {
          heldInside[1].flight_back((): void => undefined);
          event.stopImmediatePropagation();
          sound_play('audio3');
          return;
        }
        // A files pane's content view (a file, a /bin entry) is a level:
        // Esc returns it to its listing. The focused pane answers first
        // (focus citizenship), else whichever pane has content up.
        const focusedId: string | null = layout.focused_get();
        const contentPanes: Array<[string, FilesPanel]> = [...filesPanels.entries()]
          .filter(([, panel]: [string, FilesPanel]): boolean => panel.content_isShown())
          .sort(([a]: [string, FilesPanel], [b]: [string, FilesPanel]): number =>
            (a === focusedId ? -1 : b === focusedId ? 1 : 0));
        const contentPane: [string, FilesPanel] | undefined = contentPanes[0];
        if (contentPane !== undefined) {
          contentPane[1].listing_restore();
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
    if (kind === 'tags') {
      const tagsPanel: TagsPanel | undefined = tagsPanels.get(instance.id);
      for (const envelope of envelopes) {
        if (envelope.model?.kind !== DICOM_MODEL_KINDS.tags) continue;
        const parsed = dicomTagsModelSchema.safeParse(envelope.model.data);
        if (parsed.success) tagsPanel?.model_show(parsed.data);
      }
      return;
    }
    if (kind === 'image') {
      const imagePanel: ImagePanel | undefined = imagePanels.get(instance.id);
      for (const envelope of envelopes) {
        if (envelope.model?.kind !== DICOM_MODEL_KINDS.series) continue;
        const parsed = dicomSeriesModelSchema.safeParse(envelope.model.data);
        if (parsed.success) void imagePanel?.series_show(parsed.data);
      }
      return;
    }
    const panel: FilesPanel | DagPanel | undefined =
      kind === 'files' || (kind as string) === 'catalogue' ? filesPanels.get(instance.id) : dagPanels.get(instance.id);
    for (const envelope of envelopes) {
      panel?.envelope_observe(envelope);
    }
  };

  paneFactory_register('files', (id: string): PaneInstance => filesInstance_build(id, false));
  paneFactory_register('catalogue', (id: string): PaneInstance => filesInstance_build(id, false, true));
  paneFactory_register('dag', (id: string): PaneInstance => dagInstance_build(id, false));
  paneFactory_register('view', viewInstance_build);
  paneFactory_register('image', imageInstance_build);
  paneFactory_register('tags', tagsInstance_build);
  paneFactory_register('gather', gatherInstance_build);
  paneFactory_register('empty', (id: string): PaneInstance => {
    const mount: HTMLElement = template_stamp('tpl-pane-empty');
    new EmptyPanel(mount, {
      execute: (line: string): Promise<ExecuteOutcome> =>
        client.line_execute(line, { silent: true, observe: false }),
      claim: (kind: ClaimKind, envelopes: WireEnvelope[]): void => pane_claim(id, kind, envelopes),
    });
    return { id, kind: 'empty', mount };
  });

  // The left gutter dismisses from its own edge, as the header does from the
  // top: a press on the domain ALREADY shown sends the gutter off stage left
  // (data-gutter='away'), handing its width to the workspace — a focus of the
  // whole field, distinct from a single-pane zoom. A press that would NAVIGATE
  // stays deterministic (the gutter law); only a press on the current domain
  // toggles the chrome away. The pulsing left strip, or Esc, restores it.
  const gutterAway_set = (away: boolean): void => {
    if (away) document.body.dataset['gutter'] = 'away';
    else delete document.body.dataset['gutter'];
    sound_play('audio3');
  };
  const domainPress = (preset: string, navigate: () => void): void => {
    if (layout.activePreset_get() === preset) {
      gutterAway_set(true);
      return;
    }
    if (document.body.dataset['gutter'] === 'away') delete document.body.dataset['gutter'];
    navigate();
  };
  element_require('gutter-restore').addEventListener('click', (): void => gutterAway_set(false));
  window.addEventListener('keydown', (event: KeyboardEvent): void => {
    // Esc restores the gutter, after a zoom but before the header (one layer
    // per press): the gutter is the middle chrome layer.
    if (event.key === 'Escape' && document.body.dataset['gutter'] === 'away' && document.body.dataset['zoom'] === undefined) {
      gutterAway_set(false);
    }
  });

  // FILES-01: home. RUNS-02: home + the feed chooser. PACS-03: toggles the
  // PACS tree against home.
  element_require('gutter-files').addEventListener('click', (): void => {
    // A gutter press is a preset declaration and must be deterministic:
    // FILES-01 always yields the full files pane. The DAG rejoins home only
    // when a feed next comes into view (the summon), never as leftovers.
    domainPress('files', (): void => {
      dagShown = false;
      home_apply();
      layout.focus_set('files');
      consoleFocused_set(false);
    });
  });
  /**
   * RUNS-02's gesture, as a function: the DAG takes the whole workspace and
   * lands on the feed list, a graph retained from an earlier visit dismissed
   * before the roster paints. With a filter, the roster opens filtered.
   *
   * @param filter - A roster filter to apply, or none.
   */
  const runs_show = (filter: string = ''): void => {
    domain_enter('dag');
    dagPanel.list_reset();
    dagPanel.roster_filter(filter);
    dagPanel.feedsChooser_request();
    layout.focus_set('dag');
    consoleFocused_set(false);
  };
  element_require('gutter-runs').addEventListener('click', (): void => domainPress('dag', (): void => runs_show()));
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
    // Navigating to PACS is deterministic; pressing it while already there
    // sends the gutter away (the field focus), not a re-render.
    domainPress('pacs', (): void => {
      domain_enter('pacs');
      layout.focus_set('pacs');
      consoleFocused_set(false);
    });
  });
  element_require('gutter-dashboard').addEventListener('click', (): void => {
    // DASHBOARD-04 is the way back to where a session begins. Pressing it
    // while already there sends the gutter away, as every domain does.
    domainPress('launcher', launcher_enter);
  });
  element_require('gutter-panes').addEventListener('click', (): void => {
    // Opening PANES captures the current arrangement as a desktop card (the
    // chokepoint), free and recoverable, then draws the grid. Pressing PANES
    // while already there sends the gutter away instead.
    domainPress('panes', (): void => {
      domain_enter('panes');
      panesPanel.render();
      layout.focus_set('panes');
      consoleFocused_set(false);
    });
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
    launcher_enter,
    // The prompt already says who and where; `attach` repeats it rather
    // than asking the session a question it has just been told the answer to.
    identity_get: (): string | null => promptIdentity,
    node_immerse: (paneId: string): boolean => {
      const regard: RegardValue | null = subjects.regard_get(paneId);
      const match: RegExpMatchArray | null = regard?.address.match(/_(\d+)(?:\/data)?\/?$/) ?? null;
      if (match === null) return false;
      return dagPanels.get(paneId)?.node_flyTo(parseInt(match[1] ?? '', 10)) ?? false;
    },
    // The two row verbs, as the surface's own capability: the console
    // language presses them today and the row's action track presses the
    // same pair next, so neither has to know where the other's control is.
    file_download: (paneId: string): boolean => {
      const regard: RegardValue | null = subjects.regard_get(paneId);
      if (regard === null || regard.modelKind !== 'fs.file') return false;
      window.open(vfsUrl_build(regard.address), '_blank');
      return true;
    },
    image_open: (paneId: string | null, path: string, options?: { force?: boolean }): Promise<string> => image_open(paneId, path, options ?? {}),
    image_control: async (paneId: string, verb: string, args: string[]): Promise<string> => {
      // The verb reaches the image pane the target stands for: itself, the
      // one in its link group, or the only one on stage.
      const shown: Set<string> = new Set(layout.panes_shown());
      const group: string = subjects.group_of(paneId);
      const onStage: Array<[string, ImagePanel]> = [...imagePanels.entries()].filter(([id]: [string, ImagePanel]): boolean => shown.has(id));
      const panel: ImagePanel | undefined =
        imagePanels.get(paneId)
        ?? onStage.find(([id]: [string, ImagePanel]): boolean => subjects.group_of(id) === group)?.[1]
        ?? (onStage.length === 1 ? onStage[0]?.[1] : undefined);
      if (panel === undefined) return `image ${verb}: no image pane on stage for '${paneId}'`;
      if (verb === 'layout') {
        const layout: string = args[0] ?? '';
        if (!(IMAGE_LAYOUTS as readonly string[]).includes(layout)) return 'image layout single|mpr|3d|slab';
        if (await panel.layout_set(layout as ImageLayout)) return `image layout ${layout}`;
        return panel.state_get()?.waiting === layout ? `image layout ${layout}: waiting for LOAD` : `image layout ${layout}: not offered`;
      }
      if (verb === 'slice') {
        const slice: number = Number(args[0]);
        if (!Number.isInteger(slice) || slice < 1) return 'image slice <n>';
        return panel.slice_set(slice) ? `image slice ${slice}` : `image slice ${slice}: not offered`;
      }
      if (verb === 'series') {
        const n: number = Number(args[0]);
        const siblings: readonly SeriesChoice[] = panel.siblings_get();
        if (siblings.length === 0) return 'image series: this pane holds one series, not a study';
        const choice: SeriesChoice | undefined = siblings[n - 1];
        if (choice === undefined) return `image series <1..${siblings.length}>: ${siblings.map((sibling: SeriesChoice, index: number): string => `${index + 1} ${sibling.label}`).join(' · ')}`;
        const series: DicomSeriesModel | null = await series_ask(choice.path);
        if (series === null) return `image series ${n}: ${choice.path}: not a readable DICOM series`;
        void panel.series_show(series, { siblings: [...siblings] });
        return `image series ${n} ${choice.label}`;
      }
      if (verb === 'wl') {
        if ((args[0] ?? '').toLowerCase() === 'preset') {
          const name: string = args[1] ?? '';
          if (name === '') return 'image wl preset <brain|bone|lung|soft|liver>';
          return panel.wlPreset_set(name) ? `image wl preset ${name}` : `image wl preset ${name}: none for this modality`;
        }
        const lower: number = Number(args[0]);
        const upper: number = Number(args[1]);
        if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper) return 'image wl <lower> <upper> | image wl preset <name>';
        return panel.wl_set(lower, upper) ? `image wl ${lower} ${upper}` : 'image wl: not offered';
      }
      if (verb === 'colormap') {
        const name: string = (args[0] ?? '').toLowerCase();
        if (!(IMAGE_COLORMAPS as readonly string[]).includes(name)) return 'image colormap gray|hot|jet|cool';
        return panel.colormap_set(name as ImageColormap) ? `image colormap ${name}` : `image colormap ${name}: not offered`;
      }
      if (verb === 'save') {
        return (await panel.annotations_save()) ? 'image save' : 'image save: nothing saved (the console says why)';
      }
      if (verb === 'load') {
        return (await panel.load_press()) ? 'image load' : 'image load: nothing was waiting';
      }
      if (verb === 'guard') {
        const word: string = (args[0] ?? '').toLowerCase();
        if (word === 'off') {
          panel.guard_set(null);
          return 'image guard off';
        }
        const bytes: number = Number(args[0]);
        if (!Number.isFinite(bytes) || bytes < 0) return `image guard <bytes>|off (now ${panel.guard_get() === null ? 'off' : panel.guard_get()})`;
        panel.guard_set(bytes);
        return `image guard ${bytes}`;
      }
      if (verb === 'ghost') {
        const word: string = (args[0] ?? '').toLowerCase();
        const level: number | null = word === 'off' ? null : Number(args[0]);
        if (level !== null && (!Number.isFinite(level) || level < 0 || level > 1)) return 'image ghost <0..1>|off (SLAB layout)';
        return panel.ghost_set(level) ? `image ghost ${level === null ? 'off' : level}` : 'image ghost: SLAB layout only';
      }
      if (verb === 'tags') {
        const imageId: string | undefined = [...imagePanels.entries()].find(([, candidate]: [string, ImagePanel]): boolean => candidate === panel)?.[0];
        return imageId === undefined ? 'image tags: no image pane' : tagsPane_open(imageId);
      }
      return 'image <path> · layout single|mpr|3d · slice <n> · series <n> · wl <lo> <hi> | wl preset <name> · colormap <name> · save';
    },
    tags_control: (paneId: string, verb: string, args: string[]): string => {
      const shown: Set<string> = new Set(layout.panes_shown());
      const group: string = subjects.group_of(paneId);
      const onStage: Array<[string, TagsPanel]> = [...tagsPanels.entries()].filter(([id]: [string, TagsPanel]): boolean => shown.has(id));
      const panel: TagsPanel | undefined =
        tagsPanels.get(paneId)
        ?? onStage.find(([id]: [string, TagsPanel]): boolean => subjects.group_of(id) === group)?.[1]
        ?? (onStage.length === 1 ? onStage[0]?.[1] : undefined);
      if (panel === undefined) return `tags ${verb}: no tags pane on stage for '${paneId}'`;
      if (verb === 'redact') {
        const wanted: string = (args[0] ?? '').toLowerCase();
        if (wanted !== 'on' && wanted !== 'off') return 'tags redact on|off';
        panel.redact_set(wanted === 'on');
        return `tags redact ${wanted}`;
      }
      if (verb === 'filter') {
        const text: string = args.join(' ');
        if (text === '' || text.toLowerCase() === 'off') {
          panel.filter_set(null);
          return 'tags filter off';
        }
        panel.filter_set(text);
        return `tags filter ${text}`;
      }
      return 'tags redact on|off · filter <text>|off';
    },
    file_delete: (paneId: string): boolean => {
      const regard: RegardValue | null = subjects.regard_get(paneId);
      if (regard === null || regard.modelKind !== 'fs.file') return false;
      // A destructive verb runs as a VISIBLE terminal command: auditable in
      // the transcript, never a silent mutation behind a control.
      terminal.line_run(`rm "${regard.address}"`);
      return true;
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
          const hue: string = mount?.querySelector('.dag-hue')?.textContent?.toLowerCase() ?? 'status';
          if (strategy !== 'ranked') lines.push(`dag %${ordinal} layout ${strategy}`);
          if (projection !== '3d') lines.push(`dag %${ordinal} projection ${projection}`);
          if (hue !== 'status') lines.push(`dag %${ordinal} hue ${hue}`);
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
    'pane', 'view', 'runs', 'node', 'dag', 'file', 'pacs', 'header', 'console', 'back', 'desktop', 'argus',
  ];
  const LANG_FOLLOWERS: Record<string, string[]> = {
    pane: ['split', 'zoom', 'close', 'bind', 'claim', 'focus'],
    view: ['files', 'runs', 'pacs'],
    runs: ['enter', 'sort', 'filter'],
    node: ['enter', 'immerse', 'back', 'clear'],
    dag: ['layout', 'projection', 'scale', 'hue', 'pulse', 'census', 'physics', 'refresh'],
    physics: ['charge', 'link', 'collide', 'gravity', 'reset'],
    file: ['home', 'back', 'download', 'delete', 'sort', 'filter', 'follow', 'root', 'list', 'cards', 'preview'],
    // The session owns most of `pacs`; the surface claims sort and filter.
    pacs: ['sort', 'filter', 'connect', 'disconnect', 'list', 'query', 'pull', 'status'],
    header: ['stats', 'dag', 'away', 'restore'],
    console: ['open', 'close', 'toggle', 'zoom', 'height'],
    desktop: ['save', 'load', 'show', 'list', 'delete'],
    split: ['left', 'right', 'above', 'below'],
    bind: ['unlinked', 'fs', 'viewer'],
    claim: ['files', 'runs', 'pacs'],
    layout: ['ranked', 'molecule'],
    projection: ['2d', '3d'],
    scale: ['time', 'size'],
    hue: ['status', 'compute'],
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

  // Boot: the launcher for a browser that has never chosen otherwise (a
  // first screen that answers where am I, what can I do, what next), else
  // the arrangement this browser last had.
  if (landing_isLauncher()) {
    layout.preset_apply('launcher');
    launcherPanel.render();
  } else {
    layout.preset_apply(layout.savedPreset_get() ?? 'files');
  }

  const drawerStatus: HTMLElement = element_require('drawer-status');
  const mode_show = (mode: string): void => {
    drawerStatus.textContent = `MODE: [${mode}]`;
  };

  // The browser wears the console's listing colours by token; the console
  // says what they are.
  consolePalette_publish(document.documentElement);
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
      /**
       * A question the session put to this surface.
       *
       * Every kind is answered in the console for now — where the session
       * speaks, and where the scrollback keeps what was asked. A `path`
       * additionally deserves an instrument to walk, which is the next
       * slice; until then it is answerable rather than refused, which is
       * what matters.
       */
      ask_receive: async (request: SurfaceAsk): Promise<string | null> => {
        if (request.kind !== 'path') {
          // A question a PRESSED VERB provoked stands on the pane that was
          // pressed: `rm -i` asks before it removes, and the operator is
          // looking at the row they just acted on, not at the console. The
          // transcript still keeps the exchange either way.
          const provoker: string | null = askingPane;
          askingPane = null;
          if (provoker !== null && paneInstance_get(provoker) !== undefined) {
            return ask_onPane(provoker, {
              message: request.message,
              kind: request.kind === 'secret' ? 'secret' : request.kind === 'confirm' ? 'confirm' : 'text',
              ...(request.suggest === undefined ? {} : { suggest: request.suggest }),
            });
          }
          // Otherwise the session speaks where it always does. A closed
          // console is a question nobody can see, so asking one exposes it.
          consoleClosed_set?.(false);
          return terminal.ask_open({
            message: request.message,
            kind: request.kind,
            ...(request.suggest === undefined ? {} : { suggest: request.suggest }),
          });
        }
        // A location borrows an instrument. The console still says what was
        // asked, so the scrollback holds the whole exchange rather than the
        // half that happened at the keyboard.
        const noted: (answer: string | null) => void = terminal.ask_note(request.message);
        const answer: string | null = await errand_open(request);
        noted(answer);
        return answer;
      },
      promptline_receive: (context: PromptContext): void => {
        promptUser = context.user;
        // The prompt's own two facts, in the shape every attach line takes.
        promptIdentity = context.uri === '' ? context.user : `${context.user}@${context.uri}`;
        // The smoke suite is argus's only executable verification — there
        // is no unit level here — so the surface exposes the last context
        // it was handed, and a way to re-show one. Read-only to the page.
        Object.assign(globalThis as Record<string, unknown>, {
          __argusPromptContext: context,
          __argusPromptContext_show: (replacement: PromptContext): void =>
            statusBar.promptContext_show(replacement),
        });
        terminal.promptContext_set(context);
        statusBar.promptContext_show(context);
        indexInstrument.promptContext_show(context);
        cascade?.promptContext_observe(context);
        dagPanel.promptContext_observe(context);
      },
      telemetry_receive: (index: { jobs: number; feeds: number }, extra?: { lane?: LaneTelemetry; cube?: CubeTelemetry; state?: JobsStateTelemetry }): void => {
        indexInstrument.counts_show(index);
        if (extra?.state !== undefined) indexInstrument.state_show(extra.state);
        laneInstrument.telemetry_show(extra ?? {});
        if (extra?.cube !== undefined) indexInstrument.pace_show(extra.cube.msPerPage);
        cascade?.index_observe(index);
      },
      session_receive: (surface: string, envelope: WireEnvelope): void =>
        terminal.session_write(surface, envelope),
      // The sampler's refreshed models: every DAG pane showing that feed
      // repaints in place; nothing pins, nothing reaches the transcript.
      ambient_receive: (envelope: WireEnvelope): void => {
        if (envelope.model?.kind === 'fs.listing') {
          // A stale listing's refresh: every Files pane showing that path
          // swaps it in and drops its STALE readout.
          filesPanel.ambient_observe(envelope);
          for (const panel of filesPanels.values()) panel.ambient_observe(envelope);
          return;
        }
        if (envelope.model?.kind !== 'feed.dag') return;
        const parsed = feedDagModelSchema.safeParse(envelope.model.data);
        if (!parsed.success) return;
        dagPanel.model_refresh(parsed.data);
        for (const panel of dagPanels.values()) panel.model_refresh(parsed.data);
      },
      watched_receive: (subject: string, state: WatchState): void => {
        dagPanel.watched_observe(subject, state);
        for (const panel of dagPanels.values()) panel.watched_observe(subject, state);
      },
      envelope_observe: (envelope: WireEnvelope): void => {
        // The claim rule for console-issued models: a DAG-shaped model goes
        // to the focused DAG instance when one is focused, else the primary.
        const kind: string | undefined = envelope.model?.kind;
        if (kind === IMAGE_MODEL_KINDS.view) {
          // `image <path>` is a kernel command; the intent it emits opens the
          // pane here, so the same command works from a TTY (which prints the
          // reflection) and from this surface (which renders it).
          const parsed = imageViewModelSchema.safeParse(envelope.model?.data);
          if (parsed.success) {
            void image_open(layout.focused_get(), parsed.data.path, parsed.data.force === true ? { force: true } : {})
              .then((line: string): void => terminal.line_note(line));
          }
          return;
        }
        if (kind === 'feed.dag' || kind === 'feed.list' || kind === DAG_MODEL_KINDS.feedIndexing) {
          const focused: string | null = layout.focused_get();
          const target: DagPanel =
            focused !== null && dagPanels.has(focused)
              ? (dagPanels.get(focused) as DagPanel)
              : dagPanel;
          target.envelope_observe(envelope);
        } else {
          // A console listing reaches every browser bound to the cwd.
          for (const [paneId, panel] of filesPanels) {
            if (filesFollow.get(paneId) === true) panel.envelope_observe(envelope);
          }
          pacsPanel.envelope_observe(envelope);
          // A verb that changed a folder does not re-list it: `rm` reports
          // what it removed, `mv` what it moved. A browser showing that
          // folder asks for it again, or it shows rows that are gone —
          // which is the listing lying about the store.
          if (kind === 'fs.rm' || kind === 'fs.mv' || kind === 'fs.cp') {
            for (const [paneId, panel] of filesPanels) {
              const place: string | null = panel.path_current();
              if (place !== null) listing_refresh(paneId, place);
            }
          }
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
  // in /bin, so one silent ls names them all. Unobserved: this is an
  // instrument's read, and a browser that follows the session must not be
  // steered to /bin by it — which is how every boot used to open there.
  void client.line_execute('ls /bin', { silent: true, observe: false }).then((outcome: ExecuteOutcome): void => {
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
  // The browser that follows the session shows the session's place from
  // the first moment: one silent, observed listing of the working
  // directory. (The seed above used to do this by accident, at /bin.)
  void client.line_execute('ls', { silent: true });
  // The launcher's blocks are what the session says it holds, so they are
  // asked for once the session can answer. The paint at boot puts the pane
  // on stage; this fills it.
  if (layout.activePreset_get() === 'launcher') launcherPanel.render();
  // The cohort the session was working on comes back with it. Quietly: the
  // band is not revealed, because restoring is not an act the operator
  // just took — the count on its button is how they learn it is there.
  // The block reads its own state from the first frame: an empty cohort is
  // the same block dimmed, not a lit one promising something it does not
  // hold. The restore below may fill it a moment later.
  cohortStage_run = cohort_stage;
  headerGather_annunciate();
  void cohort_restore();
  mode_show('READY');
  terminal.banner_write(BANNER_LINES);
  terminal.prompt_draw();
  terminal.focus_take();

  consoleClosed_set = drawer_wire(
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
  headerBand_wire();
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
