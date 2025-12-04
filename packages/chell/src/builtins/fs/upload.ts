/**
 * @file Builtin upload command.
 * Uploads files to ChRIS.
 */
import chalk from 'chalk';
import { path_resolve } from '../utils.js';
import { files_uploadWithProgress as chefs_upload_cmd, UploadSummary, bytes_format } from '@fnndsc/chili/commands/fs/upload.js';
import { listCache_get } from '@fnndsc/cumin';
import path from 'path';

/**
 * Uploads a local file or directory to ChRIS.
 *
 * @param args - [localPath, remotePath]
 */
export async function builtin_upload(args: string[]): Promise<void> {
  if (args.length < 2) {
    console.log(chalk.red('Usage: upload <local_path> <remote_path>'));
    return;
  }
  const localPath: string = args[0];
  const remotePath: string = args[1];

  const targetRemote: string = await path_resolve(remotePath);

  try {
    const summary: UploadSummary = await chefs_upload_cmd(localPath, targetRemote);

    console.log('');
    if (summary.failedCount === 0) {
      console.log(chalk.green(`✓ Successfully uploaded ${summary.transferredCount} file(s)`));
    } else {
      console.log(chalk.yellow(`⚠ Uploaded ${summary.transferredCount} file(s), ${summary.failedCount} failed`));
    }
    console.log(chalk.gray(`  Total: ${bytes_format(summary.transferSize)} in ${summary.duration.toFixed(1)}s (${bytes_format(summary.speed)}/s)`));

    // Invalidate cache for actual target directory where files were uploaded
    if (summary.transferredCount > 0) {
      const listCache = listCache_get();
      listCache.cache_invalidate(summary.actualTargetPath);
      // Also invalidate parent to refresh its listing
      listCache.cache_invalidate(targetRemote);
    }
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`Upload error: ${msg}`));
  }
}
