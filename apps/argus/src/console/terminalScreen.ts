/**
 * @file The console as a terminal: xterm.js drawing the chell the daemon runs
 * for this page under a pseudo-terminal (calypso `terminals.ts`).
 *
 * Every keystroke goes to that chell and every byte it prints comes back, so
 * the browser console is the same shell as a terminal's: its prompt, line
 * editing, history, completion, questions and full-screen programs. The page
 * keeps the terminal's id for the tab (`sessionStorage`), so a reload or a
 * dropped connection opens the same terminal again and replays what it
 * printed meanwhile.
 *
 * The look is the console's: the console face (JetBrainsMono Nerd Font Mono,
 * MesloLGS NF behind it) and the console's sixteen ANSI colours on black. A
 * touch device gets a key row for what its keyboard lacks: Esc, Tab, Ctrl and
 * the arrows.
 *
 * @module
 */
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { ANSI_PALETTE } from '@fnndsc/menu/ansi';

/** What the screen asks of the session's wire. */
export interface TerminalWire {
  /** Opens a terminal of this size, or the one named again. */
  open: (cols: number, rows: number, terminalId?: string) => void;
  /** Types into it. */
  input: (terminalId: string, data: string) => void;
  /** Tells it its size. */
  resize: (terminalId: string, cols: number, rows: number) => void;
}

/** What the terminal's chell marks it is doing (OSC 6677; chell `lineDiscipline.ts`). */
export type TerminalState = 'idle' | 'busy' | 'asking';

/** The operating-system command chell marks its state with. */
const STATE_OSC: number = 6677;

/**
 * Reads a state mark's payload.
 *
 * @param payload - What followed the OSC number (`state=idle`).
 * @returns The state, or null when the mark says nothing known.
 */
export function terminalState_parse(payload: string): TerminalState | null {
  const match: RegExpExecArray | null = /^state=(idle|busy|asking)$/.exec(payload.trim());
  return match === null ? null : (match[1] as TerminalState);
}

/** Where the tab keeps its terminal's id. */
const TERMINAL_KEY: string = 'argus.terminalId';

/** The console face, the transcript's own. */
const CONSOLE_FONT: string = "'JetBrainsMono NF Mono', 'MesloLGS NF', monospace";

/** The keys a touch keyboard lacks, as the terminal receives them. */
const TOUCH_KEYS: ReadonlyArray<{ label: string; data: string | 'ctrl' }> = [
  { label: 'ESC', data: '\u001b' },
  { label: 'TAB', data: '\t' },
  { label: 'CTRL', data: 'ctrl' },
  { label: '←', data: '\u001b[D' },
  { label: '↑', data: '\u001b[A' },
  { label: '↓', data: '\u001b[B' },
  { label: '→', data: '\u001b[C' },
];

/**
 * The console's colours as xterm's theme: black ground, the console's text
 * colour, and the transcript's sixteen ANSI colours.
 *
 * @param foreground - The console's text colour.
 * @returns The theme.
 */
export function terminalTheme_of(foreground: string): ITheme {
  const [black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] = ANSI_PALETTE;
  return {
    background: '#000000', foreground, cursor: foreground, cursorAccent: '#000000', selectionBackground: '#44556680',
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite,
  };
}

/**
 * A key typed while CTRL is held on the touch row, as the terminal receives
 * it: a letter becomes its control code, anything else passes as typed.
 *
 * @param data - The key as the emulator encoded it.
 * @returns What to send.
 */
export function ctrl_apply(data: string): string {
  if (data.length !== 1) return data;
  const code: number = data.toUpperCase().charCodeAt(0);
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data;
}

/** Reads the tab's terminal id, when this page had one. */
function terminalId_read(): string | undefined {
  try {
    return sessionStorage.getItem(TERMINAL_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Keeps (or forgets) the tab's terminal id. */
function terminalId_write(id: string | null): void {
  try {
    if (id === null) sessionStorage.removeItem(TERMINAL_KEY);
    else sessionStorage.setItem(TERMINAL_KEY, id);
  } catch {
    // A tab without storage reopens a new terminal on reload; nothing else is lost.
  }
}

/** The console as a terminal. */
export class TerminalScreen {
  private readonly term: Terminal;
  private readonly fit: FitAddon = new FitAddon();
  private terminalId: string | null = null;
  private ended: boolean = false;
  private ctrlHeld: boolean = false;
  private resizeFrame: number | null = null;
  /** Every line feed the terminal has taken, scrolled off or not: a mark that never moves. */
  private feeds: number = 0;
  private readonly observer: ResizeObserver | null;

  /**
   * @param mount - Where the terminal is drawn.
   * @param wire - The session's terminal messages.
   * @param refused - Told why, when the daemon offers no terminal.
   * @param state - Told what the terminal's chell is doing, as it marks it.
   */
  constructor(private readonly mount: HTMLElement, private readonly wire: TerminalWire, private readonly refused: (why: string) => void, private readonly state: (state: TerminalState) => void = (): void => undefined) {
    const foreground: string = getComputedStyle(mount).color || '#ffaa44';
    this.term = new Terminal({
      fontFamily: CONSOLE_FONT,
      fontSize: Math.max(10, Math.round(parseFloat(getComputedStyle(mount).fontSize) || 13)),
      theme: terminalTheme_of(foreground),
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new WebLinksAddon());
    this.term.loadAddon(new Unicode11Addon());
    this.term.unicode.activeVersion = '11';
    const screen: HTMLElement = document.createElement('div');
    screen.className = 'argus-xterm';
    mount.appendChild(screen);
    this.term.open(screen);
    this.keyRow_build();
    this.term.onData((data: string): void => this.keys_send(data));
    this.term.onLineFeed((): void => { this.feeds++; });
    // The chell's own marks: at its prompt, running, or asking. Never drawn.
    this.term.parser.registerOscHandler(STATE_OSC, (payload: string): boolean => {
      const marked: TerminalState | null = terminalState_parse(payload);
      if (marked !== null) this.state(marked);
      return true;
    });
    this.term.onResize(({ cols, rows }: { cols: number; rows: number }): void => {
      if (this.terminalId !== null) this.wire.resize(this.terminalId, cols, rows);
    });
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((): void => this.size_fit());
    this.observer?.observe(mount);
    this.size_fit();
    this.wire.open(this.term.cols, this.term.rows, terminalId_read());
  }

  /** Fits the grid to the mount, once per frame. */
  public size_fit(): void {
    if (this.resizeFrame !== null) return;
    this.resizeFrame = requestAnimationFrame((): void => {
      this.resizeFrame = null;
      if (this.mount.offsetParent === null) return;
      try {
        this.fit.fit();
      } catch {
        // Not laid out yet: the next resize fits it.
      }
    });
  }

  /**
   * The terminal this screen draws, once opened.
   *
   * @returns Its id, or null before it opens or after its shell ended.
   */
  public terminalId_get(): string | null {
    return this.terminalId;
  }

  /** Takes the keyboard. */
  public focus(): void {
    this.term.focus();
  }

  /**
   * A terminal is open: draw what it printed meanwhile, and keep its id.
   *
   * @param terminalId - Its id.
   * @param replay - Its recent output.
   * @param refused - Why none could be opened, when that is so.
   */
  public opened(terminalId: string, replay: string, refused: string | undefined): void {
    if (refused !== undefined) {
      this.refused(refused);
      return;
    }
    this.terminalId = terminalId;
    this.ended = false;
    terminalId_write(terminalId);
    if (replay !== '') this.term.write(replay);
    this.wire.resize(terminalId, this.term.cols, this.term.rows);
  }

  /**
   * Draws a terminal's output.
   *
   * @param terminalId - The terminal it came from.
   * @param data - The bytes.
   */
  public data(terminalId: string, data: string): void {
    if (terminalId === this.terminalId) this.term.write(data);
  }

  /**
   * The terminal's chell has exited: say so; the next key opens a new one.
   *
   * @param terminalId - The terminal.
   * @param code - Its exit status.
   */
  public exited(terminalId: string, code: number): void {
    if (terminalId !== this.terminalId) return;
    this.ended = true;
    this.terminalId = null;
    terminalId_write(null);
    this.term.write(`\r\n\u001b[90m[the console's shell exited${code === 0 ? '' : ` (${code})`}; press a key for a new one]\u001b[0m\r\n`);
  }

  /**
   * Puts a line on the prompt, ready to edit, without running it.
   *
   * @param line - The line.
   */
  public offer(line: string): void {
    // Ctrl-U clears whatever was typed, as a shell does, then the line is typed.
    if (this.terminalId !== null) this.wire.input(this.terminalId, `\u0015${line}`);
    this.focus();
  }

  /**
   * The terminal's text as it reads now: every line of its buffer, scrollback
   * included, a line the terminal wrapped joined again, trailing blanks
   * trimmed.
   *
   * @returns The lines.
   */
  public buffer_lines(): string[] {
    const buffer = this.term.buffer.active;
    const lines: string[] = [];
    for (let row: number = 0; row < buffer.length; row++) {
      const line = buffer.getLine(row);
      const text: string = line?.translateToString(true) ?? '';
      // A row the terminal wrapped onto is the rest of the line above: one line, as it was printed.
      if (line?.isWrapped === true && lines.length > 0) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  /**
   * A mark in the terminal's output: the line feeds taken so far. Unlike a
   * position in the buffer it holds while old lines scroll out of it.
   *
   * @returns The mark.
   */
  public mark(): number {
    return this.feeds;
  }

  /**
   * The lines written since a mark, from the line its prompt stood on.
   *
   * @param mark - What `mark` returned.
   * @returns The lines (as far back as the buffer still holds).
   */
  public lines_since(mark: number): string[] {
    const lines: string[] = this.buffer_lines();
    const back: number = Math.max(0, this.feeds - mark) + 1;
    return lines.slice(Math.max(0, lines.length - back));
  }

  /**
   * Types into the terminal as the keyboard would (a line ends with `\r`).
   *
   * @param data - The keys.
   */
  public type(data: string): void {
    this.keys_send(data);
  }

  /** Releases the terminal (it keeps running on the daemon until its idle close). */
  public dispose(): void {
    this.observer?.disconnect();
    this.term.dispose();
  }

  /**
   * Sends keystrokes, opening a new terminal first when the last one ended,
   * and applying a CTRL held on the touch row.
   *
   * @param data - The keys.
   */
  private keys_send(data: string): void {
    if (this.ended) {
      this.ended = false;
      this.term.reset();
      this.wire.open(this.term.cols, this.term.rows);
      return;
    }
    if (this.terminalId === null) return;
    let sent: string = data;
    if (this.ctrlHeld) {
      sent = ctrl_apply(data);
      this.ctrlHeld = false;
      this.mount.querySelector('.argus-xterm-key.held')?.classList.remove('held');
    }
    this.wire.input(this.terminalId, sent);
  }

  /** The touch key row, for a keyboard without Esc, Tab, Ctrl or arrows. */
  private keyRow_build(): void {
    const row: HTMLElement = document.createElement('div');
    row.className = 'argus-xterm-keys';
    for (const key of TOUCH_KEYS) {
      const button: HTMLButtonElement = document.createElement('button');
      button.type = 'button';
      button.className = 'argus-xterm-key';
      button.textContent = key.label;
      button.addEventListener('pointerdown', (event: PointerEvent): void => {
        // Keep the keyboard on the terminal: a press must not take focus.
        event.preventDefault();
        if (key.data === 'ctrl') {
          this.ctrlHeld = !this.ctrlHeld;
          button.classList.toggle('held', this.ctrlHeld);
        } else {
          this.keys_send(key.data);
        }
        this.focus();
      });
      row.appendChild(button);
    }
    this.mount.appendChild(row);
  }
}
