/**
 * @file Which console the page shows: the transcript, or the terminal (the
 * chell the daemon runs for this page, drawn by xterm.js; #1125).
 *
 * The terminal is the console wherever the daemon offers one. The CONSOLE
 * capsule on the console's drawer switches between them and reads as what it
 * will do next; `console terminal` and `console transcript` press it. The
 * choice is the device's (localStorage). A daemon that offers no terminal
 * (node-pty not built on its host) shows no capsule, and the transcript is the
 * console.
 *
 * In terminal mode the transcript keeps its record behind the terminal and
 * hands the terminal what this surface itself runs or says (its echoes, notes,
 * streamed output and results, as notes printed above chell's prompt), an
 * offered line, the keyboard and the fit. A pressed verb's question still
 * stands on its pane; a question with no pane to stand on is a sheet over the
 * stage, because the terminal's chell did not ask it.
 *
 * @module
 */
import type { ArgusClient } from '../calypso/client.js';
import type { ArgusTerminal } from '../console/terminal.js';
import { TerminalScreen, type TerminalState } from '../console/terminalScreen.js';
import { question_stand } from './asks.js';
import type { PaneAskRequest } from '../features/ask/paneAsk.js';

/** The two consoles. */
export type ConsoleMode = 'terminal' | 'transcript';

/** Where the device keeps its choice. */
const MODE_KEY: string = 'argus.consoleMode';

/** What the wiring needs. */
export interface ConsoleModeWiring {
  client: ArgusClient;
  terminal: ArgusTerminal;
  /** Whether the daemon offers terminals. */
  offered: boolean;
  /** Keeps the screen where the client's terminal messages find it. */
  screen_set: (screen: TerminalScreen | null) => void;
}

/** The wired switch. */
export interface ConsoleModeControl {
  /** Whether the terminal is the console now. */
  terminal_is: () => boolean;
  /** Asks a question that has no pane to stand on: a sheet over the stage. */
  question_sheet: (request: PaneAskRequest) => Promise<string | null>;
}

/** Reads the device's choice. */
function mode_read(): ConsoleMode | null {
  try {
    const saved: string | null = localStorage.getItem(MODE_KEY);
    return saved === 'terminal' || saved === 'transcript' ? saved : null;
  } catch {
    return null;
  }
}

/** Keeps the device's choice. */
function mode_write(mode: ConsoleMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // A device without storage chooses again next visit.
  }
}

/**
 * Wires the console switch.
 *
 * @param wiring - The client, the transcript, whether terminals are offered.
 * @returns The switch.
 */
export function consoleMode_wire(wiring: ConsoleModeWiring): ConsoleModeControl {
  const { client, terminal, offered } = wiring;
  const container: HTMLElement | null = document.getElementById('terminal');
  const capsule: HTMLButtonElement | null = document.querySelector<HTMLButtonElement>('.console-mode');
  let screen: TerminalScreen | null = null;
  let mode: ConsoleMode = 'transcript';

  const apply = (next: ConsoleMode): void => {
    if (container === null) return;
    if (next === 'terminal' && offered) {
      if (screen === null) {
        const mount: HTMLElement = document.createElement('div');
        mount.className = 'argus-terminal-mount';
        container.appendChild(mount);
        screen = new TerminalScreen(
          mount,
          {
            open: (cols: number, rows: number, terminalId?: string): void => client.terminal_open(cols, rows, terminalId),
            input: (terminalId: string, data: string): void => client.terminal_input(terminalId, data),
            resize: (terminalId: string, cols: number, rows: number): void => client.terminal_resize(terminalId, cols, rows),
          },
          (why: string): void => {
            apply('transcript');
            terminal.line_note(`console: ${why}`);
          },
          // What the terminal's chell is doing, where a scenario (and CSS) can read it.
          (state: TerminalState): void => { container.dataset['terminalState'] = state; },
        );
        container.dataset['terminalState'] = 'busy';
        wiring.screen_set(screen);
      }
      const shown: TerminalScreen = screen;
      container.classList.add('console-terminal');
      client.mirror_set(true);
      terminal.delegate_set({
        note: (text: string): void => client.note_send(text),
        offer: (line: string): void => shown.offer(line),
        focus: (): void => shown.focus(),
        fit: (): void => shown.size_fit(),
      });
      shown.size_fit();
      mode = 'terminal';
    } else {
      container.classList.remove('console-terminal');
      client.mirror_set(false);
      terminal.delegate_set(null);
      mode = 'transcript';
    }
    if (capsule !== null) {
      // The control reads as what it will do next.
      capsule.textContent = mode === 'terminal' ? 'TRANSCRIPT' : 'TERMINAL';
      capsule.title = mode === 'terminal'
        ? 'show the transcript console (the terminal keeps running)'
        : 'make the console a terminal: the same chell as a shell, drawn here';
    }
  };

  if (capsule !== null) {
    capsule.hidden = !offered;
    capsule.addEventListener('click', (): void => {
      const next: ConsoleMode = mode === 'terminal' ? 'transcript' : 'terminal';
      mode_write(next);
      apply(next);
      terminal.focus_take();
    });
  }
  // The terminal is the console wherever one is offered, unless this device
  // chose the transcript.
  apply(offered && mode_read() !== 'transcript' ? 'terminal' : 'transcript');

  // The smoke's hold on the console, whichever it is: which one shows, keys
  // typed into the terminal as the keyboard would, and its text as it reads.
  Object.assign(globalThis as Record<string, unknown>, {
    __argusConsole: {
      mode: (): ConsoleMode => mode,
      state: (): string => container?.dataset['terminalState'] ?? 'busy',
      type: (data: string): void => screen?.type(data),
      lines: (): string[] => screen?.buffer_lines() ?? [],
      mark: (): number => screen?.mark() ?? 0,
      since: (mark: number): string[] => screen?.lines_since(mark) ?? [],
    },
  });

  return {
    terminal_is: (): boolean => mode === 'terminal',
    question_sheet: async (request: PaneAskRequest): Promise<string | null> => {
      document.querySelector('.question-sheet')?.remove();
      const sheet: HTMLElement = document.createElement('div');
      sheet.className = 'share-sheet question-sheet';
      sheet.setAttribute('role', 'dialog');
      const head: HTMLElement = document.createElement('div');
      head.className = 'share-head';
      head.textContent = 'THE SESSION ASKS';
      sheet.appendChild(head);
      document.body.appendChild(sheet);
      try {
        return await question_stand(terminal, sheet, request);
      } finally {
        sheet.remove();
      }
    },
  };
}
