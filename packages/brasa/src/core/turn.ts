/**
 * @file A command's turn: the per-command state a command leaves behind when
 * it steps aside to wait on a person, and finds again when it resumes.
 *
 * The session runs one command at a time, but a command waiting on a
 * question gives up its turn (the host's lane), and other commands run to
 * completion before it resumes. Some state is module-level and belongs to
 * whichever command is running: the exit code it has set, a pipe's text or
 * listing not yet taken, the depth of a `play` manifest, a mute on the
 * recorder, the command Ctrl-C cancels. Each such part registers here how to
 * save, clear and restore itself; the host calls `turn_leave` as a command
 * steps aside (so the next command starts clean) and `turn_resume` when it
 * returns (so it finds its own state, not what ran in between).
 *
 * @module
 */
import { exitCode_read, exitCode_set } from './handlerRun.js';

/** One piece of per-command state, and how to hand it over. */
export interface TurnPart {
  /** A name for the part, for diagnostics. */
  name: string;
  /** Reads the part as the running command left it. */
  save: () => unknown;
  /** Puts the part to its idle value, for the next command. */
  clear: () => void;
  /** Puts back what `save` read. */
  restore: (saved: unknown) => void;
}

/** What a command left behind when it stepped aside. */
export interface TurnState {
  saved: Map<string, unknown>;
}

const parts: Map<string, TurnPart> = new Map();

/**
 * Registers a piece of per-command state. Registering a name again replaces
 * the part (a module loaded twice under test).
 *
 * @param part - The part.
 */
export function turnPart_register(part: TurnPart): void {
  parts.set(part.name, part);
}

/**
 * The running command steps aside: its state is saved and cleared.
 *
 * @returns What it left behind, for `turn_resume`.
 */
export function turn_leave(): TurnState {
  const saved: Map<string, unknown> = new Map();
  for (const part of parts.values()) {
    saved.set(part.name, part.save());
    part.clear();
  }
  return { saved };
}

/**
 * A command resumes: its state is put back, over whatever ran in between.
 *
 * @param state - What it left behind.
 */
export function turn_resume(state: TurnState): void {
  for (const part of parts.values()) {
    if (state.saved.has(part.name)) part.restore(state.saved.get(part.name));
  }
}

/**
 * Acts on a command that stepped aside, from outside its turn: its state is
 * put in place, the act runs, and the running command's state is put back.
 * All of it is synchronous, so nothing runs in between (a STOP pressed on a
 * command that waits aside).
 *
 * @param state - What the stepped-aside command left behind.
 * @param act - What to do with its state in place.
 * @returns Its state after the act, for its `turn_resume`.
 */
export function turn_within(state: TurnState, act: () => void): TurnState {
  const running: TurnState = turn_leave();
  turn_resume(state);
  try {
    act();
  } finally {
    const after: TurnState = turn_leave();
    turn_resume(running);
    state.saved = after.saved;
  }
  return state;
}

// The exit code: legacy handlers report failure by setting it, and the
// engine reads the change across a command. A command that stepped aside
// must not inherit another's failure, nor lose its own.
turnPart_register({
  name: 'exitCode',
  save: (): unknown => exitCode_read(),
  clear: (): void => { exitCode_set(undefined); },
  restore: (saved: unknown): void => { exitCode_set(typeof saved === 'number' ? saved : undefined); },
});
