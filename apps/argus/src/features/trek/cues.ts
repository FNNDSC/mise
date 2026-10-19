/**
 * @file What the bridge is heard to do: the cue for each event the game
 * reports, read from the state it shows and the words it prints, and the
 * beep each pill takes. Pills that only open, set or answer beep; pills
 * that do something are heard as the thing (ENGAGE is warp or impulse,
 * FIRE is the phaser or the torpedo, heard when the engine says it fired),
 * and never beep.
 *
 * Pure: tables and functions of readouts and lines. The voice that plays
 * them is the page's (`lcars/synth.ts`).
 *
 * @module
 */
import type { BridgeReadout, TrekQuestion } from './model.js';

/** The event cues the bank names. */
export type CueName =
  | 'press' | 'ack' | 'deny' | 'open' | 'close' | 'thinking' | 'sensor' | 'scanner'
  | 'phaser' | 'torpedo' | 'incoming' | 'hit' | 'explosion' | 'redalert' | 'yellowalert' | 'green'
  | 'dock' | 'warp' | 'impulse' | 'transporter' | 'destruct' | 'hail' | 'gameover'
  | 'nova' | 'supernova' | 'klingon-pass' | 'shield';

/** How the bridge is heard: a beep for a pill, a cue for an event. */
export interface BridgeVoice {
  /** A pill pressed: its beep, by its label. */
  pill: (label: string) => void;
  /** Something happened: the cue for it. */
  cue: (name: CueName) => void;
}

/** A voice that makes no sound, for a test or a page without audio. */
export const SILENT_VOICE: BridgeVoice = { pill: (): void => undefined, cue: (): void => undefined };

/** The engine's lines that are heard, most specific first. */
const LINE_CUES: ReadonlyArray<[RegExp, CueName]> = [
  [/Klingon attack:/, 'incoming'],
  [/^HIT: \d+ units/, 'hit'],
  [/CRITICAL HIT/, 'hit'],
  [/\*\*\* Klingon at \d+,\d+ destroyed \*\*\*/, 'explosion'],
  [/\*\*\*\*\* .* destroyed \*\*\*\*\*/, 'explosion'],
  [/Starbase at \d+,\d+ destroyed/, 'explosion'],
  [/Inhabited starsystem .* destroyed/, 'explosion'],
  [/^Torpedo track/, 'torpedo'],
  [/^Phaser bank \d+ fires:/, 'phaser'],
  [/^Phasers locked on target/, 'phaser'],
  [/^Starbase in \d+,\d+ responds/, 'hail'],
  [/^Password verified; self destruct sequence continues/, 'destruct'],
];

/**
 * The cues a line the engine printed is heard as.
 *
 * @param line - One line of the ship's log.
 * @returns The cues, in order; usually none.
 */
export function lineCues_of(line: string): CueName[] {
  const cues: CueName[] = [];
  for (const [pattern, cue] of LINE_CUES) {
    if (pattern.test(line) && !cues.includes(cue)) cues.push(cue);
  }
  return cues;
}

/**
 * The cues a change of state is heard as: the condition's alerts, a docking, a new quadrant's sensors.
 *
 * Kills are heard from the engine's own line, not counted here, so one kill is one explosion.
 *
 * @param before - The readout before the command; null at the first.
 * @param after - The readout after it.
 * @returns The cues, in order.
 */
export function stateCues_of(before: BridgeReadout | null, after: BridgeReadout): CueName[] {
  const cues: CueName[] = [];
  if (before !== null && before.condition.name !== after.condition.name) {
    switch (after.condition.name) {
      case 'RED': cues.push('redalert'); break;
      case 'YELLOW': cues.push('yellowalert'); break;
      case 'DOCKED': cues.push('dock'); break;
      case 'GREEN': default: cues.push('green'); break;
    }
  }
  const moved: boolean = before !== null && (before.position.quadrant.x !== after.position.quadrant.x || before.position.quadrant.y !== after.position.quadrant.y);
  if (moved) cues.push('sensor');
  return cues;
}

/**
 * The cue a command is heard as when it is sent, when it is one of the ship's grave acts or the computer thinking.
 *
 * @param commandId - The command's id.
 * @returns The cue, or null when the command's pill only beeps.
 */
export function commandCue_of(commandId: string): CueName | null {
  switch (commandId) {
    case 'abandon': return 'transporter';
    case 'destruct': return 'destruct';
    case 'computer': return 'thinking';
    default: return null;
  }
}

/**
 * The cue an answer is heard as, for the answers that do something: ENGAGE under warp or impulse.
 *
 * @param question - The question answered.
 * @param commandId - The command whose question it is, or null.
 * @returns The cue, or null when the answer only beeps.
 */
export function answerCue_of(question: TrekQuestion, commandId: string | null): CueName | null {
  if (question !== 'distance') return null;
  if (commandId === 'impulse') return 'impulse';
  if (commandId === 'move' || commandId === 'ram') return 'warp';
  return null;
}

/**
 * The bank's label for a pill, where the drawn label differs: the computer's MOVE, any burst angle, a commit.
 *
 * @param label - The label as drawn.
 * @param station - Where it was pressed: 'computer' for a request pill, 'commit' for a wheel or slider commit, 'choice' for an answer pill.
 * @returns The label the bank names.
 */
export function pillLabel_of(label: string, station: 'command' | 'computer' | 'commit' | 'choice' | 'view'): string {
  if (station === 'computer' && label === 'MOVE') return 'MOVE (COMPUTER)';
  if (station === 'commit') return /^SET COURSE/.test(label) ? 'SET COURSE' : 'SLIDER SET';
  if (station === 'choice' && /^\d+°$/.test(label)) return 'BURST ANGLE';
  if (/^CANCEL/.test(label)) return 'CANCEL';
  return label;
}
