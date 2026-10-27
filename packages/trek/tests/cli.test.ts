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

const { dumpPath_get, fileDumpSlot_make, stdioTerminal_make, cli_run } = await import('../src/cli.js');
const { trek_play } = await import('../src/trek.js');
type TrekTerminal = import('../src/io.js').TrekTerminal;

/** What a run of the command left: its exit status and what it wrote. */
interface CapturedOutput {
  /** The exit status. */
  code: number;
  /** What it wrote to stdout. */
  out: string;
  /** What it wrote to stderr. */
  err: string;
}

/** A terminal that answers from a script and keeps what it is shown. */
interface ScriptTerminal extends TrekTerminal {
  /** Everything written to the terminal so far. */
  transcript_get: () => string;
}

const scratch: string = mkdtempSync(join(tmpdir(), 'bsd-trek-'));
afterEach(() => { jest.restoreAllMocks(); });

/**
 * Captures what the command wrote to stdout or stderr while it ran.
 *
 * @param run - Runs the command and resolves to its exit status.
 * @returns The exit status and what was written to each stream.
 */
async function output_capture(run: () => Promise<number>): Promise<CapturedOutput> {
  let out: string = '';
  let err: string = '';
  jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => { out += String(chunk); return true; });
  jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => { err += String(chunk); return true; });
  const code: number = await run();
  return { code, out, err };
}

describe('where the saved game lives', () => {
  it('follows XDG_STATE_HOME, else the platform\'s place for state', () => {
    expect(dumpPath_get({ XDG_STATE_HOME: '/s' }, 'linux', '/home/u')).toBe('/s/bsd-trek/trek.dump');
    expect(dumpPath_get({}, 'linux', '/home/u')).toBe('/home/u/.local/state/bsd-trek/trek.dump');
    expect(dumpPath_get({}, 'darwin', '/Users/u')).toBe('/Users/u/Library/Application Support/bsd-trek/trek.dump');
    expect(dumpPath_get({ LOCALAPPDATA: 'C:\\L' }, 'win32', 'C:\\u')).toContain(join('bsd-trek', 'trek.dump'));
  });
});

describe('a saved game on file', () => {
  it('is nothing before a dump, and a restart in a later game reads the dump back', async () => {
    const file: string = join(scratch, 'state', 'bsd-trek', 'trek.dump');
    expect(fileDumpSlot_make(file).saved).toBeNull();
    /**
     * Makes a terminal that answers from a script and keeps what it is shown.
     *
     * @param answers - The answers, in order; EOF once they run out.
     * @returns The terminal, with a way to read its transcript.
     */
    const scriptTerminal_make: (answers: string[]) => ScriptTerminal = (answers: string[]): ScriptTerminal => {
      let out: string = '';
      return {
        text_write: (text: string): void => { out += text; },
        question_ask: async (): Promise<string | null> => answers.shift() ?? null,
        seconds_sleep: async (): Promise<void> => {},
        transcript_get: (): string => out,
      };
    };
    const first: ScriptTerminal = scriptTerminal_make(['', 's', 'n', 'pw', 'dump', 'terminate', 'n']);
    await trek_play(first, { seed: 9, fast: 1, trace: 0, styled: false }, fileDumpSlot_make(file));
    expect(existsSync(file)).toBe(true);
    // A second process: a fresh slot on the same file.
    const second: ScriptTerminal = scriptTerminal_make(['', 'restart', 'terminate', 'n']);
    await trek_play(second, { seed: 1, fast: 1, trace: 0, styled: false }, fileDumpSlot_make(file));
    expect(second.transcript_get()).not.toContain('cannot restart');
  });
});

describe('answers from stdin', () => {
  it('a file piped in answers each question in turn, then ends', async () => {
    const input: PassThrough = new PassThrough();
    const lines: Interface = createInterface({ input, terminal: false });
    const terminal: TrekTerminal = stdioTerminal_make(lines);
    jest.spyOn(process.stdout, 'write').mockImplementation((): boolean => true);
    input.end('first\nsecond\n');
    await new Promise<void>((r: () => void): void => { setImmediate(r); });
    expect(await terminal.question_ask('one? ')).toBe('first');
    expect(await terminal.question_ask('two? ')).toBe('second');
    expect(await terminal.question_ask('three? ')).toBeNull();
  });

  it('a question asked before its line arrives waits for it', async () => {
    const input: PassThrough = new PassThrough();
    const lines: Interface = createInterface({ input, terminal: false });
    const terminal: TrekTerminal = stdioTerminal_make(lines);
    jest.spyOn(process.stdout, 'write').mockImplementation((): boolean => true);
    const asked: Promise<string | null> = terminal.question_ask('now? ');
    input.write('later\n');
    expect(await asked).toBe('later');
    const ending: Promise<string | null> = terminal.question_ask('more? ');
    input.end();
    expect(await ending).toBeNull();
    // Asked again once input has ended (as after Ctrl-D): EOF, and no prompt drawn on the closed readline.
    expect(await terminal.question_ask('again? ')).toBeNull();
  });
});

describe('the command\'s words', () => {
  it('--help says how to play and where the save goes; --version names the package', async () => {
    const help: CapturedOutput = await output_capture((): Promise<number> => cli_run(['--help']));
    expect(help.code).toBe(0);
    expect(help.out).toContain('usage: trek [--classic] [-f | -s] [--seed N]');
    expect(help.out).toContain(join('bsd-trek', 'trek.dump'));
    const version: CapturedOutput = await output_capture((): Promise<number> => cli_run(['--version']));
    expect(version.out).toMatch(/^bsd-trek \d+\.\d+\.\d+\n$/);
  });

  it('--credits names the game\'s authors, the port, mise and ChRIS', async () => {
    const credits: CapturedOutput = await output_capture((): Promise<number> => cli_run(['--credits']));
    expect(credits.code).toBe(0);
    expect(credits.out).toContain('Eric P. Allman');
    expect(credits.out).toContain('Rudolph Pienaar');
    expect(credits.out).toContain('https://github.com/HARBOR-Medical-AI/mise');
  });

  it('refuses an unknown flag by name, with status 2', async () => {
    const refused: CapturedOutput = await output_capture((): Promise<number> => cli_run(['--warp']));
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("trek: unknown option '--warp'");
  });
});

process.on('exit', (): void => { rmSync(scratch, { recursive: true, force: true }); });
