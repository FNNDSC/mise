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
  /** The package's version. */
  version?: string;
}

/** Why the command's words were refused, as the argument parser says it. */
interface ArgsRefusal {
  /** The message for stderr. */
  refusal: string;
}

/** Hands a typed line (or null at end of input) to the question waiting for it. */
type AnswerResolve = (answer: string | null) => void;

/**
 * Reads the package's version from its own package.json.
 *
 * @returns The version, or `unknown` when the manifest cannot be read or names none.
 */
function version_read(): string {
  try {
    const manifest: PackageManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return manifest.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Names the file the saved game lives in.
 *
 * `$XDG_STATE_HOME/bsd-trek/trek.dump`, else the platform's own place for an application's state.
 *
 * @param env - The environment.
 * @param platform - The operating system.
 * @param home - The user's home directory.
 * @returns The file's path.
 */
export function dumpPath_get(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  const base: string = env.XDG_STATE_HOME !== undefined && env.XDG_STATE_HOME !== ''
    ? env.XDG_STATE_HOME
    : platform === 'darwin' ? join(home, 'Library', 'Application Support')
    : platform === 'win32' ? (env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'))
    : join(home, '.local', 'state');
  return join(base, 'bsd-trek', 'trek.dump');
}

/**
 * Makes a saved-game slot kept in a file.
 *
 * The file is read when the game restarts and written when it dumps. A file that cannot be read is no saved game.
 *
 * @param file - The file's path.
 * @returns The slot.
 */
export function fileDumpSlot_make(file: string): TrekDump {
  return {
    /**
     * Reads the saved game from the file.
     *
     * @returns The saved game, or null when the file cannot be read.
     */
    get saved(): object | null {
      try {
        return JSON.parse(readFileSync(file, 'utf8')) as object;
      } catch {
        return null;
      }
    },
    /**
     * Writes the saved game to the file, making its directory first.
     *
     * @param game - The game to save.
     */
    set saved(game: object | null) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(game));
    },
  };
}

/**
 * Makes the game's terminal over this process's stdin and stdout.
 *
 * stdout for the game, a line of stdin for each answer, end of input (Ctrl-D, the end of a piped file) as EOF. Lines are queued as they arrive, so a file piped in answers each question in turn instead of arriving all at once before the first is asked.
 *
 * @param lines - The readline interface over stdin and stdout.
 * @returns The terminal.
 */
export function stdioTerminal_make(lines: Interface): TrekTerminal {
  const typed: string[] = [];
  let waiting: AnswerResolve | null = null;
  let ended: boolean = false;
  lines.on('line', (line: string): void => {
    if (waiting !== null) { const answer: AnswerResolve = waiting; waiting = null; answer(line); } else typed.push(line);
  });
  lines.on('close', (): void => {
    ended = true;
    if (waiting !== null) { const answer: AnswerResolve = waiting; waiting = null; answer(null); }
  });
  return {
    /**
     * Writes game text to stdout.
     *
     * @param text - The text.
     */
    text_write: (text: string): void => { process.stdout.write(text); },
    /**
     * Asks for a line: shows the prompt, then answers with the next typed line.
     *
     * @param prompt - The prompt.
     * @returns The line, or null at end of input.
     */
    question_ask: (prompt: string): Promise<string | null> => {
      // On a terminal readline draws the prompt, so editing a line redraws it; a pipe just gets it written.
      if (lines.terminal) { lines.setPrompt(prompt); lines.prompt(); } else process.stdout.write(prompt);
      if (typed.length > 0) return Promise.resolve(typed.shift() as string);
      if (ended) return Promise.resolve(null);
      return new Promise((resolve: AnswerResolve): void => { waiting = resolve; });
    },
    /**
     * Waits a number of seconds.
     *
     * Port: stands in for C's sleep().
     *
     * @param seconds - How long to wait.
     */
    seconds_sleep: (seconds: number): Promise<void> => new Promise((resolve: () => void): void => { setTimeout(resolve, seconds * 1000); }),
  };
}

/**
 * Builds what `trek --help` says.
 *
 * @returns The help text, ending in a newline.
 */
function helpText_build(): string {
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
    `  A saved game (dump) lives in ${dumpPath_get()}.`,
    '',
  ].join('\n');
}

/**
 * Plays a game with the command's words.
 *
 * Answers `--help` and `--version` itself, refuses words it does not know, and otherwise plays on this terminal with the saved game kept in its file.
 *
 * @param argv - The words after `trek`.
 * @returns The exit status.
 */
export async function cli_run(argv: ReadonlyArray<string>): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(helpText_build()); return 0; }
  if (argv.includes('--version') || argv.includes('-V')) { process.stdout.write(`bsd-trek ${version_read()}\n`); return 0; }
  const asked: TrekArgs | ArgsRefusal = trekArgs_parse(argv);
  if ('refusal' in asked) { process.stderr.write(`${asked.refusal}\n`); return 2; }
  const plain: boolean = asked.classic || (process.env.NO_COLOR ?? '') !== '' || chalk.level === 0 || !process.stdout.isTTY;
  const lines: Interface = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
  try {
    return await trek_play(stdioTerminal_make(lines), { seed: asked.seed, fast: asked.fast, trace: 0, styled: !plain }, fileDumpSlot_make(dumpPath_get()));
  } finally {
    lines.close();
  }
}

/**
 * Checks whether this module is the program node was asked to run.
 *
 * True through npm's bin link or not; false when a test imports it.
 *
 * @returns True when this module is the program being run.
 */
function module_checkIsMain(): boolean {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (module_checkIsMain()) {
  cli_run(process.argv.slice(2)).then((code: number): void => { process.exitCode = code; });
}
