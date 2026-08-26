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

/** ANSI palette entries used for terminal chrome. */
const ANSI_GRAY: string = '\x1b[38;5;245m';
const ANSI_RESET: string = '\x1b[0m';

/** Foreground/background hex pair for one powerline segment. */
interface SegmentColor {
  bg: string;
  fg: string;
}

/**
 * The prompt segment palette, mirroring chell's Powerlevel10k theme
 * (`packages/chell/src/core/prompt/palette.ts`) so the browser console and
 * the CLI surface read as one family. Duplicated by value because argus may
 * not import the execution stack.
 */
const SEGMENT_PALETTE: Record<'host' | 'user' | 'dir' | 'duration' | 'status', SegmentColor> = {
  host: { bg: '#00AFFF', fg: '#001018' },
  user: { bg: '#00D787', fg: '#00140C' },
  dir: { bg: '#FFD75F', fg: '#201800' },
  duration: { bg: '#FF8700', fg: '#201000' },
  status: { bg: '#FF005F', fg: '#FFFFFF' },
};

/** Powerline separator and Font Awesome glyphs; need a Nerd Font. */
const GLYPHS = {
  powerline: '',
  cube: '',
  user: '',
  folder: '',
  bolt: '',
  error: '',
} as const;

/** Minimum command duration (ms) before the duration segment appears. */
const DURATION_THRESHOLD_MS: number = 3_000;

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
  private readonly nerdFont: boolean;

  /**
   * @param container - The DOM element the terminal renders into.
   * @param submit - Handles one submitted line; the terminal locks input
   *   until the returned promise settles.
   */
  constructor(container: HTMLElement, submit: (line: string) => Promise<void>) {
    this.submit = submit;
    // The data voice: MesloLGS NF first (the Powerlevel10k companion font,
    // carrying the powerline and icon glyphs), then the Inconsolata webfont.
    // The caller preloads webfonts before constructing, so xterm measures
    // its cell grid against the real face rather than a fallback.
    this.nerdFont = fontAvailable_check('MesloLGS NF');
    this.term = new Terminal({
      cursorBlink: true,
      fontFamily: '"MesloLGS NF", "Inconsolata", "Fira Code", Menlo, monospace',
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
   * Draws the two-line Powerlevel10k-style prompt from the stored context
   * and unlocks input: a segment bar with background fills and powerline
   * separators, then a `❯` input line, matching chell's p10k theme.
   */
  public prompt_draw(): void {
    const context: PromptContext | null = this.promptContext;
    if (context === null) {
      this.term.write(`\x1b[38;2;255;153;0margus${ANSI_RESET} ❯ `);
      this.inputLocked = false;
      return;
    }

    const host: string = context.uri.replace(/^https?:\/\//, '').replace(/\/api\/v1\/?$/, '');
    const homePrefix: string = `/home/${context.user}`;
    const displayPath: string = context.cwd.startsWith(homePrefix)
      ? `~${context.cwd.slice(homePrefix.length)}`
      : context.cwd;

    const segments: Array<{ text: string; color: SegmentColor }> = [
      { text: this.glyph_lead(GLYPHS.cube, host), color: SEGMENT_PALETTE.host },
      { text: this.glyph_lead(GLYPHS.user, context.user), color: SEGMENT_PALETTE.user },
      { text: this.glyph_lead(GLYPHS.folder, displayPath), color: SEGMENT_PALETTE.dir },
    ];
    if (context.lastCommandDurationMs >= DURATION_THRESHOLD_MS) {
      const seconds: number = Math.floor(context.lastCommandDurationMs / 1000);
      segments.push({ text: this.glyph_lead(GLYPHS.bolt, `${seconds}s`), color: SEGMENT_PALETTE.duration });
    }
    if (context.lastExitCode !== 0) {
      segments.push({
        text: this.glyph_lead(GLYPHS.error, String(context.lastExitCode)),
        color: SEGMENT_PALETTE.status,
      });
    }

    let bar: string = '';
    for (let index: number = 0; index < segments.length; index++) {
      const segment = segments[index];
      if (segment === undefined) {
        continue;
      }
      bar += `${ansiColor_make(segment.color.fg, segment.color.bg)} ${segment.text} ${ANSI_RESET}`;
      const next = segments[index + 1];
      if (this.nerdFont) {
        bar += next !== undefined
          ? `${ansiColor_make(segment.color.bg, next.color.bg)}${GLYPHS.powerline}${ANSI_RESET}`
          : `${ansiColor_make(segment.color.bg)}${GLYPHS.powerline}${ANSI_RESET}`;
      }
    }
    const glyphColor: string = context.lastExitCode === 0 ? '#00D787' : '#FF005F';
    this.term.write(`${bar}\r\n${ansiColor_make(glyphColor)}❯${ANSI_RESET} `);
    this.inputLocked = false;
  }

  /**
   * Prefixes text with a Nerd Font glyph when the font carries one.
   *
   * @param glyph - The icon codepoint.
   * @param text - The segment text.
   * @returns The composed segment text.
   */
  private glyph_lead(glyph: string, text: string): string {
    return this.nerdFont ? `${glyph} ${text}` : text;
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

/**
 * Builds a truecolor ANSI sequence.
 *
 * @param fgHex - Foreground color as `#rrggbb`.
 * @param bgHex - Optional background color as `#rrggbb`.
 * @returns The escape sequence.
 */
function ansiColor_make(fgHex: string, bgHex?: string): string {
  const fg: [number, number, number] = hex_toRgb(fgHex);
  let sequence: string = `\x1b[38;2;${fg[0]};${fg[1]};${fg[2]}m`;
  if (bgHex !== undefined) {
    const bg: [number, number, number] = hex_toRgb(bgHex);
    sequence += `\x1b[48;2;${bg[0]};${bg[1]};${bg[2]}m`;
  }
  return sequence;
}

/**
 * Parses a `#rrggbb` color into its channels.
 *
 * @param hex - The color string.
 * @returns The `[r, g, b]` triple.
 */
function hex_toRgb(hex: string): [number, number, number] {
  const value: number = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Reports whether a locally installed font family is available.
 *
 * @param family - The font family name.
 * @returns True when the browser can render with it.
 */
function fontAvailable_check(family: string): boolean {
  try {
    return document.fonts.check(`15px "${family}"`);
  } catch {
    return false;
  }
}
