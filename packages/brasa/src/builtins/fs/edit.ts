/**
 * @file Builtin edit command.
 * Fetches a ChRIS file, opens it in the surface's local editor, then
 * re-uploads on save. The editor mechanics live in the surface, so this
 * builtin knows nothing of processes or terminals — it fetches, hands the
 * content to the surface, and uploads the result.
 */
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, extname, posix } from 'path';
import chalk from 'chalk';
import { path_resolve, error_stripDebugPrefix } from '../utils.js';
import { surface_get, capability_require, CapabilityError, type LocalEditResult } from '../../core/surface.js';
import { files_cat } from '@fnndsc/chili/commands/fs/cat.js';
import { file_replaceContent, EditResult } from '@fnndsc/chili/commands/fs/edit.js';
import { errorStack, Result, StackMessage, listCache_get, type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { path_isEditable } from '@fnndsc/menu';


/** What `edit` says when the surface opened an editor that stays open. */
export const EDIT_OPENED_LINE: string = '(opened in the editor)';

/**
 * Opens a ChRIS file in the surface's local editor. On save, replaces the
 * original via delete + re-upload. No-ops if content is unchanged.
 *
 * @param args - [filePath, ...]
 * @returns An envelope carrying the edit outcome.
 */
export async function builtin_edit(args: string[]): Promise<CommandEnvelope> {
  if (args.length === 0) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('Usage: edit <file>')}\n`);
  }

  // Editing needs a surface that can open a local editor. A surface without
  // the capability (a headless or browser host) fails here with a clear
  // message instead of assuming a terminal exists.
  try {
    capability_require('localEdit', 'edit: this surface cannot open a local editor.');
  } catch (err: unknown) {
    const message: string = err instanceof CapabilityError ? err.message : String(err);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(message)}\n`);
  }

  const target: string = await path_resolve(args[0]);
  const ext: string = extname(target).toLowerCase();

  if (!path_isEditable(target)) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`edit: ${args[0]}: binary file (${ext}), cannot edit as text`)}\n`);
  }

  // A projection's file (a feed's note under /proc) is read and written
  // through the projection that owns it, never through CUBE's store.
  const { vfsDispatcher } = await import('@fnndsc/salsa');
  if (vfsDispatcher.path_isVirtual(target)) return projectedFile_edit(args[0], target, ext, vfsDispatcher);

  const catResult: Result<string> = await files_cat(target);
  if (!catResult.ok) {
    const err: StackMessage | undefined = errorStack.stack_pop();
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`edit: ${err ? error_stripDebugPrefix(err.message) : 'Failed to read file'}`)}\n`);
  }

  // Hand the content to the surface's editor.
  let edit: LocalEditResult;
  try {
    edit = await surface_get().localEdit({ content: catResult.value, extension: ext || '.txt', path: target });
  } catch (err: unknown) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`edit: ${err instanceof Error ? err.message : String(err)}`)}\n`);
  }

  // An editor that stays open (a browser pane) has taken the file; each save
  // made there runs as its own command line, so there is nothing to save here.
  if (edit.opened) {
    return envelope_ok(`${chalk.gray(EDIT_OPENED_LINE)}\n`);
  }
  if (!edit.changed) {
    return envelope_ok(`${chalk.gray('(no changes)')}\n`);
  }

  // Upload the edited content: write it to a temp file the replace command
  // reads, and preserve that file (reporting its path) if the save fails.
  const tmpPath: string = join(tmpdir(), `chell-edit-${Date.now()}${ext || '.txt'}`);
  let keepTmp: boolean = false;
  try {
    writeFileSync(tmpPath, edit.content, 'utf8');
    const result: EditResult = await file_replaceContent(target, tmpPath);
    listCache_get().cache_invalidate(posix.dirname(target));
    if (result.success) {
      return envelope_ok(`${chalk.green(`Saved: ${args[0]}`)}\n`);
    }
    const apiErr: StackMessage | undefined = errorStack.stack_pop();
    let renderedErr: string = `${chalk.red(`edit: Save failed — ${result.error}`)}\n`;
    if (apiErr) renderedErr += `${chalk.red(`  API error: ${error_stripDebugPrefix(apiErr.message)}`)}\n`;
    renderedErr += `${chalk.yellow(`Your edits are preserved at: ${tmpPath}`)}\n`;
    keepTmp = true;
    process.exitCode = 1;
    return envelope_error('', undefined, renderedErr);
  } finally {
    if (!keepTmp && existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}

/**
 * Edits a file a projection holds (a feed's note at
 * /proc/jobs/feed_N/note): read through the projection, handed to the
 * surface's editor, written back through the projection. A read-only
 * projected file is refused by the projection, in its own words.
 *
 * @param named - The path as the operator typed it.
 * @param target - The resolved path.
 * @param ext - Its extension, for the editor's highlighting.
 * @param dispatcher - The VFS dispatcher.
 * @returns An envelope carrying the outcome.
 */
async function projectedFile_edit(
  named: string,
  target: string,
  ext: string,
  dispatcher: { read: (path: string) => Promise<Result<string>>; write: (path: string, content: string) => Promise<boolean> },
): Promise<CommandEnvelope> {
  const read: Result<string> = await dispatcher.read(target);
  if (!read.ok) {
    const err: StackMessage | undefined = errorStack.stack_pop();
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`edit: ${err ? error_stripDebugPrefix(err.message) : `${named}: could not read`}`)}\n`);
  }
  let edit: LocalEditResult;
  try {
    edit = await surface_get().localEdit({ content: read.value, extension: ext || '.txt', path: target });
  } catch (err: unknown) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`edit: ${err instanceof Error ? err.message : String(err)}`)}\n`);
  }
  if (edit.opened) return envelope_ok(`${chalk.gray(EDIT_OPENED_LINE)}\n`);
  if (!edit.changed) return envelope_ok(`${chalk.gray('(no changes)')}\n`);
  if (await dispatcher.write(target, edit.content)) return envelope_ok(`${chalk.green(`Saved: ${named}`)}\n`);
  const err: StackMessage | undefined = errorStack.stack_pop();
  process.exitCode = 1;
  return envelope_error('', undefined, `${chalk.red(`edit: ${err ? error_stripDebugPrefix(err.message) : `${named}: could not save`}`)}\n`);
}
