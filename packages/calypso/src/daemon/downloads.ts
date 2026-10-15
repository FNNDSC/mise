/**
 * @file Downloads the daemon is serving, and how far each has got.
 *
 * A surface's DOWNLOAD hands the bytes to the browser's own save, which
 * shows nothing until the first byte arrives — and CUBE can take a minute
 * to send it. So a download carries an id (`dl`): the surface first asks
 * the daemon to open the file (`probe=1`), which waits on CUBE and answers
 * with the file's headers only, holding the opened stream; the browser's
 * save then takes that same stream (one request to CUBE, not two). Between
 * and after, the surface asks how far it has got (`progress=<id>`) and may
 * stop it (`cancel=<id>`). The daemon is the one passing the bytes, so the
 * count is the truth, whatever the browser.
 *
 * @module
 */
import { Transform, type TransformCallback } from 'node:stream';
import type { ServerResponse } from 'node:http';

/** Where a download stands. */
export type DownloadPhase = 'opening' | 'ready' | 'streaming' | 'done' | 'failed' | 'cancelled';

/**
 * What a surface is told about one download.
 *
 * @property id - The surface's id for it.
 * @property path - The file.
 * @property phase - Where it stands.
 * @property bytes - Bytes sent to the browser so far.
 * @property size - The file's size, when CUBE gave one.
 * @property reason - Why it failed.
 * @property elapsedMs - Since the surface asked.
 */
export interface DownloadReport {
  id: string;
  path: string;
  phase: DownloadPhase;
  bytes: number;
  size?: number;
  reason?: string;
  elapsedMs: number;
}

/** An opened file: its bytes and its size when known. */
export interface OpenedFile {
  stream: NodeJS.ReadableStream;
  size?: number;
}

interface DownloadEntry {
  id: string;
  path: string;
  phase: DownloadPhase;
  bytes: number;
  size?: number;
  reason?: string;
  startedAt: number;
  endedAt?: number;
  parked?: OpenedFile;
  parkTimer?: NodeJS.Timeout;
  response?: ServerResponse;
}

/** How long an opened file waits for the browser's save before it is let go. */
export const DOWNLOAD_PARK_MS: number = 60_000;

/** How long a finished download is still reported. */
export const DOWNLOAD_KEEP_MS: number = 10 * 60_000;

/** An id a surface may give: short, plain, never a path. */
export function downloadId_valid(id: string | null): id is string {
  return id !== null && /^[A-Za-z0-9_-]{6,64}$/.test(id);
}

/** Every download the daemon is serving or has just served. */
export class DownloadLedger {
  private readonly entries: Map<string, DownloadEntry> = new Map();

  /**
   * @param now - The clock.
   * @param parkMs - How long an opened file waits for the save.
   * @param keepMs - How long a finished one is reported.
   */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly parkMs: number = DOWNLOAD_PARK_MS,
    private readonly keepMs: number = DOWNLOAD_KEEP_MS,
  ) {}

  /**
   * Starts one: the daemon is asking CUBE for the file.
   *
   * @param id - The surface's id.
   * @param path - The file.
   */
  public begin(id: string, path: string): void {
    this.sweep();
    this.release(this.entries.get(id));
    this.entries.set(id, { id, path, phase: 'opening', bytes: 0, startedAt: this.now() });
  }

  /**
   * Holds an opened file for the browser's save to take.
   *
   * @param id - The download.
   * @param opened - The file CUBE answered with.
   * @returns False when the download ended first (cancelled while CUBE was
   *   answering): the file is let go and nothing is held.
   */
  public park(id: string, opened: OpenedFile): boolean {
    const entry: DownloadEntry | undefined = this.entries.get(id);
    if (entry === undefined || this.ended(entry)) {
      (opened.stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
      return false;
    }
    entry.phase = 'ready';
    entry.parked = opened;
    if (opened.size !== undefined) entry.size = opened.size;
    entry.parkTimer = setTimeout((): void => {
      if (entry.parked === undefined) return;
      this.release(entry);
      this.end(entry, 'failed', 'the browser never came for the file');
    }, this.parkMs);
    entry.parkTimer.unref?.();
    return true;
  }

  /**
   * Whether a download was cancelled: its save is refused, never begun again.
   *
   * @param id - The download.
   * @returns True when cancelled.
   */
  public cancelled(id: string): boolean {
    return this.entries.get(id)?.phase === 'cancelled';
  }

  /**
   * Takes a held file for the browser's save, if one is held.
   *
   * @param id - The download.
   * @returns The file, or null.
   */
  public claim(id: string): OpenedFile | null {
    const entry: DownloadEntry | undefined = this.entries.get(id);
    if (entry?.parked === undefined) return null;
    const opened: OpenedFile = entry.parked;
    delete entry.parked;
    if (entry.parkTimer !== undefined) clearTimeout(entry.parkTimer);
    return opened;
  }

  /**
   * Counts the bytes of a download as they go to the browser: the stage to
   * pipe between the file and the response.
   *
   * @param id - The download.
   * @param response - The browser's response, so a cancel can cut it.
   * @returns The counting stage.
   */
  public counter(id: string, response: ServerResponse): Transform {
    const entry: DownloadEntry | undefined = this.entries.get(id);
    if (entry !== undefined) {
      entry.phase = 'streaming';
      entry.response = response;
      response.on('close', (): void => {
        if (entry.phase !== 'streaming') return;
        if (response.writableFinished) this.end(entry, 'done');
        else this.end(entry, 'failed', 'the browser stopped the download');
      });
    }
    return new Transform({
      transform: (chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void => {
        if (entry !== undefined) entry.bytes += chunk.length;
        done(null, chunk);
      },
    });
  }

  /**
   * Says a download failed.
   *
   * @param id - The download.
   * @param reason - Why.
   */
  public fail(id: string, reason: string): void {
    const entry: DownloadEntry | undefined = this.entries.get(id);
    if (entry !== undefined && !this.ended(entry)) this.end(entry, 'failed', reason);
  }

  /**
   * Stops a download: the held file is let go, or the browser's stream cut,
   * which the browser reports as a failed download.
   *
   * @param id - The download.
   * @returns Whether there was one to stop.
   */
  public cancel(id: string): boolean {
    const entry: DownloadEntry | undefined = this.entries.get(id);
    if (entry === undefined || this.ended(entry)) return false;
    this.end(entry, 'cancelled', 'cancelled');
    this.release(entry);
    entry.response?.destroy();
    return true;
  }

  /**
   * How far one has got.
   *
   * @param id - The download.
   * @returns Its report, or null when the daemon knows none by that id.
   */
  public report(id: string): DownloadReport | null {
    const entry: DownloadEntry | undefined = this.entries.get(id);
    if (entry === undefined) return null;
    return {
      id: entry.id,
      path: entry.path,
      phase: entry.phase,
      bytes: entry.bytes,
      ...(entry.size !== undefined ? { size: entry.size } : {}),
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      elapsedMs: (entry.endedAt ?? this.now()) - entry.startedAt,
    };
  }

  private ended(entry: DownloadEntry): boolean {
    return entry.phase === 'done' || entry.phase === 'failed' || entry.phase === 'cancelled';
  }

  private end(entry: DownloadEntry, phase: DownloadPhase, reason?: string): void {
    entry.phase = phase;
    entry.endedAt = this.now();
    if (reason !== undefined) entry.reason = reason;
  }

  private release(entry: DownloadEntry | undefined): void {
    if (entry === undefined) return;
    if (entry.parkTimer !== undefined) clearTimeout(entry.parkTimer);
    if (entry.parked !== undefined) {
      (entry.parked.stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
      delete entry.parked;
    }
  }

  /** Forgets downloads finished long enough ago. */
  private sweep(): void {
    const cutoff: number = this.now() - this.keepMs;
    for (const [id, entry] of this.entries) {
      if (entry.endedAt !== undefined && entry.endedAt < cutoff) this.entries.delete(id);
    }
  }
}
