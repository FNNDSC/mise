/**
 * @file Builtin download command.
 * Downloads files from ChRIS to the local filesystem with progress.
 */
import chalk from 'chalk';
import path from 'path';
import { path_resolve } from '../utils.js';
import {
  files_downloadWithProgress as chefs_download_cmd,
  DownloadSummary,
  bytes_format
} from '@fnndsc/chili/commands/fs/download.js';
import { sink_get } from '../../core/sink.js';
import { type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';

/**
 * Downloads a remote ChRIS file or directory to the local filesystem.
 *
 * @param args - [remotePath, localPath] plus optional -f/--force to overwrite.
 * @returns An envelope carrying the download summary.
 */
export async function builtin_download(args: string[]): Promise<CommandEnvelope> {
  const force: boolean = args.includes('-f') || args.includes('--force');
  const cleanArgs: string[] = args.filter(arg => arg !== '-f' && arg !== '--force');

  if (cleanArgs.length < 2) {
    return envelope_ok(`${chalk.red('Usage: download <remote_path> <local_path> [-f|--force]')}\n`);
  }

  const remotePathArg: string = cleanArgs[0];
  const localPathArg: string = cleanArgs[1];

  const targetRemote: string = await path_resolve(remotePathArg);
  const targetLocal: string = path.resolve(localPathArg);

  try {
    const summary: DownloadSummary = await chefs_download_cmd(targetRemote, targetLocal, {
      force,
      onProgress: event => sink_get().progress_write(event),
    });

    let rendered: string = '\n';
    if (summary.failedCount === 0) {
      rendered += `${chalk.green(`✓ Successfully downloaded ${summary.transferredCount} file(s)`)}\n`;
    } else {
      rendered += `${chalk.yellow(`⚠ Downloaded ${summary.transferredCount} file(s), ${summary.failedCount} failed`)}\n`;
    }
    rendered += `${chalk.gray(`  Total: ${bytes_format(summary.transferSize)} in ${summary.duration.toFixed(1)}s (${bytes_format(summary.speed)}/s)`)}\n`;
    return envelope_ok(rendered);
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`Download error: ${msg}`)}\n`);
  }
}
