/**
 * @file Recording what a session did, as a manifest.
 *
 * The workflows worth sharing are the fiddly ones nobody will retype
 * correctly. A recorder is how one gets written: the operator does the work
 * once — typing, or pressing on a surface, which is the same thing by law —
 * and the lines they ran come back as a file someone else can play.
 *
 * A recording is a TRANSCRIPT, faithful to what happened. It does not invent
 * expectations: a file that guessed at assertions would be a fiction, and
 * adding `expect` lines is the author's act, the one that turns a recording
 * into a test.
 *
 * @module
 */

/** Where the recording will be written, or null when nothing is recording. */
let target: string | null = null;
/** The lines captured so far, in the order they ran. */
let captured: string[] = [];
/** When the recording started. */
let startedAt: number = 0;
/** Depth of work that must not be captured: a played manifest's own lines. */
let muted: number = 0;

/** What a recording is doing. */
export interface RecorderState {
  /** Where it will be written, or null when nothing is recording. */
  target: string | null;
  /** How many lines it holds. */
  lines: number;
  /** How long it has been running. */
  elapsedMs: number;
}

/**
 * Begins a recording.
 *
 * @param path - Where the manifest will be written.
 */
export function recorder_start(path: string): void {
  target = path;
  captured = [];
  startedAt = Date.now();
  muted = 0;
}

/**
 * Notes a line the session ran.
 *
 * Lines about recording itself are never captured — a manifest that starts
 * and stops a recording when played is a machine that films its own camera —
 * and neither are the lines a played manifest runs, which are already in the
 * file being played.
 *
 * @param line - The line, as it was run.
 */
export function recorder_note(line: string): void {
  if (target === null || muted > 0) return;
  const trimmed: string = line.trim();
  if (trimmed.length === 0) return;
  const verb: string = trimmed.split(/\s+/)[0];
  if (verb === 'record' || verb === 'play') return;
  captured.push(trimmed);
}

/** Stops capturing while a manifest plays its own lines. */
export function recorder_mute(): void {
  muted += 1;
}

/** Resumes capturing after a played manifest finishes. */
export function recorder_unmute(): void {
  if (muted > 0) muted -= 1;
}

/**
 * Ends the recording.
 *
 * @returns Where it was recording and what it captured, or null when nothing was.
 */
export function recorder_stop(): { target: string; lines: string[]; elapsedMs: number } | null {
  if (target === null) return null;
  const held: { target: string; lines: string[]; elapsedMs: number } = {
    target,
    lines: [...captured],
    elapsedMs: Date.now() - startedAt,
  };
  target = null;
  captured = [];
  startedAt = 0;
  return held;
}

/**
 * What the recorder is doing.
 *
 * @returns The current state.
 */
export function recorder_state(): RecorderState {
  return {
    target,
    lines: captured.length,
    elapsedMs: target === null ? 0 : Date.now() - startedAt,
  };
}
