/**
 * @file The daemon's own console output, caged while a surface holds the
 * terminal.
 *
 * When the daemon's terminal is handed to an attached console surface, the
 * daemon keeps writing: a roster row, a topology row, a warm-up that settles
 * late. Written straight to the terminal they would land across the
 * surface's prompt. They are held here instead and handed back when the
 * surface detaches, so nothing is lost, only re-homed.
 *
 * @module
 */
import { FaceLogRing } from './face.js';

/** The hijacked writes and the ring that holds what they carried. */
interface CageState {
  ring: FaceLogRing;
  stdoutWrite: typeof process.stdout.write;
  stderrWrite: typeof process.stderr.write;
}

let cage: CageState | null = null;

/**
 * Starts holding everything this process writes to its terminal.
 *
 * Idempotent: a second start while caged changes nothing.
 */
export function consoleCage_start(): void {
  if (cage !== null) return;
  const ring: FaceLogRing = new FaceLogRing();
  const capture = ((chunk: string | Uint8Array): boolean => {
    ring.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
  cage = { ring, stdoutWrite: process.stdout.write, stderrWrite: process.stderr.write };
  process.stdout.write = capture;
  process.stderr.write = capture as typeof process.stderr.write;
}

/**
 * Restores the terminal's own writes and returns what was held.
 *
 * @returns The lines written while caged, oldest first; empty when nothing
 *   was written, or when no cage was in place.
 */
export function consoleCage_stop(): string[] {
  if (cage === null) return [];
  process.stdout.write = cage.stdoutWrite;
  process.stderr.write = cage.stderrWrite;
  const held: string[] = cage.ring.drain();
  cage = null;
  return held;
}

/** Whether the daemon's console output is currently being held. */
export function consoleCage_isActive(): boolean {
  return cage !== null;
}
