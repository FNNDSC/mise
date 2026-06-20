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

/**
 * Downloads a remote ChRIS file or directory to the local filesystem.
 *
 * @param args - [remotePath, localPath] plus optional -f/--force to overwrite.
 */
export async function builtin_download(args: string[]): Promise<void> {
  const force: boolean = args.includes('-f') || args.includes('--force');
  const cleanArgs: string[] = args.filter(arg => arg !== '-f' && arg !== '--force');

  if (cleanArgs.length < 2) {
    console.log(chalk.red('Usage: download <remote_path> <local_path> [-f|--force]'));
    return;
  }

  const remotePathArg: string = cleanArgs[0];
  const localPathArg: string = cleanArgs[1];

  const targetRemote: string = await path_resolve(remotePathArg);
  const targetLocal: string = path.resolve(localPathArg);

  try {
    const summary: DownloadSummary = await chefs_download_cmd(targetRemote, targetLocal, { force });

    console.log('');
    if (summary.failedCount === 0) {
      console.log(chalk.green(`✓ Successfully downloaded ${summary.transferredCount} file(s)`));
    } else {
      console.log(chalk.yellow(`⚠ Downloaded ${summary.transferredCount} file(s), ${summary.failedCount} failed`));
    }
    console.log(chalk.gray(`  Total: ${bytes_format(summary.transferSize)} in ${summary.duration.toFixed(1)}s (${bytes_format(summary.speed)}/s)`));
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`Download error: ${msg}`));
  }
}
