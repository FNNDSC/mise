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
import { errorStack, Result, StackMessage, listCache_get } from '@fnndsc/cumin';

const BINARY_EXTENSIONS: Set<string> = new Set([
  '.dcm', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z',
  '.exe', '.dll', '.so', '.bin', '.mp3', '.mp4', '.avi', '.wav',
]);

/**
 * Opens a ChRIS file in the surface's local editor. On save, replaces the
 * original via delete + re-upload. No-ops if content is unchanged.
 *
 * @param args - [filePath, ...]
 */
export async function builtin_edit(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error(chalk.red('Usage: edit <file>'));
    process.exitCode = 1;
    return;
  }

  // Editing needs a surface that can open a local editor. A surface without
  // the capability (a headless or browser host) fails here with a clear
  // message instead of assuming a terminal exists.
  try {
    capability_require('localEdit', 'edit: this surface cannot open a local editor.');
  } catch (err: unknown) {
    const message: string = err instanceof CapabilityError ? err.message : String(err);
    console.error(chalk.red(message));
    process.exitCode = 1;
    return;
  }

  const target: string = await path_resolve(args[0]);
  const ext: string = extname(target).toLowerCase();

  if (BINARY_EXTENSIONS.has(ext)) {
    console.error(chalk.red(`edit: ${args[0]}: binary file (${ext}), cannot edit as text`));
    process.exitCode = 1;
    return;
  }

  const catResult: Result<string> = await files_cat(target);
  if (!catResult.ok) {
    const err: StackMessage | undefined = errorStack.stack_pop();
    console.error(chalk.red(`edit: ${err ? error_stripDebugPrefix(err.message) : 'Failed to read file'}`));
    process.exitCode = 1;
    return;
  }

  // Hand the content to the surface's editor.
  let edit: LocalEditResult;
  try {
    edit = await surface_get().localEdit({ content: catResult.value, extension: ext || '.txt' });
  } catch (err: unknown) {
    console.error(chalk.red(`edit: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return;
  }

  if (!edit.changed) {
    console.log(chalk.gray('(no changes)'));
    return;
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
      console.log(chalk.green(`Saved: ${args[0]}`));
    } else {
      const apiErr: StackMessage | undefined = errorStack.stack_pop();
      console.error(chalk.red(`edit: Save failed — ${result.error}`));
      if (apiErr) console.error(chalk.red(`  API error: ${error_stripDebugPrefix(apiErr.message)}`));
      console.error(chalk.yellow(`Your edits are preserved at: ${tmpPath}`));
      keepTmp = true;
      process.exitCode = 1;
    }
  } finally {
    if (!keepTmp && existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}
