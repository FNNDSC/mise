/**
 * @file The indwelling console: a DOM terminal in the ARGUS prototype's
 * tradition.
 *
 * Not a character-grid emulator: the console is a styled document, exactly
 * as the original ARGUS prototype built it. A native `<input>` carries the
 * command line (free cursor movement, selection, IME), an HTML transcript
 * carries the session's rendered stream (ANSI converted to styled spans by
 * `ansi.ts`), and a Powerlevel10k-style segment bar renders the prompt
 * context the daemon pushes. Line history, tab completion (through the
 * wire's `complete` request), and typeahead queueing are native here, the
 * things a grid emulator made hard.
 *
 * @module
 */
import { ansi_toHtml, html_escape } from './ansi.js';
import { procPromptState_get, type ProcPromptState, type PromptContext, type WireEnvelope } from '@fnndsc/menu';
import type { ExecuteOutcome, OutputChannel } from '../calypso/client.js';

/** A completion answer from the wire: candidates and the prefix they complete. */
export interface CompletionAnswer {
  candidates: string[];
  prefix: string;
}

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
const SEGMENT_PALETTE: Record<
  'pacs' | 'host' | 'user' | 'dir' | 'physical' | 'duration' | 'status',
  SegmentColor
> = {
  pacs: { bg: '#875FFF', fg: '#FFFFFF' },
  host: { bg: '#00AFFF', fg: '#001018' },
  user: { bg: '#00D787', fg: '#00140C' },
  dir: { bg: '#FFD75F', fg: '#201800' },
  physical: { bg: '#FF5F5F', fg: '#1B0000' },
  duration: { bg: '#FF8700', fg: '#201000' },
  status: { bg: '#FF005F', fg: '#FFFFFF' },
};

/**
 * Presentation for each process-index state, mirroring chell's p10k theme:
 * cold indexing on the duration orange, cached reconciliation on the time
 * violet, failure on the status red.
 */
const PROC_STATE_SEGMENTS: Record<ProcPromptState, { icon: string; label: string; color: SegmentColor }> = {
  cold: { icon: '\uf2dc', label: 'proc cold', color: { bg: '#FF8700', fg: '#201000' } },
  cached: { icon: '\uf021', label: 'proc cached, refreshing', color: { bg: '#5F5F87', fg: '#FFFFFF' } },
  failed: { icon: '\uf071', label: 'proc failed', color: { bg: '#FF005F', fg: '#FFFFFF' } },
};

/**
 * Powerline separator and Font Awesome glyphs, from the bundled Nerd Font.
 *
 * Written as `\u` escapes rather than literal characters: these live in the
 * Private Use Area, and a literal copy is one careless re-encoding away from
 * becoming an empty string — which renders as a prompt with no separators and
 * no icons, exactly as if the font had failed to load. The values match
 * chell's p10k theme (`packages/chell/src/core/prompt/theme_p10k.ts`) so the
 * two surfaces read as one family.
 */
const GLYPHS = {
  powerline: '\ue0b0',
  cube: '\uf1b2',
  database: '\uf1c0',
  user: '\uf007',
  folder: '\uf07c',
  microscope: '\uf610',
  bolt: '\uf0e7',
  error: '\uf057',
} as const;

/** Minimum command duration (ms) before the duration segment appears. */
const DURATION_THRESHOLD_MS: number = 3_000;

/** How many submitted lines the arrow-key history retains. */
const HISTORY_LIMIT: number = 200;

/**
 * The ARGUS console: transcript, prompt bar, and input line in one screen.
 *
 * @example
 * ```
 * const terminal = new ArgusTerminal(container, submit_handle, complete_ask);
 * terminal.promptContext_set(context);
 * terminal.prompt_draw();
 * ```
 */
export class ArgusTerminal {
  private readonly output: HTMLElement;
  /** Live progress rows, between the transcript and the prompt. */
  private readonly progressRegion: HTMLElement;
  private readonly promptBar: HTMLElement;
  private readonly inputGlyph: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly submit: (line: string) => Promise<void>;
  private readonly complete: (prefix: string) => Promise<CompletionAnswer>;
  private promptContext: PromptContext | null = null;
  private busy: boolean = true;
  private readonly queuedLines: string[] = [];
  private readonly history: string[] = [];
  private historyIndex: number = 0;
  private streamBlock: HTMLElement | null = null;
  /** The trailing element holding the not-yet-completed stream line. */
  private streamPendingElement: HTMLElement | null = null;
  /** Raw text of the current stream line, rewound by `\r` and cleared by `\n`. */
  private streamPendingText: string = '';
  /** The channel that opened the current stream line, for its styling. */
  private streamPendingChannel: OutputChannel = 'data';

  /**
   * Builds the console into a container and wires its input events.
   *
   * @param container - The DOM element the console renders into.
   * @param submit - Handles one submitted line; the console queues further
   *   lines until the returned promise settles.
   * @param complete - Answers a tab-completion request for a line prefix.
   */
  constructor(
    container: HTMLElement,
    submit: (line: string) => Promise<void>,
    complete: (prefix: string) => Promise<CompletionAnswer>,
  ) {
    this.submit = submit;
    this.complete = complete;
    container.innerHTML = `
      <div class="argus-screen">
        <div class="argus-output"></div>
        <div class="argus-progress"></div>
        <div class="argus-prompt-bar"></div>
        <div class="argus-input-line">
          <span class="argus-input-glyph">❯</span>
          <input type="text" autocomplete="off" spellcheck="false" aria-label="console input" />
        </div>
      </div>`;
    this.output = element_query(container, '.argus-output');
    this.progressRegion = element_query(container, '.argus-progress');
    this.promptBar = element_query(container, '.argus-prompt-bar');
    this.inputGlyph = element_query(container, '.argus-input-glyph');
    this.input = element_query(container, 'input') as HTMLInputElement;

    container.addEventListener('click', (): void => this.input.focus());
    this.input.addEventListener('keydown', (event: KeyboardEvent): void => this.key_handle(event));
  }

  /**
   * The element live progress rows render into.
   *
   * @returns The console's progress region.
   */
  public progressRegion_get(): HTMLElement {
    return this.progressRegion;
  }

  /** Scrolls the transcript to its end (called after drawer resizes too). */
  public size_fit(): void {
    this.output.scrollTop = this.output.scrollHeight;
  }

  /** Focuses the input so keystrokes land in the session. */
  public focus_take(): void {
    this.input.focus();
  }

  /**
   * Stores the freshest prompt context pushed by the daemon.
   *
   * @param context - The engine-known prompt facts.
   */
  public promptContext_set(context: PromptContext): void {
    this.promptContext = context;
    // An idle console repaints immediately: warm-up pushes arrive between
    // commands, and the percentage should climb without an Enter press. A
    // busy console leaves the bar to prompt_draw, which owns the unlock.
    if (!this.busy) {
      this.promptBar.innerHTML = this.promptSegments_render();
    }
  }

  /**
   * Redraws the prompt bar from the stored context, unlocks input, and
   * drains any typeahead-queued line.
   */
  public prompt_draw(): void {
    this.stream_close();
    this.promptBar.innerHTML = this.promptSegments_render();
    const exitOk: boolean = (this.promptContext?.lastExitCode ?? 0) === 0;
    this.inputGlyph.style.color = exitOk ? '#00D787' : '#FF005F';
    this.busy = false;
    const queued: string | undefined = this.queuedLines.shift();
    if (queued !== undefined) {
      this.line_run(queued);
    }
    this.size_fit();
  }

  /**
   * Writes greeting lines above the first prompt.
   *
   * @param lines - The lines to write (may carry ANSI color).
   */
  public banner_write(lines: string[]): void {
    for (const line of lines) {
      this.block_append('argus-banner-line', ansi_toHtml(line));
    }
  }

  /**
   * Writes one live output chunk from the executing command.
   *
   * A chunk is not a line. Progress output redraws itself by returning to
   * column zero with `\r` and rewriting, so the stream is kept as completed
   * lines plus one pending line: `\n` completes the pending line, `\r`
   * discards it, and anything else extends it. Without this a spinner's
   * every frame would append, turning one redrawing line into thousands.
   *
   * @param channel - The producing channel; status renders dimmed.
   * @param chunk - The text chunk.
   */
  public output_write(channel: OutputChannel, chunk: string): void {
    this.stream_ensure();
    let rest: string = chunk;
    while (rest.length > 0) {
      const breakAt: number = rest.search(/[\r\n]/);
      if (breakAt === -1) {
        this.pending_extend(channel, rest);
        break;
      }
      this.pending_extend(channel, rest.slice(0, breakAt));
      // A `\r\n` pair is one line ending, not a rewind followed by a blank
      // line; only a lone `\r` means the line is about to be rewritten.
      const isCrLf: boolean = rest[breakAt] === '\r' && rest[breakAt + 1] === '\n';
      if (rest[breakAt] === '\n' || isCrLf) {
        this.pending_commit();
      } else {
        this.streamPendingText = '';
      }
      rest = rest.slice(breakAt + (isCrLf ? 2 : 1));
    }
    this.pending_paint();
    this.size_fit();
  }

  /**
   * Extends the pending line, adopting the channel when the line is new.
   *
   * @param channel - The producing channel.
   * @param text - The text to append (free of line breaks).
   */
  private pending_extend(channel: OutputChannel, text: string): void {
    if (this.streamPendingText.length === 0) {
      this.streamPendingChannel = channel;
    }
    this.streamPendingText += text;
  }

  /** Moves the pending line into the committed transcript above it. */
  private pending_commit(): void {
    this.streamPendingElement?.insertAdjacentHTML('beforebegin', `${this.pending_toHtml()}\n`);
    this.streamPendingText = '';
  }

  /** Repaints the pending line in place. */
  private pending_paint(): void {
    if (this.streamPendingElement !== null) {
      this.streamPendingElement.innerHTML = this.pending_toHtml();
    }
  }

  /**
   * Renders the pending line's text with its channel's styling.
   *
   * @returns The pending line's HTML, empty when the line is empty.
   */
  private pending_toHtml(): string {
    if (this.streamPendingText.length === 0) {
      return '';
    }
    const html: string = ansi_toHtml(this.streamPendingText);
    return this.streamPendingChannel === 'status' ? `<span class="dim">${html}</span>` : html;
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
        this.block_append('argus-result', ansi_toHtml(envelope.rendered));
      }
      const renderedErr: string = envelope.renderedErr ?? '';
      if (!outcome.liveChannels.has('err') && renderedErr.length > 0) {
        this.block_append('argus-result error', ansi_toHtml(renderedErr));
      }
    }
  }

  /**
   * Renders an envelope another surface produced, tagged with its origin.
   *
   * @param surface - The originating surface's bus id.
   * @param envelope - The broadcast envelope.
   */
  public session_write(surface: string, envelope: WireEnvelope): void {
    if (envelope.rendered.length === 0) {
      return;
    }
    this.block_append('dim', `[surface ${html_escape(surface.slice(0, 6))}]`);
    this.block_append('argus-result', ansi_toHtml(envelope.rendered));
    this.size_fit();
  }

  /**
   * Runs a line as if the operator had typed it: echoed into the
   * transcript, then submitted. While a command is executing the line is
   * queued and runs when the prompt returns, so lowered gestures and
   * typeahead never disappear.
   *
   * @param line - The command line to run.
   */
  public line_run(line: string): void {
    if (this.busy) {
      this.queuedLines.push(line);
      return;
    }
    this.busy = true;
    this.history_push(line);
    this.block_append('argus-echo', `<span class="prompt-glyph">❯</span> <span class="user-input">${html_escape(line)}</span>`);
    this.size_fit();
    void this.submit(line);
  }

  /**
   * Routes input-line keys: Enter submits or queues, arrows walk history,
   * Tab asks the wire for completion.
   *
   * @param event - The keyboard event.
   */
  private key_handle(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      const line: string = this.input.value;
      this.input.value = '';
      if (line.trim().length > 0) {
        this.line_run(line);
      } else if (!this.busy) {
        this.block_append('argus-echo', '<span class="prompt-glyph">❯</span>');
      }
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.historyIndex > 0) {
        this.historyIndex -= 1;
        this.input.value = this.history[this.historyIndex] ?? '';
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (this.historyIndex < this.history.length) {
        this.historyIndex += 1;
        this.input.value = this.history[this.historyIndex] ?? '';
      }
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      void this.completion_apply();
    }
  }

  /**
   * Asks the wire for completions of the current input and applies the
   * answer: a single candidate completes in place; several are listed in
   * the transcript, prototype-style.
   */
  private async completion_apply(): Promise<void> {
    const line: string = this.input.value;
    if (line.length === 0) {
      return;
    }
    let answer: CompletionAnswer;
    try {
      answer = await this.complete(line);
    } catch {
      return;
    }
    if (answer.candidates.length === 1) {
      const sole: string = answer.candidates[0] ?? '';
      this.input.value = line.slice(0, line.length - answer.prefix.length) + sole;
      return;
    }
    if (answer.candidates.length > 1) {
      // Readline manners: grow the input to the candidates' longest common
      // prefix first, then show the remaining choices.
      const common: string = commonPrefix_find(answer.candidates);
      if (common.length > answer.prefix.length) {
        this.input.value = line.slice(0, line.length - answer.prefix.length) + common;
      }
      this.block_append('dim', html_escape(answer.candidates.join('  ')));
      this.size_fit();
    }
  }

  /**
   * Records a line in the arrow-key history, bounded and deduplicated
   * against the immediately previous entry.
   *
   * @param line - The submitted line.
   */
  private history_push(line: string): void {
    if (this.history[this.history.length - 1] !== line) {
      this.history.push(line);
      if (this.history.length > HISTORY_LIMIT) {
        this.history.shift();
      }
    }
    this.historyIndex = this.history.length;
  }

  /**
   * Appends one block to the transcript.
   *
   * @param className - The block's CSS class(es).
   * @param html - The block's inner HTML (already escaped/converted).
   */
  private block_append(className: string, html: string): void {
    const block: HTMLDivElement = document.createElement('div');
    block.className = `argus-line ${className}`;
    block.innerHTML = html;
    this.output.appendChild(block);
  }

  /**
   * Returns the open live-stream block for the executing command, creating
   * it on first use.
   *
   * @returns The stream block element.
   */
  private stream_ensure(): HTMLElement {
    if (this.streamBlock === null) {
      const block: HTMLDivElement = document.createElement('div');
      block.className = 'argus-line argus-stream';
      const pending: HTMLSpanElement = document.createElement('span');
      pending.className = 'argus-stream-pending';
      block.appendChild(pending);
      this.output.appendChild(block);
      this.streamBlock = block;
      this.streamPendingElement = pending;
      this.streamPendingText = '';
      this.streamPendingChannel = 'data';
    }
    return this.streamBlock;
  }

  /**
   * Closes the live-stream block at the end of a command.
   *
   * A command may end mid-line — a spinner's last frame carries no newline —
   * so the pending line is committed rather than dropped, unless the spinner
   * already erased it, in which case there is nothing to keep.
   */
  private stream_close(): void {
    if (this.streamPendingText.length > 0) {
      this.pending_commit();
    }
    this.streamPendingElement?.remove();
    this.streamPendingElement = null;
    this.streamPendingText = '';
    this.streamBlock = null;
  }

  /**
   * Renders the Powerlevel10k segment bar from the stored context.
   *
   * @returns The prompt bar's inner HTML.
   */
  private promptSegments_render(): string {
    const context: PromptContext | null = this.promptContext;
    if (context === null) {
      return '<span class="dim">argus</span>';
    }
    const host: string = context.uri.replace(/^https?:\/\//, '').replace(/\/api\/v1\/?$/, '');
    const homePrefix: string = `/home/${context.user}`;
    const displayPath: string = context.cwd.startsWith(homePrefix)
      ? `~${context.cwd.slice(homePrefix.length)}`
      : context.cwd;

    // Segment order tracks chell's p10k theme: [pacs] host user dir
    // [physical] [duration] [status]. The daemon pushes every fact used here.
    const segments: Array<{ text: string; color: SegmentColor }> = [];
    if (context.pacsserver !== null && context.pacsserver.length > 0) {
      segments.push({
        text: `${GLYPHS.database} ${context.pacsserver}`,
        color: SEGMENT_PALETTE.pacs,
      });
    }
    segments.push(
      { text: `${GLYPHS.cube} ${host}`, color: SEGMENT_PALETTE.host },
      { text: `${GLYPHS.user} ${context.user}`, color: SEGMENT_PALETTE.user },
      { text: `${GLYPHS.folder} ${displayPath}`, color: SEGMENT_PALETTE.dir },
    );
    if (context.physicalMode) {
      segments.push({ text: `${GLYPHS.microscope} PHYSICAL`, color: SEGMENT_PALETTE.physical });
    }
    if (context.procWarmup !== undefined) {
      const state: ProcPromptState = procPromptState_get(context.procWarmup);
      const presentation = PROC_STATE_SEGMENTS[state];
      segments.push({
        text: `${presentation.icon} ${presentation.label}: ${procProgress_format(context.procWarmup.loaded, context.procWarmup.total ?? 0)}`,
        color: presentation.color,
      });
    }
    if (context.lastCommandDurationMs >= DURATION_THRESHOLD_MS) {
      const seconds: number = Math.floor(context.lastCommandDurationMs / 1000);
      segments.push({ text: `${GLYPHS.bolt} ${seconds}s`, color: SEGMENT_PALETTE.duration });
    }
    if (context.lastExitCode !== 0) {
      segments.push({ text: `${GLYPHS.error} ${context.lastExitCode}`, color: SEGMENT_PALETTE.status });
    }

    let bar: string = '';
    for (let index: number = 0; index < segments.length; index++) {
      const segment = segments[index];
      if (segment === undefined) {
        continue;
      }
      bar += `<span style="color:${segment.color.fg};background-color:${segment.color.bg}"> ${html_escape(segment.text)} </span>`;
      const next = segments[index + 1];
      bar += next !== undefined
        ? `<span style="color:${segment.color.bg};background-color:${next.color.bg}">${GLYPHS.powerline}</span>`
        : `<span style="color:${segment.color.bg}">${GLYPHS.powerline}</span>`;
    }
    return bar;
  }
}

/**
 * Queries a required child element.
 *
 * @param root - The element to query within.
 * @param selector - The CSS selector.
 * @returns The matched element.
 * @throws {Error} When nothing matches.
 */
function element_query(root: HTMLElement, selector: string): HTMLElement {
  const element: HTMLElement | null = root.querySelector(selector);
  if (element === null) {
    throw new Error(`console structure is missing '${selector}'`);
  }
  return element;
}

/**
 * Finds the longest prefix shared by every candidate.
 *
 * @param candidates - The completion candidates (at least one).
 * @returns The longest common prefix, possibly empty.
 */
function commonPrefix_find(candidates: string[]): string {
  let common: string = candidates[0] ?? '';
  for (const candidate of candidates) {
    let length: number = 0;
    while (
      length < common.length &&
      length < candidate.length &&
      common[length] === candidate[length]
    ) {
      length++;
    }
    common = common.slice(0, length);
    if (common.length === 0) {
      break;
    }
  }
  return common;
}

/**
 * Formats warm-up progress for the proc segment, mirroring chell's prompt
 * utils (duplicated by value: argus may not import the execution stack).
 *
 * @param loaded - Plugin instances currently indexed.
 * @param total - Authoritative total, or 0 when CUBE has not reported one.
 * @returns `loaded/total percent%`, or `loaded/?` without a total.
 */
function procProgress_format(loaded: number, total: number): string {
  if (total <= 0) return `${loaded}/?`;
  const percent: number = Math.min(99, Math.floor((loaded / total) * 100));
  return `${loaded}/${total} ${percent}%`;
}
