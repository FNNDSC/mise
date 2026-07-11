/**
 * @file Surface command interception.
 *
 * A few commands are purely frontend-local: they configure how *this* terminal
 * renders and produce no engine output. `prompt` (theme selection) is the
 * canonical case — a remote client themes its own prompt, so the engine, which
 * may be a shared daemon, must never own it. The CLI surface handles these
 * itself and delegates everything else to the engine.
 *
 * @module
 */

import type { CommandEnvelope } from '@fnndsc/cumin';
import type { BrasaEngine } from '@fnndsc/brasa';
import { builtin_prompt } from '../builtins/sys/prompt.js';

/** Commands the CLI surface runs locally and never forwards to the engine. */
const SURFACE_COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  prompt: builtin_prompt,
};

/**
 * Runs a command line, intercepting surface-local commands before the engine.
 *
 * @param engine - The engine that executes non-surface commands.
 * @param line - The raw command line.
 * @returns The engine's envelopes, or an empty list for a surface command.
 */
export async function surfaceLine_execute(engine: BrasaEngine, line: string): Promise<CommandEnvelope[]> {
  const tokens: string[] = line.trim().split(/\s+/);
  const handler: ((args: string[]) => Promise<void>) | undefined = SURFACE_COMMANDS[tokens[0]];
  if (handler !== undefined) {
    await handler(tokens.slice(1));
    return [];
  }
  return engine.line_execute(line);
}
