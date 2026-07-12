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
import { run_capture } from '@fnndsc/chili/run.js';
import { type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';

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
