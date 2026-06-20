/**
 * @file Shared question helper for builtins.
 *
 * Provides a single question() function that builtins use for interactive
 * prompts. The active REPL registers its readline interface here so input
 * is routed through one interface only — preventing leaked input when a
 * second readline interface would otherwise consume the same stdin.
 *
 * @module
 */

import * as readline from 'readline';

/** Registered by the REPL on startup. */
let _questionFn: ((prompt: string) => Promise<string>) | null = null;
let _questionHiddenFn: ((prompt: string) => Promise<string>) | null = null;

/**
 * Registers the REPL's readline question functions.
 * Called once by REPL.start() before any commands run.
 *
 * @param fn - Wrapper around rl.question() on the active interface.
 * @param hiddenFn - Raw-stdin reader that suppresses echo.
 */
export function repl_questionRegister(
  fn: (prompt: string) => Promise<string>,
  hiddenFn: (prompt: string) => Promise<string>
): void {
  _questionFn = fn;
  _questionHiddenFn = hiddenFn;
}

/**
 * Asks a question using the active REPL's readline interface so that
 * the answer is not double-consumed by a second interface on the same stdin.
 *
 * @param prompt - The question string to display.
 * @returns The trimmed user answer.
 */
export function repl_question(prompt: string): Promise<string> {
  if (_questionFn) {
    return _questionFn(prompt);
  }
  // Fallback: one-shot interface (pre-REPL startup / single-shot mode)
  return new Promise((resolve: (answer: string) => void) => {
    const rl: readline.Interface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer: string) => { rl.close(); resolve(answer.trim()); });
  });
}

/**
 * Asks for a password (no echo) using the REPL's raw-stdin reader.
 * Falls back to a muted readline interface outside the REPL.
 *
 * @param prompt - The prompt string to display.
 * @returns The trimmed password string.
 */
export function repl_questionHidden(prompt: string): Promise<string> {
  if (_questionHiddenFn) {
    return _questionHiddenFn(prompt);
  }
  // Fallback: muted one-shot readline (used outside the REPL, e.g. chili standalone)
  return new Promise((resolve: (answer: string) => void) => {
    const { Writable } = require('stream') as typeof import('stream');
    const muted: InstanceType<typeof Writable> = new Writable({
      write(_c: unknown, _e: unknown, cb: () => void) { cb(); }
    });
    const rl: readline.Interface = readline.createInterface({
      input: process.stdin,
      output: muted,
      terminal: true,
    });
    process.stdout.write(prompt);
    rl.question('', (answer: string) => {
      process.stdout.write('\n');
      rl.close();
      resolve(answer.trim());
    });
  });
}
