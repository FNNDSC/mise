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
import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync, statSync } from 'fs';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { join } from 'path';
import type { Surface, SurfaceCapabilities, PromptRequest, LocalEditRequest, LocalEditResult } from '@fnndsc/brasa';
import { segment_pipeThrough, file_read } from '@fnndsc/brasa';
import type { FileDeliverRequest, FileDeliverResult } from '@fnndsc/menu';

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

  // `_writeToOutput` is readline's internal echo hook, absent from its
  // typings; replacing it is the supported folk technique for hidden input.
  const originalWrite: unknown = Reflect.get(rl, '_writeToOutput');
  Reflect.set(rl, '_writeToOutput', (_str: string): void => { /* suppress echo */ });

  return new Promise((resolve: (answer: string) => void) => {
    rl.question('', (answer: string) => {
      Reflect.set(rl, '_writeToOutput', originalWrite);
      process.stdout.write('\n');
      resolve(answer.trim());
    });
    // readline redraws when question() activates. Print the label afterward so
    // that redraw cannot immediately erase the password prompt.
    process.stdout.write(request.message);
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
 * Runs a host-shell command on this CLI machine with direct terminal access.
 *
 * @param command - The shell command without the leading `!`.
 * @returns The child process exit code.
 */
function shellCommand_run(command: string): Promise<number> {
  return new Promise((resolve: (exitCode: number) => void, reject: (error: Error) => void) => {
    const child: ChildProcess = spawn(command, {
      shell: true,
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', reject);
    child.once('close', (code: number | null) => resolve(code ?? 1));
  });
}

/**
 * How a surface obtains the bytes of a file it has been asked to deliver.
 *
 * @param path - The path in the session's namespace.
 * @returns The file's bytes.
 */
export type BytesFetch = (path: string) => Promise<Buffer>;

/**
 * Resolves where a delivered file should be written.
 *
 * A destination naming an existing directory receives the file under its
 * suggested name; anything else is taken as the filename itself. With no
 * destination the file lands in the working directory.
 *
 * @param destination - Where the operator asked for it, if they said.
 * @param filename - The suggested name.
 * @returns An absolute path to write.
 */
function destination_resolve(destination: string | undefined, filename: string): string {
  if (destination === undefined || destination.length === 0) {
    return path.resolve(filename);
  }
  const resolved: string = path.resolve(destination);
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    return path.join(resolved, filename);
  }
  return resolved;
}

/**
 * Writes a delivered file to this machine's disk.
 *
 * The destination is resolved here, on the surface's machine, which is the
 * whole point: the engine may be hosted anywhere, and a daemon must never
 * write to its own disk on an operator's behalf.
 *
 * @param request - What to deliver and where the operator asked for it.
 * @param bytes_fetch - How to obtain the file's bytes.
 * @returns The absolute path written and the byte count.
 * @throws {Error} When the bytes cannot be read or the write fails.
 */
async function fileDeliver_run(
  request: FileDeliverRequest,
  bytes_fetch: BytesFetch,
): Promise<FileDeliverResult> {
  const target: string = destination_resolve(request.destination, request.filename);
  const bytes: Buffer = await bytes_fetch(request.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  return { location: target, bytes: bytes.length };
}

/**
 * Creates the CLI host's surface.
 *
 * @param rl - The REPL's persistent readline interface, when running
 *   interactively. Omitted in execute and script modes, where each prompt
 *   uses a one-shot interface.
 * @param bytes_fetch - How this surface obtains a file's bytes. The default
 *   reads through the in-process engine, which is right for a local shell; a
 *   remote client supplies a fetch against its daemon's byte route, because
 *   its engine is on another machine.
 * @returns A surface backed by the local terminal.
 */
export function cliSurface_create(
  rl?: readline.Interface,
  bytes_fetch: BytesFetch | undefined = file_read,
): Surface {
  const capabilities: SurfaceCapabilities = {
    hiddenInput: true,
    localEdit: true,
    tty: !!process.stdout.isTTY,
    pipeSegments: true,
    shellCommands: true,
    fileDelivery: true,
    // A local shell hosts the engine in its own process, so a path the engine
    // resolves is a path the operator can open. A remote client supplies a
    // byte fetch precisely because that is not true for it.
    engineFilesystem: bytes_fetch === undefined || bytes_fetch === file_read,
    // Remote or not, a shell has a disk and directories. Asked for a folder it
    // should get a folder, not an archive of one.
    localFilesystem: true,
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
    shellCommand(command: string): Promise<number> {
      return shellCommand_run(command);
    },
    localEdit(request: LocalEditRequest): Promise<LocalEditResult> {
      return localEdit_run(request);
    },
    fileDeliver(request: FileDeliverRequest): Promise<FileDeliverResult> {
      return fileDeliver_run(request, bytes_fetch ?? file_read);
    },
  };
}
