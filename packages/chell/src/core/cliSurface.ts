/**
 * @file The CLI host's surface: interaction backed by readline and the local
 * terminal.
 *
 * This is the concrete {@link Surface} the command-line host installs. It
 * declares the full local capability set (hidden input, local editing, and a
 * tty when stdout is one) and backs prompting with readline. Two flavors of
 * prompt exist so the single-readline discipline is preserved: when the REPL
 * is running it passes its own persistent interface, and hidden input is read
 * by suppressing that interface's echo rather than opening a second one on the
 * same stdin; outside the REPL (execute and script modes) a one-shot interface
 * is created per prompt, matching the shell's historical fallback exactly.
 *
 * @module
 */
import * as readline from 'readline';
import { Writable } from 'stream';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Surface, SurfaceCapabilities, PromptRequest, LocalEditRequest, LocalEditResult } from './surface.js';
import { segment_pipeThrough } from '../lib/pipe.js';

/** Minimal view of readline's internal echo hook, used to suppress echo. */
interface ReadlineEchoInternal {
  _writeToOutput(str: string): void;
}

/**
 * Prompts on a persistent readline interface (the REPL's), suppressing echo
 * for hidden input by intercepting the interface's own output hook. This
 * keeps a single readline interface on stdin — no raw mode, no second
 * interface, no keystrokes leaking back to the command loop.
 *
 * @param rl - The REPL's readline interface.
 * @param request - The prompt message and whether to hide input.
 * @returns The entered line, trimmed.
 */
function persistentPrompt_ask(rl: readline.Interface, request: PromptRequest): Promise<string> {
  if (!request.hidden) {
    return new Promise((resolve: (answer: string) => void) => {
      rl.question(request.message, (answer: string) => resolve(answer.trim()));
    });
  }

  const rlInternal: ReadlineEchoInternal = rl as unknown as ReadlineEchoInternal;
  const originalWrite: (str: string) => void = rlInternal._writeToOutput.bind(rl);
  rlInternal._writeToOutput = (_str: string): void => { /* suppress echo */ };

  process.stdout.write(request.message);
  return new Promise((resolve: (answer: string) => void) => {
    rl.question('', (answer: string) => {
      rlInternal._writeToOutput = originalWrite;
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

/**
 * Prompts on a one-shot readline interface created for this call, used
 * outside the REPL (execute and script modes). Hidden input is read through
 * a muted output stream so the entry is not echoed.
 *
 * @param request - The prompt message and whether to hide input.
 * @returns The entered line, trimmed.
 */
function oneShotPrompt_ask(request: PromptRequest): Promise<string> {
  if (!request.hidden) {
    return new Promise((resolve: (answer: string) => void) => {
      const rl: readline.Interface = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(request.message, (answer: string) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  return new Promise((resolve: (answer: string) => void) => {
    const muted: Writable = new Writable({
      write(_chunk: unknown, _encoding: unknown, callback: () => void): void {
        callback();
      },
    });
    const rl: readline.Interface = readline.createInterface({
      input: process.stdin,
      output: muted,
      terminal: true,
    });
    process.stdout.write(request.message);
    rl.question('', (answer: string) => {
      process.stdout.write('\n');
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Opens content in the local `$EDITOR` and returns the edited result. Writes
 * the content to a temp file, launches the editor against it, reads it back,
 * and removes the temp file — the whole editor lifecycle is the surface's
 * business, so builtins never touch a process or a terminal.
 *
 * @param request - The content to edit and an optional extension.
 * @returns The edited content and whether it changed.
 * @throws {Error} When the editor fails to launch.
 */
function localEdit_run(request: LocalEditRequest): Promise<LocalEditResult> {
  const ext: string = request.extension && request.extension.length > 0 ? request.extension : '.txt';
  const tmpPath: string = join(tmpdir(), `chell-edit-${Date.now()}${ext}`);
  try {
    writeFileSync(tmpPath, request.content, 'utf8');
    const editor: string = process.env.EDITOR || process.env.VISUAL || 'vi';
    const spawn: SpawnSyncReturns<Buffer> = spawnSync(editor, [tmpPath], { stdio: 'inherit' });
    if (spawn.error) {
      throw new Error(`failed to launch '${editor}': ${spawn.error.message}`);
    }
    const edited: string = readFileSync(tmpPath, 'utf8');
    return Promise.resolve({ content: edited, changed: edited !== request.content });
  } finally {
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}

/**
 * Creates the CLI host's surface.
 *
 * @param rl - The REPL's persistent readline interface, when running
 *   interactively. Omitted in execute and script modes, where each prompt
 *   uses a one-shot interface.
 * @returns A surface backed by the local terminal.
 */
export function cliSurface_create(rl?: readline.Interface): Surface {
  const capabilities: SurfaceCapabilities = {
    hiddenInput: true,
    localEdit: true,
    tty: !!process.stdout.isTTY,
    pipeSegments: true,
  };

  return {
    capabilities,
    prompt(request: PromptRequest): Promise<string> {
      return rl ? persistentPrompt_ask(rl, request) : oneShotPrompt_ask(request);
    },
    pipeSegment(command: string, input: Buffer): Promise<Buffer> {
      // The local CLI runs pipe segments in-process, exactly as before.
      return segment_pipeThrough(command, input);
    },
    localEdit(request: LocalEditRequest): Promise<LocalEditResult> {
      return localEdit_run(request);
    },
  };
}
