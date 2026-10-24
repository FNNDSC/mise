/**
 * @file A command's turn: what it leaves when it steps aside to wait on a
 * person, and finds again when it resumes. The next command starts clean;
 * the resumed one gets its own exit code, untaken pipe input, manifest depth,
 * recorder mute and cancellation back, whatever ran in between.
 */
import { describe, it, expect, afterEach } from '@jest/globals';

const { turn_leave, turn_resume, turn_within, turnPart_register } = await import('../src/core/turn.js');
const { stdin_set, stdin_take } = await import('../src/builtins/games/stdin.js');
const { listingIn_set, listingIn_take } = await import('../src/core/listing.js');
const { commandCancellation_run, commandCancellation_enable, commandCancellation_request, commandCancellation_active, commandCancellation_abort, commandCancellation_signalGet } = await import('../src/core/cancellation.js');

afterEach(() => {
  process.exitCode = undefined;
  stdin_set(null);
  listingIn_set(null);
});

describe('turn', () => {
  it('the exit code: the next command starts clean, the resumed one keeps its own', () => {
    process.exitCode = 1;
    const asker = turn_leave();
    expect(process.exitCode).toBeUndefined();
    process.exitCode = 3; // the command in between failed its own way
    turn_resume(asker);
    expect(process.exitCode).toBe(1);
    const clean = turn_leave();
    turn_resume(clean);
    expect(process.exitCode).toBe(1);
  });

  it('a pipe\'s untaken text and listing stay with their command', () => {
    stdin_set('from the pipe');
    listingIn_set({ kind: 'fs.ls', data: [] });
    const asker = turn_leave();
    expect(stdin_take()).toBeNull();
    expect(listingIn_take()).toBeNull();
    stdin_set('the other command\'s');
    turn_resume(asker);
    expect(stdin_take()).toBe('from the pipe');
    expect(listingIn_take()).toEqual({ kind: 'fs.ls', data: [] });
  });

  it('Ctrl-C reaches the command holding the turn, and the resumed one gets it back', async () => {
    let asker: ReturnType<typeof turn_leave> | null = null;
    let resumeAsker: () => void = (): void => undefined;
    const askerRun = commandCancellation_run(async (): Promise<boolean> => {
      commandCancellation_enable();
      expect(commandCancellation_active()).toBe(true);
      asker = turn_leave();
      await new Promise<void>((resolve) => { resumeAsker = resolve; });
      turn_resume(asker as ReturnType<typeof turn_leave>);
      return commandCancellation_request();
    });
    // Between: nobody holds the turn, so Ctrl-C cancels nothing.
    expect(commandCancellation_request()).toBe(false);
    resumeAsker();
    expect(await askerRun).toBe(true);
  });

  it('a STOP reaches a command waiting aside, and the one holding the turn keeps going', async () => {
    let aside: ReturnType<typeof turn_leave> | undefined;
    let resumeAside: () => void = (): void => {};
    const asideRun = commandCancellation_run(async () => {
      const signal = commandCancellation_signalGet();
      aside = turn_leave();
      await new Promise<void>((resolve) => { resumeAside = resolve; });
      turn_resume(aside as ReturnType<typeof turn_leave>);
      return signal?.aborted;
    });
    const holderRun = commandCancellation_run(async () => {
      const signal = commandCancellation_signalGet();
      turn_within(aside as ReturnType<typeof turn_leave>, (): void => { commandCancellation_abort(); });
      return signal?.aborted;
    });
    expect(await holderRun).toBe(false);
    resumeAside();
    expect(await asideRun).toBe(true);
  });

  it('a part registered again replaces the first, and an unknown saved part is ignored', () => {
    let value: number = 5;
    turnPart_register({ name: 'probe', save: () => value, clear: () => { value = 0; }, restore: (v) => { value = v as number; } });
    turnPart_register({ name: 'probe', save: () => value * 10, clear: () => { value = 0; }, restore: (v) => { value = (v as number) / 10; } });
    const left = turn_leave();
    expect(value).toBe(0);
    turn_resume(left);
    expect(value).toBe(5);
    turn_resume({ saved: new Map([['nosuch', 1]]) });
    expect(value).toBe(5);
  });
});
