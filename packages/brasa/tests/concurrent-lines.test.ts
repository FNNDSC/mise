/**
 * @file Two lines that run at once keep their own exit status and their
 * own pipe input (#1273, slice 1).
 *
 * A session will run a read beside a writer and background jobs beside
 * both. What a line's commands leave behind for it (whether it failed,
 * what was piped into its next segment) must be that line's alone.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import { exitCode_read, exitCode_set, exitScope_run } from '../src/core/handlerRun.js';
import { stdin_set, stdin_take, stdinScope_run } from '../src/builtins/games/stdin.js';
import { listingIn_set, listingIn_take, listingInScope_run } from '../src/core/listing.js';

/** Lets the other line run before this one goes on. */
const turn = (): Promise<void> => new Promise((resolve: () => void): void => { setTimeout(resolve, 5); });

afterEach((): void => {
  process.exitCode = 0;
  stdin_set(null);
  listingIn_set(null);
});

describe('a line\'s exit status', () => {
  it('is its own: one line failing does not mark a line running beside it', async () => {
    const failing = exitScope_run(async (): Promise<number> => { exitCode_set(1); await turn(); return exitCode_read(); });
    const passing = exitScope_run(async (): Promise<number> => { await turn(); exitCode_set(0); await turn(); return exitCode_read(); });
    expect(await Promise.all([failing, passing])).toEqual([1, 0]);
  });

  it('starts clear, whatever the process held before', async () => {
    process.exitCode = 3;
    expect(await exitScope_run(async (): Promise<number> => exitCode_read())).toBe(0);
  });

  it('becomes the process\'s when the line ends, so a one-shot chell exits with it', async () => {
    await exitScope_run(async (): Promise<void> => { exitCode_set(2); });
    expect(process.exitCode).toBe(2);
  });

  it('is the process\'s outside any line, as a test calling a handler reads it', () => {
    exitCode_set(1);
    expect(process.exitCode).toBe(1);
    expect(exitCode_read()).toBe(1);
  });
});

describe('a pipe segment\'s input', () => {
  it('is its own text: a segment running beside it never takes it', async () => {
    const a = stdinScope_run('from a\n', async (): Promise<string | null> => { await turn(); return stdin_take(); });
    const b = stdinScope_run('from b\n', async (): Promise<string | null> => stdin_take());
    expect(await Promise.all([a, b])).toEqual(['from a\n', 'from b\n']);
  });

  it('is its own listing, taken once', async () => {
    const taken = await listingInScope_run({ kind: 'fs.ls', data: [] }, async () => [listingIn_take(), listingIn_take()]);
    expect(taken).toEqual([{ kind: 'fs.ls', data: [] }, null]);
    expect(listingIn_take()).toBeNull();
  });
});
