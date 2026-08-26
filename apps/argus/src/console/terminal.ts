/**
 * @file The indwelling terminal: xterm.js wired to the CALYPSO session.
 *
 * The terminal renders the daemon's rendered stream natively (the engine
 * emits ANSI; xterm is a real terminal emulator, so text is first-class in
 * the browser). This module owns the line discipline — echo, backspace,
 * submit — and the prompt, themed here from the context facts the daemon
 * pushes. Execution is delegated to a submit handler so the terminal knows
 * the session only through the line it hands over and the outcome it is
 * asked to render.
 *
 * @module
 */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { PromptContext, WireEnvelope } from '@fnndsc/calypso/protocol';
import type { ExecuteOutcome, OutputChannel } from '../calypso/client.js';

/** ANSI palette entries used for the prompt, LCARS-adjacent. */
const ANSI_ORANGE: string = '\x1b[38;5;214m';
const ANSI_SKY: string = '\x1b[38;5;111m';
const ANSI_LAVENDER: string = '\x1b[38;5;183m';
const ANSI_GRAY: string = '\x1b[38;5;245m';
const ANSI_RESET: string = '\x1b[0m';

/**
 * The indwelling ARGUS terminal: one xterm instance attached to a container,
 * submitting lines to the session and rendering what comes back.
 *
 * @example
 * ```
 * const terminal = new ArgusTerminal(container, async (line) => { ... });
 * terminal.promptContext_set(context);
 * terminal.prompt_draw();
 * ```
 */
export class ArgusTerminal {
  private readonly term: Terminal;
  private readonly fitAddon: FitAddon;
  private readonly submit: (line: string) => Promise<void>;
  private inputBuffer: string = '';
  private inputLocked: boolean = true;
  private promptContext: PromptContext | null = null;

  /**
   * @param container - The DOM element the terminal renders into.
   * @param submit - Handles one submitted line; the terminal locks input
   *   until the returned promise settles.
   */
  constructor(container: HTMLElement, submit: (line: string) => Promise<void>) {
    this.submit = submit;
    // The data voice: Inconsolata at comfortable size over a black ground,
    // with LCARS-warm defaults; the CRT glow is applied in CSS.
    this.term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Inconsolata", "Fira Code", "Cascadia Code", Menlo, monospace',
      fontSize: 15,
      lineHeight: 1.15,
      theme: {
        background: '#000000',
        foreground: '#ffeecc',
        cursor: '#ff9900',
        cursorAccent: '#000000',
        selectionBackground: '#663300',
      },
    });
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(container);
    this.fitAddon.fit();
    this.term.onData((data: string): void => this.input_handle(data));
  }

  /** Refits the terminal grid to its container's current size. */
  public size_fit(): void {
    this.fitAddon.fit();
  }

  /** Focuses the terminal so keystrokes land in the session. */
  public focus_take(): void {
    this.term.focus();
  }

  /**
   * Stores the freshest prompt context pushed by the daemon.
   *
   * @param context - The engine-known prompt facts.
   */
  public promptContext_set(context: PromptContext): void {
    this.promptContext = context;
  }

  /**
   * Draws the prompt from the stored context and unlocks input.
   */
  public prompt_draw(): void {
    const context: PromptContext | null = this.promptContext;
    if (context === null) {
      this.term.write(`${ANSI_ORANGE}argus${ANSI_RESET}> `);
    } else {
      const host: string = context.uri.replace(/^https?:\/\//, '');
      this.term.write(
        `${ANSI_ORANGE}${context.user}${ANSI_RESET}@${ANSI_SKY}${host}${ANSI_RESET}:` +
          `${ANSI_LAVENDER}${context.cwd}${ANSI_RESET}$ `,
      );
    }
    this.inputLocked = false;
  }

  /**
   * Writes greeting lines before the first prompt.
   *
   * @param lines - The lines to write.
   */
  public banner_write(lines: string[]): void {
    for (const line of lines) {
      this.term.write(`${crlf_normalize(line)}\r\n`);
    }
  }

  /**
   * Writes one live output chunk from the executing command.
   *
   * @param channel - The producing channel; status renders dimmed.
   * @param chunk - The text chunk.
   */
  public output_write(channel: OutputChannel, chunk: string): void {
    if (channel === 'status') {
      this.term.write(`${ANSI_GRAY}${crlf_normalize(chunk)}${ANSI_RESET}`);
      return;
    }
    this.term.write(crlf_normalize(chunk));
  }

  /**
   * Renders one executed line's final envelopes, suppressing channels whose
   * output already streamed live so nothing prints twice.
   *
   * @param outcome - The envelopes and the channels that streamed live.
   */
  public outcome_write(outcome: ExecuteOutcome): void {
    for (const envelope of outcome.envelopes) {
      if (!outcome.liveChannels.has('data') && envelope.rendered.length > 0) {
        this.text_writeBlock(envelope.rendered);
      }
      const renderedErr: string = envelope.renderedErr ?? '';
      if (!outcome.liveChannels.has('err') && renderedErr.length > 0) {
        this.text_writeBlock(renderedErr);
      }
    }
  }

  /**
   * Renders an envelope another surface produced, prefixed with its surface
   * tag, mirroring how the remote ChELL client shows bus traffic.
   *
   * @param surface - The originating surface's bus id.
   * @param envelope - The broadcast envelope.
   */
  public session_write(surface: string, envelope: WireEnvelope): void {
    if (envelope.rendered.length === 0) {
      return;
    }
    this.term.write(`\r\n${ANSI_GRAY}[surface ${surface.slice(0, 6)}]${ANSI_RESET}\r\n`);
    this.text_writeBlock(envelope.rendered);
  }

  /**
   * Writes a text block, normalized for the terminal and terminated with a
   * newline exactly once.
   *
   * @param text - The block to write.
   */
  private text_writeBlock(text: string): void {
    const normalized: string = crlf_normalize(text);
    this.term.write(normalized.endsWith('\r\n') ? normalized : `${normalized}\r\n`);
  }

  /**
   * Runs a line as if the operator had typed it at the prompt: the line is
   * echoed, input locks, and the submit handler receives it. A graphical
   * gesture lowers through here, so the terminal transcript shows the same
   * bounded command an operator could have issued. Ignored while a command
   * is already executing.
   *
   * @param line - The command line to run.
   * @returns Resolves when the submit handler settles, so lowered gestures
   *   can chain commands in order.
   */
  public line_run(line: string): Promise<void> {
    if (this.inputLocked) {
      return Promise.resolve();
    }
    this.term.write(`${line}\r\n`);
    this.inputBuffer = '';
    this.inputLocked = true;
    return this.submit(line);
  }

  /**
   * Applies the line discipline to raw keyboard data: echo printables,
   * handle backspace, submit on Enter, and ignore everything else. Input is
   * ignored while a command is executing.
   *
   * @param data - Raw data from xterm (a keystroke or a paste).
   */
  private input_handle(data: string): void {
    if (this.inputLocked) {
      return;
    }
    for (const char of data) {
      if (char === '\r') {
        this.term.write('\r\n');
        const line: string = this.inputBuffer;
        this.inputBuffer = '';
        this.inputLocked = true;
        void this.submit(line);
        return;
      }
      if (char === '\x7f') {
        if (this.inputBuffer.length > 0) {
          this.inputBuffer = this.inputBuffer.slice(0, -1);
          this.term.write('\b \b');
        }
        continue;
      }
      if (char >= ' ') {
        this.inputBuffer += char;
        this.term.write(char);
      }
    }
  }
}

/**
 * Converts bare newlines to CRLF, which xterm requires for correct line
 * starts, leaving existing CRLF pairs untouched.
 *
 * @param text - The text to normalize.
 * @returns The normalized text.
 */
function crlf_normalize(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}
