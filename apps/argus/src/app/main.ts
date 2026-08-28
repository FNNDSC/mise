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
import { FilesPanel, type FileAction } from '../features/files/panel.js';
import { StatusBar } from './status.js';
import '../lcars/theme/lower-decks.css';
import '../lcars/argus.css';

/** The greeting written above the first prompt. */
const BANNER_LINES: string[] = [
  '\x1b[38;5;214mARGUS\x1b[0m — LCARS web console for mise',
  '\x1b[38;5;245mtwo projections of one CALYPSO session: type below, watch the instruments\x1b[0m',
  '',
];

/**
 * Plays one of the page's LCARS beeps, silently tolerating autoplay refusal.
 *
 * @param audioId - The id of the audio element to play.
 */
function sound_play(audioId: string): void {
  const audio: HTMLElement | null = document.getElementById(audioId);
  if (audio instanceof HTMLAudioElement) {
    audio.currentTime = 0;
    void audio.play().catch((): void => undefined);
  }
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
 * Populates the top frame's data cascade with generated figures.
 *
 * The cascade is the LCARS top panel's ambient number field. Generating it
 * here keeps template markup out of the repository and opens the door to
 * feeding it live telemetry later.
 */
function cascade_build(): void {
  const wrapper: HTMLElement | null = document.getElementById('data-cascade');
  if (wrapper === null) {
    return;
  }
  const columnWidths: number[] = [2, 3, 3, 2, 2, 11, 2, 2];
  const cells: Array<{ element: HTMLDivElement; width: number }> = [];
  for (const width of columnWidths) {
    const column: HTMLDivElement = document.createElement('div');
    column.className = 'data-column';
    for (let rowIndex: number = 1; rowIndex <= 4; rowIndex++) {
      const row: HTMLDivElement = document.createElement('div');
      row.className = `dc-row-${rowIndex}`;
      row.textContent = figure_random(width);
      column.appendChild(row);
      cells.push({ element: row, width });
    }
    wrapper.appendChild(column);
  }
  // The flicker loop, the prototype's telemetry rhythm made visible: a
  // handful of cells shift every beat so the top panel reads as a live
  // system, and every few seconds one column sweeps bright.
  window.setInterval((): void => {
    for (let flickerCount: number = 0; flickerCount < 5; flickerCount++) {
      const cell = cells[Math.floor(Math.random() * cells.length)];
      if (cell !== undefined) {
        cell.element.textContent = figure_random(cell.width);
      }
    }
  }, 300);
  const columns: HTMLDivElement[] = Array.from(wrapper.querySelectorAll('.data-column'));
  window.setInterval((): void => {
    const column = columns[Math.floor(Math.random() * columns.length)];
    if (column !== undefined) {
      column.classList.add('dc-sweep');
      window.setTimeout((): void => column.classList.remove('dc-sweep'), 650);
    }
  }, 2600);
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
 * Produces one zero-padded cascade figure.
 *
 * @param width - The digit count.
 * @returns The figure as text.
 */
function figure_random(width: number): string {
  return String(Math.floor(Math.random() * 10 ** width)).padStart(width, '0');
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
      void client.line_execute(`cat "${action.path}"`).then((outcome: ExecuteOutcome): void => {
        const content: string = ansi_strip(
          outcome.envelopes.map((envelope): string => envelope.rendered).join('\n'),
        );
        filesPanel.content_show(action.path, content);
      });
    },
  );

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
          void client.line_execute('ls');
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
      },
      promptline_receive: (context: PromptContext): void => {
        terminal.promptContext_set(context);
        statusBar.promptContext_show(context);
      },
      session_receive: (surface: string, envelope: WireEnvelope): void =>
        terminal.session_write(surface, envelope),
      envelope_observe: (envelope: WireEnvelope): void => filesPanel.envelope_observe(envelope),
      close_handle: (): void => {
        statusBar.connection_show(false);
        mode_show('OFFLINE');
      },
    },
  );
  const client: ArgusClient = attached.client;

  statusBar.attach_show(attached.attach);
  statusBar.connection_show(true);
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
  cascade_build();
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
