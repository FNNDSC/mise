/**
 * @file Builtin upload command.
 * Uploads files to ChRIS.
 */
import chalk from 'chalk';
import { path_resolve } from '../utils.js';
import { files_uploadWithProgress as chefs_upload_cmd, UploadSummary, bytes_format } from '@fnndsc/chili/commands/fs/upload.js';
import { listCache_get, type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import path from 'path';
import { sink_get } from '../../core/sink.js';

/**
 * Uploads a local file or directory to ChRIS.
 *
 * @param args - [localPath, remotePath]
 * @returns An envelope carrying the upload summary.
 */
export async function builtin_upload(args: string[]): Promise<CommandEnvelope> {
  if (args.length < 2) {
    return envelope_ok(`${chalk.red('Usage: upload <local_path> <remote_path>')}\n`);
  }
  const localPath: string = args[0];
  const remotePath: string = args[1];

  const targetRemote: string = await path_resolve(remotePath);

  try {
    const summary: UploadSummary = await chefs_upload_cmd(localPath, targetRemote, {
      onProgress: event => sink_get().progress_write(event),
    });

    let rendered: string = '\n';
    if (summary.failedCount === 0) {
      rendered += `${chalk.green(`✓ Successfully uploaded ${summary.transferredCount} file(s)`)}\n`;
    } else {
      rendered += `${chalk.yellow(`⚠ Uploaded ${summary.transferredCount} file(s), ${summary.failedCount} failed`)}\n`;
    }
    rendered += `${chalk.gray(`  Total: ${bytes_format(summary.transferSize)} in ${summary.duration.toFixed(1)}s (${bytes_format(summary.speed)}/s)`)}\n`;

    // Invalidate cache for actual target directory where files were uploaded
    if (summary.transferredCount > 0) {
      const listCache = listCache_get();
      listCache.cache_invalidate(summary.actualTargetPath);
      // Also invalidate parent to refresh its listing
      listCache.cache_invalidate(targetRemote);
    }
    return envelope_ok(rendered);
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`Upload error: ${msg}`)}\n`);
  }
}
