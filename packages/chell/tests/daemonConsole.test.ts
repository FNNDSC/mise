/**
 * @file The daemon's terminal becomes its first surface once the engine
 * is ready, and stays the daemon's own between attachments.
 *
 * @module
 */
import { describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('@fnndsc/calypso', () => ({
  consoleCage_start: jest.fn(),
  consoleCage_stop: jest.fn((): string[] => []),
}));

import { EventEmitter } from 'node:events';

const { daemonConsole_run, surface_spawn, enter_await, CHELL_ENTRY } = await import('../src/core/daemonConsole.js');
type Deps = NonNullable<Parameters<typeof daemonConsole_run>[1]>;

const TARGET = { identity: 'me@https://cube.example.org/api/v1/', url: 'ws://pangea.tch.harvard.edu:42655', token: 'tok' };

/** Strips colour so assertions read the words. */
const ANSI: RegExp = /\[[0-9;]*m/g;

function deps_make(overrides: Partial<Deps> = {}): Deps & { lines: string[]; events: string[] } {
  const lines: string[] = [];
  const events: string[] = [];
  const deps: Deps & { lines: string[]; events: string[] } = {
    lines,
    events,
    attach: jest.fn((): { exited: Promise<number> } => {
      events.push('attach');
      return { exited: Promise.resolve(0) };
    }),
    cage_start: jest.fn((): void => { events.push('cage_start'); }),
    cage_stop: jest.fn((): string[] => { events.push('cage_stop'); return []; }),
    enter_wait: jest.fn(async (): Promise<boolean> => false),
    log: (line: string): void => { lines.push(line.replace(ANSI, '')); },
    ...overrides,
  };
  return deps;
}

describe('daemonConsole_run', () => {
  it('attaches a remote surface by address, with the daemon\'s writes caged for the duration', async () => {
    const deps = deps_make();
    await daemonConsole_run(TARGET, deps);
    expect(deps.attach).toHaveBeenCalledWith(TARGET);
    expect(deps.events).toEqual(['cage_start', 'attach', 'cage_stop']);
    expect(deps.lines[0]).toContain(`Console attached to ${TARGET.identity}`);
    expect(deps.lines[0]).toContain("'exit' detaches");
    expect(deps.lines[deps.lines.length - 1]).toContain('the daemon is still running');
  });

  it('hands back what the daemon wrote while the surface had the terminal, after the surface\'s last line', async () => {
    const deps = deps_make({
      cage_stop: jest.fn((): string[] => ['[ OK ]    Roster       1 feed moved while away', '[ OK ]    Topology     Ready']),
    });
    await daemonConsole_run(TARGET, deps);
    const flushed: number = deps.lines.findIndex((line: string): boolean => line.includes('While the console was attached'));
    expect(flushed).toBeGreaterThan(0);
    expect(deps.lines[flushed + 1]).toContain('Roster');
    expect(deps.lines[flushed + 2]).toContain('Topology');
    expect(deps.lines[flushed + 3]).toContain('Console detached');
  });

  it('says nothing about held output when there was none', async () => {
    const deps = deps_make();
    await daemonConsole_run(TARGET, deps);
    expect(deps.lines.some((line: string): boolean => line.includes('While the console was attached'))).toBe(false);
  });

  it('attaches again on Enter, and returns when the terminal\'s input ends', async () => {
    const answers: boolean[] = [true, true, false];
    const deps = deps_make({ enter_wait: jest.fn(async (): Promise<boolean> => answers.shift() ?? false) });
    await daemonConsole_run(TARGET, deps);
    expect(deps.attach).toHaveBeenCalledTimes(3);
  });

  it('releases the cage even when the surface fails to start', async () => {
    const deps = deps_make({
      attach: jest.fn((): { exited: Promise<number> } => { throw new Error('spawn ENOENT'); }),
    });
    await expect(daemonConsole_run(TARGET, deps)).rejects.toThrow('spawn ENOENT');
    expect(deps.cage_stop).toHaveBeenCalledTimes(1);
  });
});

describe('surface_spawn', () => {
  it('spawns chell itself as a remote surface on this terminal, attached by address', async () => {
    const child = new EventEmitter();
    const spawn = jest.fn((): EventEmitter => child);
    const running = surface_spawn(TARGET, spawn);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [CHELL_ENTRY, '--remote', TARGET.identity, '--attach', TARGET.url, '--token', TARGET.token],
      { stdio: 'inherit', env: expect.objectContaining({ CHELL_CONSOLE: '1' }) },
    );
    expect(CHELL_ENTRY.endsWith('/index.js')).toBe(true);
    child.emit('exit', 0);
    expect(await running.exited).toBe(0);
  });

  it('settles with the exit code, or with 1 when the surface cannot start at all', async () => {
    const bySignal = new EventEmitter();
    const signalled = surface_spawn(TARGET, jest.fn((): EventEmitter => bySignal));
    bySignal.emit('exit', null);
    expect(await signalled.exited).toBe(0);

    const failing = new EventEmitter();
    const failed = surface_spawn(TARGET, jest.fn((): EventEmitter => failing));
    failing.emit('error', new Error('spawn ENOENT'));
    expect(await failed.exited).toBe(1);
  });
});

describe('enter_await', () => {
  function input_make(): EventEmitter & { resume: jest.Mock; pause: jest.Mock } {
    return Object.assign(new EventEmitter(), { resume: jest.fn(), pause: jest.fn() });
  }

  it('resolves true on a line of input and lets the terminal go', async () => {
    const input = input_make();
    const waiting: Promise<boolean> = enter_await(input);
    expect(input.resume).toHaveBeenCalledTimes(1);
    input.emit('data', Buffer.from('\n'));
    expect(await waiting).toBe(true);
    expect(input.pause).toHaveBeenCalledTimes(1);
    expect(input.listenerCount('data')).toBe(0);
    expect(input.listenerCount('end')).toBe(0);
  });

  it('resolves false when the input ends, so the loop returns instead of waiting forever', async () => {
    const input = input_make();
    const waiting: Promise<boolean> = enter_await(input);
    input.emit('end');
    expect(await waiting).toBe(false);
    expect(input.listenerCount('data')).toBe(0);
  });
});
