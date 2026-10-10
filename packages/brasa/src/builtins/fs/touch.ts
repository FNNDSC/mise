/**
 * @file Builtin touch command.
 * Creates files, reported as a command envelope.
 */
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { ParsedArgs, commandArgs_process, optionsUnknown_refusal, path_resolve } from '../utils.js';
import { listingCache_get, vfsDispatcher_get } from '../../core/filesystem.js';
import { entry_at, entry_isFolder } from './entries.js';
import { errno_words, touch_render, vfs_fail, type VFSDispatcher, type VFSItem, type VfsOutcome } from '@fnndsc/fond';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

/** Outcome of one touch target, for the envelope model. */
export interface TouchOutcome {
  path: string;
  created: boolean;
}

/** Typed invocation options for touch. */
export interface TouchRunOptions {
  /** File paths to create or update, absolute or relative to the session cwd. */
  paths: string[];
  /** Literal content to write into the (single) target file. */
  contents?: string;
  /** Local file whose content is uploaded into the (single) target file. */
  contentsFromFile?: string;
}

/**
 * Reads the local file whose text a touch writes.
 *
 * @param localFilePath - The path on this host.
 * @returns Its text, or why it could not be read.
 */
function localFile_read(localFilePath: string): { text: string } | { reason: string } {
  try {
    if (!fs.existsSync(localFilePath)) return { reason: `Local file not found: ${localFilePath}` };
    return { text: fs.readFileSync(localFilePath, 'utf-8') };
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    return { reason: `Failed to read local file ${localFilePath}: ${msg}` };
  }
}

/**
 * Touches one file. With content it is written whole, replacing what was
 * there. Without, a file already there is left as it is (its content kept)
 * and a missing one is made empty. A projected file takes text only. A
 * missing parent folder is `No such file or directory`, as on a disk:
 * touch makes no folders (mkdir -p does).
 *
 * @param dispatcher - The session's filesystem.
 * @param targetPath - The absolute path.
 * @param content - The text to write, or none.
 * @returns Done, or why not.
 */
async function file_touch(dispatcher: VFSDispatcher, targetPath: string, content: string | undefined): Promise<VfsOutcome> {
  if (content === undefined) {
    if (dispatcher.path_isVirtual(targetPath)) {
      return vfs_fail('EROFS', `touch: ${targetPath}: a projected file takes text (--withContents)`);
    }
    const there: VFSItem | null = await entry_at(dispatcher, targetPath);
    if (entry_isFolder(there)) return vfs_fail('EISDIR', `Is a directory: a folder already holds ${targetPath}`);
    if (there !== null) return { ok: true, value: true };
  }
  const written: VfsOutcome = await dispatcher.write(targetPath, content ?? '');
  return written.ok || written.errno !== 'EISDIR' ? written : vfs_fail('EISDIR', `Is a directory: a folder already holds ${targetPath}`);
}

/**
 * Creates empty files or updates timestamps: the shared typed core behind
 * the parsed builtin and the typed API.
 *
 * @param runOptions - Target paths and optional content source.
 * @returns An envelope whose rendered text reports each created file and
 *   whose model lists per-target outcomes.
 */
export async function touch_run(runOptions: TouchRunOptions): Promise<CommandEnvelope> {
  const pathArgs: string[] = runOptions.paths;

  if (pathArgs.length === 0) {
    return envelope_error(
      '',
      undefined,
      `${chalk.red('Usage: touch [--withContents <string>] [--withContentsFromFile <file>] <file>')}\n`,
    );
  }

  // Empty text is text: `--withContents ''` writes an empty file.
  let content: string | undefined = runOptions.contents;
  if (runOptions.contentsFromFile) {
    const read: { text: string } | { reason: string } = localFile_read(runOptions.contentsFromFile);
    if ('reason' in read) {
      return envelope_error('', undefined, `${chalk.red(`Failed to write file: ${pathArgs[0]}`)}\n${chalk.gray(`  ${read.reason}`)}\n`);
    }
    content = read.text;
  }
  const wrote: boolean = content !== undefined;

  // Only the first path takes content.
  const filesToTouch: string[] = wrote ? [pathArgs[0]] : pathArgs;

  let rendered: string = '';
  let renderedErr: string = '';
  const outcomes: TouchOutcome[] = [];
  const dispatcher: VFSDispatcher = vfsDispatcher_get();

  for (const pathArg of filesToTouch) {
    try {
      const targetPath: string = await path_resolve(pathArg);
      const done: VfsOutcome = await file_touch(dispatcher, targetPath, content);

      if (done.ok) {
        rendered += `${touch_render(targetPath, true, wrote)}\n`;
        outcomes.push({ path: targetPath, created: true });
        listingCache_get().cache_invalidate?.(path.posix.dirname(targetPath));
      } else {
        renderedErr += `${chalk.red(`Failed to create file: ${targetPath}`)}\n`;
        renderedErr += `${chalk.gray(`  ${done.reason ?? errno_words(done.errno)}`)}\n`;
        outcomes.push({ path: targetPath, created: false });
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      renderedErr += `${chalk.red(`touch: ${pathArg}: ${msg}`)}\n`;
      outcomes.push({ path: pathArg, created: false });
    }
  }

  const anyFailed: boolean = outcomes.some((outcome: TouchOutcome): boolean => !outcome.created);
  const model: { kind: string; data: TouchOutcome[] } = { kind: 'fs.touch', data: outcomes };
  if (anyFailed) {
    const envelope: CommandEnvelope = envelope_error(rendered, undefined, renderedErr || undefined);
    envelope.model = model;
    return envelope;
  }
  return envelope_ok(rendered, model);
}

/**
 * Creates files from parsed command-line arguments.
 *
 * @param args - Command line arguments (paths and --withContents flags).
 * @returns The envelope from {@link touch_run}.
 */
export async function builtin_touch(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const refusal: string | null = optionsUnknown_refusal('touch', parsed, ['withContents', 'withContentsFromFile']);
  if (refusal !== null) return envelope_error('', undefined, `${chalk.red(refusal)}\n`);
  return touch_run({
    paths: parsed._ as string[],
    contents: parsed['withContents'] !== undefined ? String(parsed['withContents']) : undefined,
    contentsFromFile: parsed['withContentsFromFile'] !== undefined ? String(parsed['withContentsFromFile']) : undefined,
  });
}
