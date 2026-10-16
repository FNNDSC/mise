/**
 * @file Which console the page shows: the terminal (the chell the daemon runs
 * for this page, drawn by xterm.js; #1125), or the transcript.
 *
 * The terminal is the console wherever the daemon offers one; nothing chooses
 * otherwise. The transcript is a deprecated fallback, frozen: it is the
 * console only on a daemon that offers no terminal (node-pty did not build on
 * its host), and its first line says so and why.
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

/** Where a device once kept a choice of console (there is none now). */
const MODE_KEY: string = 'argus.consoleMode';

/** The transcript's first line, where it is the console. */
const FALLBACK_NOTE: string = 'console: the transcript, deprecated: this host offers no pseudo-terminal (node-pty did not build). Install python, make and g++ and reinstall for the terminal console.';

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

/** Forgets a choice an earlier release kept. */
function mode_forget(): void {
  try {
    localStorage.removeItem(MODE_KEY);
  } catch {
    // A device without storage kept nothing.
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
  };

  mode_forget();
  apply(offered ? 'terminal' : 'transcript');
  if (!offered) terminal.line_note(FALLBACK_NOTE);

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
