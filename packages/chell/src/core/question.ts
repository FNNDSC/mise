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

/**
 * Registers the REPL's readline question function.
 * Called once by REPL.start() before any commands run.
 *
 * @param fn - Wrapper around rl.question() on the active interface.
 */
export function repl_questionRegister(fn: (prompt: string) => Promise<string>): void {
  _questionFn = fn;
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
