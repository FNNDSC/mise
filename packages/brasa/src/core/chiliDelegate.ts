/**
 * @file Delegation to the chili command layer.
 *
 * Unknown commands and the pacs passthroughs hand off to chili. This lives in
 * its own leaf module so both the dispatcher and any builtins can call it
 * without importing each other — dispatch imports the builtins, so routing the
 * delegation through dispatch would close a cycle.
 *
 * @module
 */

import chalk from 'chalk';
import { run_capture, commandNames_get } from '@fnndsc/chili/run.js';
import { type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';

/** chili's top-level command names, resolved once and memoized (see {@link chiliCommand_exists}). */
let chiliCommandNames: Set<string> | null = null;

/**
 * Whether chili has a top-level command by this name. Used to decide whether an
 * unknown chell command is worth delegating: a name chili does not know (a typo,
 * a shell program like `fortune`) is reported as not-found rather than paying the
 * cost of a chili run that can only fail. The command set is resolved once — a
 * cheap, network-free registration pass — and cached.
 *
 * @param command - The command name to test.
 * @returns True if chili exposes a top-level command with this name.
 */
export async function chiliCommand_exists(command: string): Promise<boolean> {
  if (!chiliCommandNames) {
    chiliCommandNames = await commandNames_get();
  }
  return chiliCommandNames.has(command);
}

/**
 * The notice shown when an unknown chell command is handed off to chili.
 *
 * @param command - The command being delegated.
 * @returns The formatted notice line.
 */
export function chiliDelegationNotice_build(command: string): string {
  return `${chalk.yellow(`Unknown chell command '${command}' -- delegating to chili`)}\n`;
}

/**
 * Runs a chili command in-process and returns its output as an envelope.
 *
 * chili shares this process's cumin connection and context, so there is no node
 * subprocess to spawn and no per-command startup cost. Its output is captured
 * through chili's own output seam ({@link run_capture}) rather than a console
 * monkeypatch, so the rendered text and error stream travel in the envelope.
 *
 * @param command - The command to run (e.g., "pacsservers").
 * @param args - The arguments to pass to the command.
 * @returns An envelope carrying chili's captured output.
 */
export async function chiliCommand_run(command: string, args: string[]): Promise<CommandEnvelope> {
  try {
    const { out, err } = await run_capture([command, ...args]);
    const envelope: CommandEnvelope = envelope_ok(out);
    if (err.length > 0) {
      envelope.renderedErr = err;
    }
    return envelope;
  } catch (e: unknown) {
    const message: string = e instanceof Error ? e.message : String(e);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`chili command '${command}' failed: ${message}`)}\n`);
  }
}
