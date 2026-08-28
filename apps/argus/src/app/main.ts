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
import { StatusBar } from './status.js';
import { Cascade } from './cascade.js';
import { PipelineCycler } from './cycler.js';
import { pane_register } from './panes.js';
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
  close: HTMLElement,
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
    drawer.classList.toggle('drawer-closed', closed);
    toggle.classList.toggle('lcars-beckon', closed);
    sound_play('audio3');
    if (!closed) {
      terminal.size_fit();
      terminal.focus_take();
    }
  };

  toggle.addEventListener('click', (): void =>
    closed_set(!drawer.classList.contains('drawer-closed')),
  );
  close.addEventListener('click', (): void => closed_set(true));

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
function zoom_wire(terminal: ArgusTerminal): void {
  const body: HTMLElement = document.body;
  const header: HTMLElement | null = document.querySelector<HTMLElement>('.wrap:not(#gap)');

  const zoom_set = (pane: string | null): void => {
    if (pane === null) {
      delete body.dataset['zoom'];
    } else {
      // The header's height is content-driven; measure it at zoom time so
      // the slide and the space reclaim travel by the same distance.
      if (header !== null) {
        body.style.setProperty('--zoom-header-height', `${header.offsetHeight}px`);
      }
      body.dataset['zoom'] = pane;
    }
    sound_play('audio3');
  };

  for (const control of document.querySelectorAll<HTMLElement>('[data-pane]')) {
    const pane: string = control.dataset['pane'] ?? '';
    control.addEventListener('click', (): void =>
      zoom_set(body.dataset['zoom'] === pane ? null : pane),
    );
  }

  window.addEventListener('keydown', (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && body.dataset['zoom'] !== undefined) {
      zoom_set(null);
    }
  });

  element_require('drawer').addEventListener('transitionend', (event: Event): void => {
    if ((event as TransitionEvent).propertyName === 'height') {
      terminal.size_fit();
    }
  });
}

/**
 * Builds the top frame's data cascade, live from boot, and binds the
 * labeled telemetry face beside it.
 *
 * @returns The cascade, or null when the page has no cascade element.
 */
function cascade_build(): Cascade | null {
  const wrapper: HTMLElement | null = document.getElementById('data-cascade');
  if (wrapper === null) {
    return null;
  }
  const cascadeInstance: Cascade = new Cascade(wrapper);
  const telemetryFace: HTMLElement | null = document.getElementById('header-telemetry');
  if (telemetryFace !== null) {
    cascadeInstance.telemetryPanel_bind(telemetryFace);
  }
  return cascadeInstance;
}

/**
 * Wires the header faces. The two gutter-top buttons SELECT: ARGUS WEB
 * shows the live stats and controls face, 02-CALYPSO the versions face.
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
  document.querySelector('.panel-2')?.addEventListener('click', (): void => face_select('versions'));

  const header_restore = (): void => {
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
  const filesPanel: FilesPanel = new FilesPanel(
    element_require('files-panel'),
    (action: FileAction): void => {
      if (action.kind === 'dir') {
        // Entering a directory lowers to the same command an operator could
        // type; the listing refresh follows from the fs.cwd model.
        terminal.line_run(`cd "${action.path}"`);
        return;
      }
      if (extension_isImage(action.path)) {
        // Images render natively from the daemon's token-gated /vfs route,
        // never as terminal strings.
        const url: string =
          `/vfs?path=${encodeURIComponent(action.path)}&token=${encodeURIComponent(token)}`;
        filesPanel.contentImage_show(action.path, url);
        return;
      }
      // Text renders from a silent cat, so a large file does not flood the
      // transcript.
      void client.line_execute(`cat "${action.path}"`, { silent: true }).then((outcome: ExecuteOutcome): void => {
        const content: string = ansi_strip(
          outcome.envelopes.map((envelope): string => envelope.rendered).join('\n'),
        );
        filesPanel.content_show(action.path, content);
      });
    },
  );

  const dagPanel: DagPanel = new DagPanel(
    element_require('dag-canvas'),
    element_require('dag-title'),
    element_require('dag-facts'),
    element_require('dag-empty'),
    element_require('dag-strategy'),
    {
      command_run: (line: string): void => {
        void client.line_execute(line, { silent: true });
      },
      node_enter: (vfsPath: string): void => {
        terminal.line_run(`cd "${vfsPath}"`);
      },
    },
  );
  const cycler: PipelineCycler = new PipelineCycler(
    element_require('pipeline-cycler'),
    element_require('pipeline-cycler-name'),
    (line: string): void => {
      void client.line_execute(line, { silent: true });
    },
  );
  pane_register({ id: 'console', title: 'CALYPSO CONSOLE', mount: element_require('drawer') });
  pane_register({ id: 'dag', title: 'DAG', mount: element_require('pane-dag') });
  pane_register({ id: 'files', title: 'WORKSPACE', mount: element_require('pane-files') });

  const drawerStatus: HTMLElement = element_require('drawer-status');
  const mode_show = (mode: string): void => {
    drawerStatus.textContent = `MODE: [${mode}]`;
  };

  const terminal: ArgusTerminal = new ArgusTerminal(
    element_require('terminal'),
    async (line: string): Promise<void> => {
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
        dagPanel.progress_observe(message);
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
        filesPanel.envelope_observe(envelope);
        dagPanel.envelope_observe(envelope);
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
    element_require('drawer-close'),
    terminal,
  );
  zoom_wire(terminal);
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
