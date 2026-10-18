/**
 * @file The `trek` command: where a saved game lives, a save that outlives
 * the process, answers piped in one question at a time, and the words it
 * takes or refuses.
 */
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createInterface, type Interface } from 'node:readline';

const { dumpPath_of, dumpSlot_onFile, terminal_of, trek_cli } = await import('../src/cli.js');
const { trek_play } = await import('../src/trek.js');

const scratch: string = mkdtempSync(join(tmpdir(), 'bsd-trek-'));
afterEach(() => { jest.restoreAllMocks(); });

/** What the command wrote to stdout or stderr while it ran. */
async function captured(run: () => Promise<number>): Promise<{ code: number; out: string; err: string }> {
  let out: string = '';
  let err: string = '';
  jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => { out += String(chunk); return true; });
  jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => { err += String(chunk); return true; });
  const code: number = await run();
  return { code, out, err };
}

describe('where the saved game lives', () => {
  it('follows XDG_STATE_HOME, else the platform\'s place for state', () => {
    expect(dumpPath_of({ XDG_STATE_HOME: '/s' }, 'linux', '/home/u')).toBe('/s/bsd-trek/trek.dump');
    expect(dumpPath_of({}, 'linux', '/home/u')).toBe('/home/u/.local/state/bsd-trek/trek.dump');
    expect(dumpPath_of({}, 'darwin', '/Users/u')).toBe('/Users/u/Library/Application Support/bsd-trek/trek.dump');
    expect(dumpPath_of({ LOCALAPPDATA: 'C:\\L' }, 'win32', 'C:\\u')).toContain(join('bsd-trek', 'trek.dump'));
  });
});

describe('a saved game on file', () => {
  it('is nothing before a dump, and a restart in a later game reads the dump back', async () => {
    const file: string = join(scratch, 'state', 'bsd-trek', 'trek.dump');
    expect(dumpSlot_onFile(file).saved).toBeNull();
    const script = (answers: string[]): { write: (t: string) => void; ask: () => Promise<string | null>; sleep: () => Promise<void>; out: () => string } => {
      let out: string = '';
      return {
        write: (text: string): void => { out += text; },
        ask: async (): Promise<string | null> => answers.shift() ?? null,
        sleep: async (): Promise<void> => {},
        out: (): string => out,
      };
    };
    const first = script(['', 's', 'n', 'pw', 'dump', 'terminate', 'n']);
    await trek_play(first, { seed: 9, fast: 1, trace: 0, styled: false }, dumpSlot_onFile(file));
    expect(existsSync(file)).toBe(true);
    // A second process: a fresh slot on the same file.
    const second = script(['', 'restart', 'terminate', 'n']);
    await trek_play(second, { seed: 1, fast: 1, trace: 0, styled: false }, dumpSlot_onFile(file));
    expect(second.out()).not.toContain('cannot restart');
  });
});

describe('answers from stdin', () => {
  it('a file piped in answers each question in turn, then ends', async () => {
    const input: PassThrough = new PassThrough();
    const lines: Interface = createInterface({ input, terminal: false });
    const terminal = terminal_of(lines);
    jest.spyOn(process.stdout, 'write').mockImplementation((): boolean => true);
    input.end('first\nsecond\n');
    await new Promise((r) => setImmediate(r));
    expect(await terminal.ask('one? ')).toBe('first');
    expect(await terminal.ask('two? ')).toBe('second');
    expect(await terminal.ask('three? ')).toBeNull();
  });

  it('a question asked before its line arrives waits for it', async () => {
    const input: PassThrough = new PassThrough();
    const lines: Interface = createInterface({ input, terminal: false });
    const terminal = terminal_of(lines);
    jest.spyOn(process.stdout, 'write').mockImplementation((): boolean => true);
    const asked: Promise<string | null> = terminal.ask('now? ');
    input.write('later\n');
    expect(await asked).toBe('later');
    const ending: Promise<string | null> = terminal.ask('more? ');
    input.end();
    expect(await ending).toBeNull();
  });
});

describe('the command\'s words', () => {
  it('--help says how to play and where the save goes; --version names the package', async () => {
    const help = await captured(() => trek_cli(['--help']));
    expect(help.code).toBe(0);
    expect(help.out).toContain('usage: trek [--classic] [-f | -s] [--seed N]');
    expect(help.out).toContain(join('bsd-trek', 'trek.dump'));
    const version = await captured(() => trek_cli(['--version']));
    expect(version.out).toMatch(/^bsd-trek \d+\.\d+\.\d+\n$/);
  });

  it('refuses an unknown flag by name, with status 2', async () => {
    const refused = await captured(() => trek_cli(['--warp']));
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("trek: unknown option '--warp'");
  });
});

process.on('exit', (): void => { rmSync(scratch, { recursive: true, force: true }); });
