/**
 * @file The harness answers the engine the way a typist would: one open
 * question at a time, the setup questions by itself, the rest from the
 * bridge; abandoning is an answer the engine reads as end of input.
 */
import { describe, it, expect } from '@jest/globals';
import { TrekHarness, type OpenQuestion } from '../../src/features/trek/harness.js';
import { BRIDGE_COMMANDS, type BridgeCommand } from '../../src/features/trek/model.js';

/** A harness with every report recorded. */
function harness_make(): { harness: TrekHarness; questions: Array<OpenQuestion | null>; text: string[]; states: unknown[]; ended: number[] } {
  const questions: Array<OpenQuestion | null> = [];
  const text: string[] = [];
  const states: unknown[] = [];
  const ended: number[] = [];
  const harness: TrekHarness = new TrekHarness({
    question_changed: (open: OpenQuestion | null): void => { questions.push(open); },
    text_written: (t: string): void => { text.push(t); },
    state_shown: (state: unknown): void => { states.push(state); },
    ended: (code: number): void => { ended.push(code); },
  });
  return { harness, questions, text, states, ended };
}

const MOVE: BridgeCommand = BRIDGE_COMMANDS.find((c: BridgeCommand): boolean => c.id === 'move') as BridgeCommand;

describe('the harness', () => {
  it('answers press-return and the password questions itself, with one password throughout', async () => {
    const { harness, questions } = harness_make();
    expect(await harness.ask('Press return to continue: ')).toBe('');
    const password: string | null = await harness.ask('Enter a password: ');
    expect(password).toMatch(/^argus\d{4}$/);
    expect(await harness.ask('Enter password verification: ')).toBe(password);
    expect(questions).toEqual([]);
  });

  it('holds the Command: prompt open, sends a command, and knows whose question follows', async () => {
    const { harness, questions } = harness_make();
    const command: Promise<string | null> = harness.ask('\nCommand: ');
    expect(harness.question_get()?.question).toBe('command');
    expect(harness.command_send(MOVE)).toBe(true);
    expect(await command).toBe('m');
    const course: Promise<string | null> = harness.ask('Course: ');
    expect(harness.question_get()).toMatchObject({ question: 'course', command: MOVE });
    expect(harness.answer('90')).toBe(true);
    expect(await course).toBe('90');
    expect(harness.question_get()).toBeNull();
    // the reports: command open, closed, course open, closed
    expect(questions.map((q: OpenQuestion | null): string | null => q?.question ?? null)).toEqual(['command', null, 'course', null]);
    // back at the Command: prompt the last command is forgotten
    void harness.ask('\nCommand: ');
    expect(harness.question_get()?.command).toBeNull();
  });

  it('refuses a command when the engine is not at the Command: prompt, and an answer when nothing is open', () => {
    const { harness } = harness_make();
    expect(harness.answer('x')).toBe(false);
    void harness.ask('Course: ');
    expect(harness.command_send(MOVE)).toBe(false);
  });

  it('abandons the open question with null, which the engine reads as end of input', async () => {
    const { harness } = harness_make();
    const asked: Promise<string | null> = harness.ask('\nCommand: ');
    expect(harness.abandon()).toBe(true);
    expect(await asked).toBeNull();
    expect(harness.abandon()).toBe(false);
  });

  it('passes text and the state through, and ends once', () => {
    const { harness, text, states, ended } = harness_make();
    harness.text_take('Klingon at 1,7 fires 274 units\n');
    harness.event_take('games.trek.state', { Ship: { energy: 1 } });
    harness.event_take('something.else', { x: 1 });
    harness.end(0);
    harness.end(1);
    expect(text).toEqual(['Klingon at 1,7 fires 274 units\n']);
    expect(states).toEqual([{ Ship: { energy: 1 } }]);
    expect(ended).toEqual([0]);
    expect(harness.ended_is()).toBe(true);
  });
});
