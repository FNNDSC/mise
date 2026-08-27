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
import { type CommandEnvelope, envelope_ok, envelope_error, errorStack } from '@fnndsc/cumin';
import { sink_get } from '../../core/sink.js';
import { shellArguments_pathnameExpanded } from '../../lib/parser.js';
import { path_resolve } from '../utils.js';
import { surface_get, type Surface } from '../../core/surface.js';
import { files_path_isDirectory } from '@fnndsc/salsa';
import { directory_archive, type ArchiveResult } from './archive.js';
import type { FileDeliverResult } from '@fnndsc/menu';

/**
 * Asks the issuing surface to confirm a local download overwrite or merge.
 *
 * @param message - Confirmation question prepared by the transfer command.
 * @returns Nothing when the surface accepts the operation.
 * @throws {Error} When the surface declines the operation.
 */
async function downloadConfirmation_request(message: string): Promise<void> {
  const answer: string = await surface_get().prompt({ message });
  if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') {
    throw new Error('Operation cancelled by user.');
  }
}

/**
 * Hands each requested file to the surface, for a session whose engine runs
 * somewhere its operator is not.
 *
 * Only the request travels: the surface fetches the bytes itself, through
 * whichever route suits it. Multiple sources become multiple deliveries, since
 * a surface with no filesystem — a browser — has no directory to fill.
 *
 * @param surface - The surface running this command.
 * @param sourceArgs - The requested source paths, before resolution.
 * @param destination - Where the operator asked for it. A surface with a
 *   filesystem treats an existing directory as a place to fill and anything
 *   else as the filename; a surface without one ignores it.
 * @returns An envelope summarising where the files landed.
 */
async function surfaceDownload_run(
  surface: Surface,
  sourceArgs: string[],
  destination: string,
): Promise<CommandEnvelope> {
  if (!surface.capabilities.fileDelivery) {
    process.exitCode = 1;
    return envelope_error('', undefined,
      `${chalk.red('download: this surface cannot receive a file, and the engine will not write to its own host.')}\n`);
  }

  const sources: string[] = await Promise.all(sourceArgs.map(path_resolve));

  // A directory has no bytes to hand over. The local path walks it and writes
  // each file as it arrives, which a surface with no filesystem cannot do —
  // several hundred DICOM instances would be several hundred saves. So a
  // directory is archived into a single CUBE file first, and that file is what
  // gets delivered. See issue #233 for why this is a workaround.
  const targets: { path: string; filename: string; size?: number }[] = [];
  for (const source of sources) {
    if (await files_path_isDirectory(source)) {
      const archived: ArchiveResult | null = await directory_archive(source);
      if (!archived) {
        process.exitCode = 1;
        const reasons: string = errorStack.stack_getAll?.()
          .map((entry: unknown): string =>
            typeof entry === 'string' ? entry : ((entry as { message?: string }).message ?? String(entry)))
          .join('\n  ') ?? '';
        return envelope_error('', undefined,
          `${chalk.red(`download: could not archive ${source}.`)}\n${reasons ? `  ${chalk.red(reasons)}\n` : ''}`);
      }
      targets.push(archived);
    } else {
      targets.push({ path: source, filename: source.split('/').filter(Boolean).pop() ?? 'download' });
    }
  }

  const delivered: string[] = [];
  const failed: string[] = [];

  for (const target of targets) {
    const filename: string = target.filename;
    try {
      const result: FileDeliverResult = await surface.fileDeliver({
        path: target.path,
        filename,
        destination,
        ...(target.size !== undefined ? { size: target.size } : {}),
      });
      delivered.push(`${chalk.gray(`  ${filename} → ${result.location}`)} ${chalk.gray(`(${bytes_format(result.bytes)})`)}`);
    } catch (error: unknown) {
      const reason: string = error instanceof Error ? error.message : String(error);
      failed.push(`${chalk.red(`  ${filename}: ${reason}`)}`);
    }
  }

  let rendered: string = '\n';
  if (failed.length === 0) {
    rendered += `${chalk.green(`✓ Delivered ${delivered.length} file(s)`)}\n`;
  } else {
    rendered += `${chalk.yellow(`⚠ Delivered ${delivered.length} file(s), ${failed.length} failed`)}\n`;
    process.exitCode = 1;
  }
  rendered += [...delivered, ...failed].join('\n');
  if (delivered.length > 0 || failed.length > 0) rendered += '\n';
  return failed.length === 0 ? envelope_ok(rendered) : envelope_error(rendered, undefined, '');
}

/**
 * Downloads a remote ChRIS file or directory to the local filesystem, or hands
 * it to the surface when the engine's disk is not the operator's.
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

  // A path resolved here is a path on the *engine's* disk. That is the
  // operator's disk only when a local shell hosts the engine in its own
  // process; under a daemon it is a machine nobody attending the session is
  // sitting at. So when the surface does not share the engine's filesystem,
  // the file is handed to the surface, which puts it somewhere its operator
  // can actually reach — the client's disk for a remote shell, the download
  // manager for a browser.
  const surface: Surface = surface_get();
  if (!surface.capabilities.engineFilesystem) {
    return surfaceDownload_run(surface, sourceArgs, localPathArg);
  }

  const targetLocal: string = path.resolve(localPathArg);

  try {
    const progress: DownloadOptions = {
      force,
      confirm: downloadConfirmation_request,
      onNotice: (message: string, channel: 'status' | 'err'): void => {
        const sink = sink_get();
        if (channel === 'status') sink.status_write(`${message}\n`);
        else sink.err_write(`${message}\n`);
      },
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
