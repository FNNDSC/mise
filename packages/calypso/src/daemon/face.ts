/**
 * @file The daemon console face: the terminal's resting state once booted.
 *
 * A daemon's terminal has no REPL competing for the screen, so after boot it
 * becomes an instrument panel: the mise brain pulsing on the alternate screen
 * buffer, the daemon's identity and addresses beside it, and a short strip of
 * the latest log lines beneath. The alternate buffer never scrolls, so the
 * animation anchors at absolute coordinates — none of the cursor arithmetic
 * that made the boot-phase pulse fight its own log output.
 *
 * The pulse is honest: idle is a slow ambient shimmer, an executing command
 * quickens it, and a surface attaching or detaching flares it briefly.
 *
 * Esc or `q` drops to the normal buffer — the full boot log restored exactly,
 * with the lines captured while the face was up flushed beneath it — and any
 * key returns. Ctrl-C stops the daemon from either mode.
 *
 * @module
 */
import chalk from 'chalk';
import { logo_frameRender, logoColumns_count, logoRows_count } from '@fnndsc/brasa';

/** One labeled fact shown on the face's identity panel. */
export interface FaceInfo {
  label: string;
  value: string;
}

/** Live daemon readings the face polls once per frame. */
export interface FaceTelemetry {
  /** Attached surfaces right now. */
  sessions: number;
  /** Whether a foreground command is executing. */
  busy: boolean;
  /** Jobs the proc index holds. */
  jobs: number;
  /** Feeds the proc index holds. */
  feeds: number;
}

/** What the face needs from its host. */
export interface FaceOptions {
  /** Identity panel rows: identity, wire, web surface, token, berth. */
  info: FaceInfo[];
  /** Live readings; omitted readings render as an idle daemon. */
  telemetry_get?: () => FaceTelemetry;
}

/** Strips ANSI escapes for width math and log-strip storage. */
const ESCAPE_PATTERN: RegExp = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

/** Log lines kept for the drop-to-text flush. */
const RING_CAPACITY: number = 400;
/** Log lines shown in the face's strip. */
const STRIP_LINES: number = 5;
/** Frame period. */
const TICK_MS: number = 100;
/** Ambient pulse advances one frame per this many ticks. */
const AMBIENT_STRIDE: number = 3;
/** How long an attach/detach flare quickens the pulse. */
const FLARE_MS: number = 1500;

/**
 * A bounded line buffer for output arriving while the face owns the screen.
 *
 * Everything a stray `console.log` (a retry warning, a background sweep
 * report) writes is caged here: the newest lines feed the face's strip, and
 * the whole run since the last flush is replayed into the normal buffer when
 * the operator drops to text — so nothing is ever lost, only re-homed.
 */
export class FaceLogRing {
  private lines: string[] = [];
  private pending: string = '';
  private unflushed: number = 0;

  /**
   * Absorbs one raw write, splitting it into stripped, stored lines.
   *
   * @param chunk - The text a hijacked stdout/stderr write carried.
   */
  public push(chunk: string): void {
    const text: string = this.pending + chunk.replace(ESCAPE_PATTERN, '');
    const parts: string[] = text.split('\n');
    this.pending = parts.pop() ?? '';
    for (const line of parts) {
      this.lines.push(line);
      this.unflushed += 1;
    }
    if (this.lines.length > RING_CAPACITY) {
      const excess: number = this.lines.length - RING_CAPACITY;
      this.lines.splice(0, excess);
      this.unflushed = Math.min(this.unflushed, this.lines.length);
    }
  }

  /**
   * The newest lines, for the face's log strip.
   *
   * @param count - How many lines the strip shows.
   * @returns Up to `count` lines, oldest first.
   */
  public tail(count: number): string[] {
    return this.lines.slice(-count);
  }

  /**
   * Returns and forgets the lines not yet replayed into the normal buffer.
   *
   * @returns The unflushed lines, oldest first.
   */
  public drain(): string[] {
    const drained: string[] = this.unflushed === 0 ? [] : this.lines.slice(-this.unflushed);
    this.unflushed = 0;
    return drained;
  }
}

/** Everything the pure composer needs to draw one frame. */
export interface FaceFrame {
  rows: number;
  columns: number;
  frameIndex: number;
  info: FaceInfo[];
  telemetry: FaceTelemetry | null;
  logTail: string[];
  uptimeSeconds: number;
}

/**
 * Formats an uptime as `2d 03:14:07` / `03:14:07`.
 *
 * @param seconds - Whole seconds since the daemon came up.
 * @returns The formatted uptime.
 */
export function uptime_format(seconds: number): string {
  const days: number = Math.floor(seconds / 86400);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const clock: string =
    `${pad(Math.floor((seconds % 86400) / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(Math.floor(seconds % 60))}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

/**
 * Truncates a plain (escape-free) line to the terminal width.
 *
 * @param line - The plain line.
 * @param columns - The terminal width.
 * @returns The line, cut so it can never wrap.
 */
function line_clip(line: string, columns: number): string {
  return line.length > columns ? line.slice(0, Math.max(0, columns - 1)) + '…' : line;
}

/**
 * Composes one face frame as screen lines, top to bottom. Pure: no terminal
 * control, no timers — the runtime places these under the alternate buffer
 * and the tests read them directly.
 *
 * @param frame - The readings and geometry for this frame.
 * @returns The lines to paint, at most `frame.rows - 1` of them.
 */
export function face_frameCompose(frame: FaceFrame): string[] {
  const lines: string[] = [];
  const label_pad: number = Math.max(...frame.info.map((row: FaceInfo): number => row.label.length), 8);

  const statusRows: FaceInfo[] = [
    { label: 'uptime', value: uptime_format(frame.uptimeSeconds) },
    ...(frame.telemetry !== null
      ? [
          { label: 'surfaces', value: String(frame.telemetry.sessions) },
          { label: 'engine', value: frame.telemetry.busy ? 'EXECUTING' : 'idle' },
          { label: 'index', value: `${frame.telemetry.jobs} jobs · ${frame.telemetry.feeds} feeds` },
        ]
      : []),
  ];
  const panel: FaceInfo[] = [...frame.info, ...statusRows];
  const stripHeight: number = frame.logTail.length > 0 ? frame.logTail.length + 1 : 0;
  const brainFits: boolean =
    logoRows_count() + panel.length + stripHeight + 3 <= frame.rows - 1 &&
    logoColumns_count() <= frame.columns;

  if (brainFits) {
    const indent: string = ' '.repeat(Math.max(0, Math.floor((frame.columns - logoColumns_count()) / 2)));
    for (const brainLine of logo_frameRender(frame.frameIndex)) {
      lines.push(indent + brainLine);
    }
    lines.push('');
  }

  for (const row of panel) {
    const plain: string = `  ${row.label.padEnd(label_pad)}  ${row.value}`;
    const clipped: string = line_clip(plain, frame.columns);
    const labelEnd: number = 2 + row.label.length;
    lines.push(chalk.cyan(clipped.slice(0, labelEnd)) + clipped.slice(labelEnd));
  }

  if (frame.logTail.length > 0) {
    lines.push(chalk.gray('  ' + '─'.repeat(Math.min(40, Math.max(0, frame.columns - 4)))));
    for (const logLine of frame.logTail) {
      lines.push(chalk.gray(line_clip(`  ${logLine}`, frame.columns)));
    }
  }

  return lines.slice(0, Math.max(0, frame.rows - 1));
}

/** The face's mutable runtime state; one face per process. */
interface FaceState {
  options: FaceOptions;
  ring: FaceLogRing;
  mode: 'face' | 'text';
  interval: NodeJS.Timeout | null;
  frameIndex: number;
  tick: number;
  startedAt: number;
  flareUntil: number;
  lastSessions: number;
  realOut: (chunk: string) => void;
  realErr: (chunk: string) => void;
  stdoutWrite: typeof process.stdout.write;
  stderrWrite: typeof process.stderr.write;
  keyHandler: (data: Buffer) => void;
  exitRestore: () => void;
}

let state: FaceState | null = null;

/** Whether the console face currently owns the terminal. */
export function face_isActive(): boolean {
  return state !== null;
}

/**
 * Routes stray writes into the ring while the face owns the screen.
 */
function writes_hijack(): void {
  if (state === null) return;
  const active: FaceState = state;
  const capture = ((chunk: string | Uint8Array): boolean => {
    const text: string = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    active.ring.push(text);
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = capture;
  process.stderr.write = capture as typeof process.stderr.write;
}

/** Restores the terminal's own writes. */
function writes_restore(): void {
  if (state === null) return;
  process.stdout.write = state.stdoutWrite;
  process.stderr.write = state.stderrWrite;
}

/**
 * Paints one frame: home the cursor, draw every composed line with a
 * clear-to-end, then clear everything below. No full-screen erase per frame,
 * so the repaint never flickers.
 */
function frame_paint(): void {
  if (state === null) return;
  const telemetry: FaceTelemetry | null = state.options.telemetry_get?.() ?? null;

  if (telemetry !== null && telemetry.sessions !== state.lastSessions) {
    state.flareUntil = Date.now() + FLARE_MS;
    state.lastSessions = telemetry.sessions;
  }
  const quickened: boolean = (telemetry?.busy ?? false) || Date.now() < state.flareUntil;
  state.tick += 1;
  if (quickened || state.tick % AMBIENT_STRIDE === 0) {
    state.frameIndex += 1;
  }

  const lines: string[] = face_frameCompose({
    rows: process.stdout.rows || 24,
    columns: process.stdout.columns || 80,
    frameIndex: state.frameIndex,
    info: state.options.info,
    telemetry,
    logTail: state.ring.tail(STRIP_LINES),
    uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
  });
  state.realOut('\x1b[H' + lines.map((line: string): string => line + '\x1b[K').join('\r\n') + '\x1b[J');
}

/** Enters (or re-enters) the alternate-buffer face. */
function face_enter(): void {
  if (state === null || state.mode === 'face') return;
  state.mode = 'face';
  writes_hijack();
  state.realOut('\x1b[?1049h\x1b[?25l');
  frame_paint();
  state.interval = setInterval(frame_paint, TICK_MS);
}

/**
 * Drops to the normal buffer: the boot log restored exactly, the lines the
 * face caged flushed beneath it, and a hint on the way back.
 */
function text_drop(): void {
  if (state === null || state.mode === 'text') return;
  state.mode = 'text';
  if (state.interval !== null) {
    clearInterval(state.interval);
    state.interval = null;
  }
  writes_restore();
  state.realOut('\x1b[?1049l\x1b[?25h');
  for (const line of state.ring.drain()) {
    state.realOut(line + '\n');
  }
  state.realOut(chalk.gray('[face] any key returns to the console face; Ctrl-C stops the daemon\n'));
}

/**
 * Takes the daemon terminal over as the console face.
 *
 * A no-op off a TTY (systemd, nohup, a pipe): the daemon then logs
 * sequentially exactly as before.
 *
 * @param options - Identity rows and live-telemetry hook.
 * @returns True when the face took the screen.
 */
export function face_start(options: FaceOptions): boolean {
  if (state !== null) return true;
  if (!process.stdout.isTTY || !process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return false;
  }

  const realOutWrite: typeof process.stdout.write = process.stdout.write.bind(process.stdout);
  const realErrWrite: typeof process.stderr.write = process.stderr.write.bind(process.stderr);
  const exitRestore = (): void => {
    // The process is dying with the face up: put the operator's terminal
    // back — normal buffer, visible cursor — whatever else is going on.
    if (state === null) return;
    writes_restore();
    if (state.mode === 'face') realOutWrite('\x1b[?1049l\x1b[?25h');
  };
  const keyHandler = (data: Buffer): void => {
    if (state === null) return;
    if (data.includes(0x03)) {
      // Raw mode swallows the terminal's own Ctrl-C; re-raise it so the
      // daemon's ordinary shutdown path (berth cleanup included) runs.
      face_stop();
      process.kill(process.pid, 'SIGINT');
      return;
    }
    if (state.mode === 'face') {
      const key: string = data.toString('utf8');
      if (key === 'q' || key === 'Q' || key === '\x1b') text_drop();
    } else {
      face_enter();
    }
  };

  state = {
    options,
    ring: new FaceLogRing(),
    mode: 'text',
    interval: null,
    frameIndex: 0,
    tick: 0,
    startedAt: Date.now(),
    flareUntil: 0,
    lastSessions: options.telemetry_get?.().sessions ?? 0,
    realOut: (chunk: string): void => { realOutWrite(chunk); },
    realErr: (chunk: string): void => { realErrWrite(chunk); },
    stdoutWrite: process.stdout.write,
    stderrWrite: process.stderr.write,
    keyHandler,
    exitRestore,
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', keyHandler);
  process.once('exit', exitRestore);

  face_enter();
  return true;
}

/** Releases the terminal entirely: buffers, writes, raw mode, listeners. */
export function face_stop(): void {
  if (state === null) return;
  if (state.interval !== null) clearInterval(state.interval);
  writes_restore();
  if (state.mode === 'face') state.realOut('\x1b[?1049l\x1b[?25h');
  process.stdin.off('data', state.keyHandler);
  if (typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(false);
  process.stdin.pause();
  process.off('exit', state.exitRestore);
  state = null;
}
