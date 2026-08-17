/**
 * @file Builtin download command.
 * Downloads files from ChRIS to the local filesystem with progress.
 */
import path from 'path';

import chalk from 'chalk';

import {
  files_downloadWithProgress as chefs_download_cmd,
  files_downloadManyWithProgress as chefs_downloadMany_cmd,
  type DownloadOptions,
  type DownloadProgressEvent,
  type DownloadSummary,
  bytes_format
} from '@fnndsc/chili/commands/fs/download.js';
import { type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { sink_get } from '../../core/sink.js';
import { shellArguments_pathnameExpanded } from '../../lib/parser.js';
import { path_resolve } from '../utils.js';

/**
 * Downloads a remote ChRIS file or directory to the local filesystem.
 *
 * @param args - [remotePathOrGlob, localPath] plus optional -f/--force to overwrite.
 * @returns An envelope carrying the download summary.
 */
export async function builtin_download(args: string[]): Promise<CommandEnvelope> {
  const force: boolean = args.includes('-f') || args.includes('--force');
  const positionalIndexes: number[] = args.reduce((indexes: number[], arg: string, index: number): number[] => {
    if (arg !== '-f' && arg !== '--force') indexes.push(index);
    return indexes;
  }, []);
  const cleanArgs: string[] = positionalIndexes.map((index: number): string => args[index]);

  if (cleanArgs.length < 2) {
    return envelope_ok(`${chalk.red('Usage: download <remote_path_or_glob> <local_path> [-f|--force]')}\n`);
  }

  const localPathArg: string = cleanArgs[cleanArgs.length - 1];
  const sourceArgs: string[] = cleanArgs.slice(0, -1);
  const sourceWasExpanded: boolean = positionalIndexes
    .slice(0, -1)
    .some((index: number): boolean => shellArguments_pathnameExpanded(args, index));

  const targetLocal: string = path.resolve(localPathArg);

  try {
    const progress: DownloadOptions = {
      force,
      onProgress: (event: DownloadProgressEvent): void => sink_get().progress_write(event),
    };
    let summary: DownloadSummary;
    if (!sourceWasExpanded) {
      const targetRemote: string = await path_resolve(sourceArgs[0]);
      summary = await chefs_download_cmd(targetRemote, targetLocal, progress);
    } else {
      const sources: string[] = await Promise.all(sourceArgs.map(path_resolve));
      summary = await chefs_downloadMany_cmd(sources, targetLocal, progress);
    }

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
