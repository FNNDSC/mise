#!/usr/bin/env node
/**
 * @file The `trek` command: BSD trek on this terminal.
 *
 * Reads answers a line at a time from stdin (a terminal, or a file piped in),
 * writes the game to stdout, and keeps one saved game (`dump`, then a
 * `restart` length) in a file under the user's state directory, so a save
 * outlives the process. Scans wear glyphs and colour on a colour terminal;
 * `--classic`, a pipe or `NO_COLOR` gives the original look.
 *
 * @module
 */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { trek_play, trekArgs_parse, TREK_USAGE, type TrekArgs } from './trek.js';
import type { TrekDump } from './context.js';
import type { TrekTerminal } from './io.js';

/** What the command reads of its own package.json. */
interface PackageManifest {
  version?: string;
}

/** The package's version, read from its own package.json. */
function version_read(): string {
  try {
    const manifest: PackageManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return manifest.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Where the saved game lives: `$XDG_STATE_HOME/bsd-trek/trek.dump`, else the
 * platform's own place for an application's state.
 *
 * @param env - The environment.
 * @param platform - The operating system.
 * @param home - The user's home directory.
 * @returns The file's path.
 */
export function dumpPath_of(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  const base: string = env.XDG_STATE_HOME !== undefined && env.XDG_STATE_HOME !== ''
    ? env.XDG_STATE_HOME
    : platform === 'darwin' ? join(home, 'Library', 'Application Support')
    : platform === 'win32' ? (env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'))
    : join(home, '.local', 'state');
  return join(base, 'bsd-trek', 'trek.dump');
}

/**
 * A saved-game slot kept in a file: read when the game restarts, written
 * when it dumps. A file that cannot be read is no saved game.
 *
 * @param file - The file.
 * @returns The slot.
 */
export function dumpSlot_onFile(file: string): TrekDump {
  return {
    get saved(): object | null {
      try {
        return JSON.parse(readFileSync(file, 'utf8')) as object;
      } catch {
        return null;
      }
    },
    set saved(game: object | null) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(game));
    },
  };
}

/**
 * This terminal: stdout for the game, a line of stdin for each answer, end of
 * input (Ctrl-D, the end of a piped file) as EOF. Lines are queued as they
 * arrive, so a file piped in answers each question in turn instead of
 * arriving all at once before the first is asked.
 *
 * @param lines - The readline interface over stdin and stdout.
 * @returns The terminal.
 */
export function terminal_of(lines: Interface): TrekTerminal {
  const typed: string[] = [];
  let waiting: ((answer: string | null) => void) | null = null;
  let ended: boolean = false;
  lines.on('line', (line: string): void => {
    if (waiting !== null) { const answer = waiting; waiting = null; answer(line); } else typed.push(line);
  });
  lines.on('close', (): void => {
    ended = true;
    if (waiting !== null) { const answer = waiting; waiting = null; answer(null); }
  });
  return {
    write: (text: string): void => { process.stdout.write(text); },
    ask: (prompt: string): Promise<string | null> => {
      // On a terminal readline draws the prompt, so editing a line redraws it; a pipe just gets it written.
      if (lines.terminal) { lines.setPrompt(prompt); lines.prompt(); } else process.stdout.write(prompt);
      if (typed.length > 0) return Promise.resolve(typed.shift() as string);
      if (ended) return Promise.resolve(null);
      return new Promise((resolve: (answer: string | null) => void): void => { waiting = resolve; });
    },
    sleep: (seconds: number): Promise<void> => new Promise((resolve: () => void): void => { setTimeout(resolve, seconds * 1000); }),
  };
}

/** What `trek --help` says. */
function help_text(): string {
  return [
    'trek: the 1976 Berkeley trek game (BSD trek(6)).',
    '',
    `  ${TREK_USAGE}`,
    '',
    '  --classic   The original look: no glyphs, no colour.',
    '  -f          Faster messages (repeat for faster still); -s slow.',
    '  --seed N    A fixed galaxy: the same seed and answers replay the same game.',
    '  --help      This text.    --version   The version.',
    '',
    '  In the game, type "help" at the Command: prompt for every command.',
    `  A saved game (dump) lives in ${dumpPath_of()}.`,
    '',
  ].join('\n');
}

/**
 * Plays a game with the command's words.
 *
 * @param argv - The words after `trek`.
 * @returns The exit status.
 */
export async function trek_cli(argv: ReadonlyArray<string>): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(help_text()); return 0; }
  if (argv.includes('--version') || argv.includes('-V')) { process.stdout.write(`bsd-trek ${version_read()}\n`); return 0; }
  const asked: TrekArgs | { refusal: string } = trekArgs_parse(argv);
  if ('refusal' in asked) { process.stderr.write(`${asked.refusal}\n`); return 2; }
  const plain: boolean = asked.classic || (process.env.NO_COLOR ?? '') !== '' || chalk.level === 0 || !process.stdout.isTTY;
  const lines: Interface = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
  try {
    return await trek_play(terminal_of(lines), { seed: asked.seed, fast: asked.fast, trace: 0, styled: !plain }, dumpSlot_onFile(dumpPath_of()));
  } finally {
    lines.close();
  }
}

/** Whether this module is the program node was asked to run (through npm's bin link or not), not one imported by a test. */
function module_isMain(): boolean {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (module_isMain()) {
  trek_cli(process.argv.slice(2)).then((code: number): void => { process.exitCode = code; });
}
