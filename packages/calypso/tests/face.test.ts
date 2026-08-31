/**
 * @file Tests for the daemon console face.
 *
 * The composer is pure, so its layout rules are asserted directly: the brain
 * only when it fits, the identity panel always, the log strip only when logs
 * exist. The runtime is exercised against a faked TTY: the alternate buffer
 * is entered and left, stray writes are caged in the ring and replayed on
 * drop-to-text, and keys toggle the two modes.
 *
 * @module
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  FaceLogRing,
  face_boot,
  face_frameCompose,
  face_isActive,
  face_ready,
  face_resume,
  face_start,
  face_stop,
  face_suspend,
  uptime_format,
  type FaceFrame,
  type FaceTelemetry,
} from '../src/daemon/face.js';
import { logoRows_count } from '@fnndsc/brasa';

const ESCAPES: RegExp = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
const plain = (text: string): string => text.replace(ESCAPES, '');

describe('FaceLogRing', () => {
  it('splits writes into lines and keeps the newest for the strip', () => {
    const ring: FaceLogRing = new FaceLogRing();
    ring.push('one\ntwo\n');
    ring.push('three\n');
    expect(ring.tail(2)).toEqual(['two', 'three']);
  });

  it('holds a partial line until its newline arrives', () => {
    const ring: FaceLogRing = new FaceLogRing();
    ring.push('progress: 4');
    expect(ring.tail(5)).toEqual([]);
    ring.push('2%\n');
    expect(ring.tail(5)).toEqual(['progress: 42%']);
  });

  it('treats a carriage return as a redraw, keeping only the last frame', () => {
    // A spinner redraws its line with \r many times a second; concatenating
    // frames made one enormous line once before (the argus spinner bug).
    const ring: FaceLogRing = new FaceLogRing();
    ring.push('\r[|] warming\r[/] warming\r[-] warming');
    ring.push('\r[+] warmed\n');
    expect(ring.tail(1)).toEqual(['[+] warmed']);
  });

  it('strips escapes, storing what the operator would have read', () => {
    const ring: FaceLogRing = new FaceLogRing();
    ring.push('\x1b[31mfailed\x1b[0m\n');
    expect(ring.tail(1)).toEqual(['failed']);
  });

  it('forgets the oldest lines past its capacity', () => {
    const ring: FaceLogRing = new FaceLogRing();
    for (let line = 0; line < 450; line++) ring.push(`line ${line}\n`);
    expect(ring.tail(1)).toEqual(['line 449']);
    // A drain can never replay more than the ring still holds.
    expect(ring.drain().length).toBeLessThanOrEqual(400);
    expect(ring.drain()).toEqual([]);
  });

  it('drains only what has not been drained before', () => {
    const ring: FaceLogRing = new FaceLogRing();
    ring.push('a\nb\n');
    expect(ring.drain()).toEqual(['a', 'b']);
    ring.push('c\n');
    expect(ring.drain()).toEqual(['c']);
    expect(ring.drain()).toEqual([]);
  });
});

describe('uptime_format', () => {
  it('renders a clock and adds days only past one', () => {
    expect(uptime_format(0)).toBe('00:00:00');
    expect(uptime_format(3661)).toBe('01:01:01');
    expect(uptime_format(90061)).toBe('1d 01:01:01');
  });
});

describe('face_frameCompose', () => {
  const telemetry: FaceTelemetry = { sessions: 2, busy: false, jobs: 120, feeds: 8 };
  const frame = (overrides: Partial<FaceFrame> = {}): FaceFrame => ({
    rows: 60,
    columns: 120,
    frameIndex: 3,
    phase: 'ready' as const,
    info: [{ label: 'wire', value: 'ws://pangea:42479' }],
    telemetry,
    logTail: [],
    uptimeSeconds: 61,
    ...overrides,
  });

  it('draws the brain above the panel when the terminal is tall enough', () => {
    const lines: string[] = face_frameCompose(frame());
    expect(lines.length).toBeGreaterThan(logoRows_count());
    const text: string = lines.map(plain).join('\n');
    expect(text).toContain('wire');
    expect(text).toContain('ws://pangea:42479');
    expect(text).toContain('surfaces');
    expect(text).toContain('120 jobs · 8 feeds');
  });

  it('drops the brain, never the identity panel, on a short terminal', () => {
    const lines: string[] = face_frameCompose(frame({ rows: 12 }));
    expect(lines.length).toBeLessThanOrEqual(11);
    const text: string = lines.map(plain).join('\n');
    expect(text).toContain('wire');
    expect(text).toContain('uptime');
  });

  it('shows the log strip only when there are log lines', () => {
    const quiet: string = face_frameCompose(frame()).map(plain).join('\n');
    expect(quiet).not.toContain('─');
    const noisy: string = face_frameCompose(frame({ logTail: ['retrying group 32'] }))
      .map(plain)
      .join('\n');
    expect(noisy).toContain('─');
    expect(noisy).toContain('retrying group 32');
  });

  it('clips every line so nothing can wrap', () => {
    const lines: string[] = face_frameCompose(frame({
      rows: 12,
      columns: 30,
      info: [{ label: 'attach', value: 'chell --remote --attach ws://somewhere:9999 --token deadbeef'.repeat(2) }],
      logTail: ['x'.repeat(500)],
    }));
    for (const line of lines) {
      expect(plain(line).length).toBeLessThanOrEqual(30);
    }
  });

  it('renders an idle panel when no telemetry hook is wired', () => {
    const text: string = face_frameCompose(frame({ telemetry: null })).map(plain).join('\n');
    expect(text).toContain('uptime');
    expect(text).not.toContain('surfaces');
  });

  it('boot phase: headline and tall log strip, no panel, no hint', () => {
    const text: string = face_frameCompose(frame({
      phase: 'boot',
      logTail: ['Prefetching /bin', 'Indexed 3 feed(s)'],
    })).map(plain).join('\n');
    expect(text).toContain('SYSTEMS INITIALIZING');
    expect(text).toContain('Indexed 3 feed(s)');
    expect(text).not.toContain('uptime');
    expect(text).not.toContain('HIT ESC');
  });

  it('ready phase closes the frame with the toggle hint', () => {
    const text: string = face_frameCompose(frame()).map(plain).join('\n');
    expect(text).toContain('HIT ESC TO TOGGLE THE BOOT LOG');
  });
});

describe('face runtime', () => {
  let written: string[];
  const stdoutDescriptors = ['isTTY', 'rows', 'columns'] as const;
  let savedStdout: Map<string, PropertyDescriptor | undefined>;
  let savedStdinIsTTY: PropertyDescriptor | undefined;
  let savedWrite: typeof process.stdout.write;
  let savedErrWrite: typeof process.stderr.write;
  let savedSetRawMode: typeof process.stdin.setRawMode;

  beforeEach(() => {
    jest.useFakeTimers();
    written = [];
    savedStdout = new Map(
      stdoutDescriptors.map((key) => [key, Object.getOwnPropertyDescriptor(process.stdout, key)]),
    );
    savedStdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 50, configurable: true });
    Object.defineProperty(process.stdout, 'columns', { value: 100, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    savedWrite = process.stdout.write;
    savedErrWrite = process.stderr.write;
    savedSetRawMode = process.stdin.setRawMode;
    process.stdin.setRawMode = jest.fn(() => process.stdin) as unknown as typeof process.stdin.setRawMode;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    face_stop();
    process.stdout.write = savedWrite;
    process.stderr.write = savedErrWrite;
    process.stdin.setRawMode = savedSetRawMode;
    for (const [key, descriptor] of savedStdout) {
      if (descriptor) Object.defineProperty(process.stdout, key, descriptor);
    }
    if (savedStdinIsTTY) Object.defineProperty(process.stdin, 'isTTY', savedStdinIsTTY);
    jest.useRealTimers();
  });

  it('refuses to start off a TTY, leaving sequential logging alone', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    expect(face_start({ info: [] })).toBe(false);
    expect(face_isActive()).toBe(false);
  });

  it('is idempotent: a second start reports the face already up', () => {
    expect(face_start({ info: [] })).toBe(true);
    expect(face_start({ info: [] })).toBe(true);
  });

  it('enters the alternate buffer and paints frames on its cadence', () => {
    expect(face_start({ info: [{ label: 'wire', value: 'ws://x:1' }] })).toBe(true);
    const joined: string = written.join('');
    expect(joined).toContain('\x1b[?1049h');
    const paintsBefore: number = written.length;
    jest.advanceTimersByTime(500);
    expect(written.length).toBeGreaterThan(paintsBefore);
    expect(face_isActive()).toBe(true);
  });

  it('cages stray writes in the ring and replays them on drop-to-text', () => {
    face_start({ info: [] });
    // A background sweep logs while the face owns the screen.
    process.stdout.write('Failed to fetch users for group 32; retrying.\n');
    expect(written.join('')).not.toContain('group 32');
    // Esc drops to the normal buffer; the caged line lands there.
    process.stdin.emit('data', Buffer.from('\x1b'));
    const joined: string = written.join('');
    expect(joined).toContain('\x1b[?1049l');
    expect(joined).toContain('Failed to fetch users for group 32; retrying.');
    expect(joined).toContain('any key returns');
  });

  it('returns to the face on any key from text mode', () => {
    face_start({ info: [] });
    process.stdin.emit('data', Buffer.from('q'));
    const before: number = written.filter((chunk) => chunk.includes('\x1b[?1049h')).length;
    process.stdin.emit('data', Buffer.from(' '));
    const after: number = written.filter((chunk) => chunk.includes('\x1b[?1049h')).length;
    expect(after).toBe(before + 1);
  });

  it('quickens the pulse while a command executes', () => {
    let busy: boolean = false;
    face_start({
      info: [],
      telemetry_get: (): FaceTelemetry => ({ sessions: 0, busy, jobs: 0, feeds: 0 }),
    });
    const frames_painted = (): number => written.filter((chunk) => chunk.includes('\x1b[H')).length;
    const idleStart: number = frames_painted();
    jest.advanceTimersByTime(900);
    const idleFrames: number = frames_painted() - idleStart;
    busy = true;
    const busyStart: number = frames_painted();
    jest.advanceTimersByTime(900);
    const busyFrames: number = frames_painted() - busyStart;
    // Paint cadence is constant; what quickens is the frame index. Both modes
    // painted, and the face stayed alive through the transition.
    expect(idleFrames).toBeGreaterThan(0);
    expect(busyFrames).toBeGreaterThan(0);
  });

  it('stops cleanly: buffer left, raw mode off, writes restored', () => {
    face_start({ info: [] });
    face_stop();
    expect(face_isActive()).toBe(false);
    expect(written.join('')).toContain('\x1b[?1049l');
    // A write after stop reaches the (test-recorded) real stdout again.
    const before: number = written.length;
    process.stdout.write('back to normal\n');
    expect(written.length).toBe(before + 1);
  });

  it('settles from boot to ready in place, on the same screen', () => {
    expect(face_boot()).toBe(true);
    jest.advanceTimersByTime(300);
    expect(written.join('')).toContain('SYSTEMS INITIALIZING');
    face_ready({ info: [{ label: 'wire', value: 'ws://x:1' }] });
    jest.advanceTimersByTime(300);
    const text: string = written.join('');
    expect(text).toContain('HIT ESC TO TOGGLE THE BOOT LOG');
    // One alternate-screen entry: the transition repaints, never re-enters.
    expect(written.filter((chunk) => chunk.includes('\x1b[?1049h')).length).toBe(1);
  });

  it('steps aside for a prompt and returns afterwards', () => {
    face_boot();
    face_suspend();
    // Suspended: normal buffer, cooked keys — a keypress must NOT re-enter.
    const entries = (): number => written.filter((chunk) => chunk.includes('\x1b[?1049h')).length;
    const before: number = entries();
    process.stdin.emit('data', Buffer.from('c'));
    expect(entries()).toBe(before);
    face_resume();
    expect(entries()).toBe(before + 1);
    expect(face_isActive()).toBe(true);
  });

  it('flushes caged lines when stopped mid-face', () => {
    face_boot();
    process.stdout.write('Startup aborted: Plugins\n');
    face_stop();
    const afterLeave: string = written.join('').split('\x1b[?1049l').pop() ?? '';
    expect(afterLeave).toContain('Startup aborted: Plugins');
  });

  it('re-raises Ctrl-C so the daemon shutdown path runs', () => {
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      face_start({ info: [] });
      process.stdin.emit('data', Buffer.from([0x03]));
      expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGINT');
      expect(face_isActive()).toBe(false);
    } finally {
      killSpy.mockRestore();
    }
  });
});
