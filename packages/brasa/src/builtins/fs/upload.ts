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
import { shellArguments_pathnameExpansion } from '../../lib/parser.js';
import { surface_get } from '../../core/surface.js';

/**
 * Asks the issuing surface to confirm replacement of an existing CFS target.
 *
 * @param message - Confirmation question prepared by the transfer command.
 * @returns Nothing when the surface accepts the operation.
 * @throws {Error} When the surface declines the operation.
 */
async function uploadConfirmation_request(message: string): Promise<void> {
  const answer: string = await surface_get().prompt({ message });
  if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') {
    throw new Error('Operation cancelled by user.');
  }
}

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
  // The local path is read by the ENGINE: under a daemon that is the daemon
  // host's disk, which belongs to nobody attending the session unless the
  // operator declared it theirs (--host-control=files). Without that, refuse
  // — as download already refuses to write there.
  if (!surface_get().capabilities.engineFilesystem) {
    process.exitCode = 1;
    return envelope_error('', undefined,
      `${chalk.red("upload: the daemon host's disk is nobody's; start the daemon with --host-control=files, or upload from a surface that can supply the bytes.")}\n`);
  }
  const localGlob: boolean = shellArguments_pathnameExpansion(args, 0);

  const targetRemote: string = await path_resolve(remotePath);

  try {
    const summary: UploadSummary = await chefs_upload_cmd(localPath, targetRemote, {
      expandLocalGlob: localGlob,
      confirm: uploadConfirmation_request,
      onNotice: (message: string, channel: 'status' | 'err'): void => {
        const sink = sink_get();
        if (channel === 'status') sink.status_write(`${message}\n`);
        else sink.err_write(`${message}\n`);
      },
      onProgress: event => sink_get().progress_write(event),
    });

    let rendered: string = '\n';
    if (summary.failedCount === 0) {
      rendered += `${chalk.green(`✓ Successfully uploaded ${summary.transferredCount} file(s)`)}\n`;
    } else {
      rendered += `${chalk.yellow(`⚠ Uploaded ${summary.transferredCount} file(s), ${summary.failedCount} failed`)}\n`;
    }
    rendered += `${chalk.gray(`  Total: ${bytes_format(summary.transferSize)} in ${summary.duration.toFixed(1)}s (${bytes_format(summary.speed)}/s)`)}\n`;

    // Invalidate cache for actual target directory where files were uploaded,
    // including nested listings: a directory re-upload replaces a whole tree,
    // and still-fresh entries below the target would serve the old contents.
    if (summary.transferredCount > 0) {
      const listCache = listCache_get();
      listCache.cache_invalidateTree(summary.actualTargetPath);
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
