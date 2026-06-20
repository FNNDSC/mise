/**
 * @file Builtin du command.
 * Displays disk usage.
 */
import chalk from 'chalk';
import path from 'path';
import { ParsedArgs, commandArgs_process, path_resolve } from '../utils.js';
import { session } from '../../session/index.js';
import { vfs } from '../../lib/vfs/vfs.js';
import { spinner } from '../../lib/spinner.js';
import { scan_do, type CLIscan, type ScanRecord } from '@fnndsc/chili/path/pathCommand.js';
import { bytes_format } from '@fnndsc/chili/commands/fs/upload.js';
import type { Result } from '@fnndsc/cumin';
import type { ListingItem } from '@fnndsc/chili/models/listing.js';

/**
 * Parsed flags controlling `du` output.
 */
export interface DuOptions {
  humanReadable: boolean;
  summarize: boolean;
  showAll: boolean;
  showTotal: boolean;
  separateDirs: boolean;
  maxDepth: number | undefined;
}

/**
 * Stat summary for a single `du` target.
 */
interface TargetStat {
  isDirectory: boolean;
  fileSize: number;
}

/**
 * Formats a byte count for `du` output: human-readable string or KB integer,
 * right-padded to 12 characters for column alignment.
 *
 * @param bytes - Raw byte count.
 * @param humanReadable - If true, format as human-readable (e.g. `1.2M`).
 * @returns Right-aligned size string.
 */
export function duSize_format(bytes: number, humanReadable: boolean): string {
  const formatted: string = humanReadable
    ? bytes_format(bytes)
    : Math.ceil(bytes / 1024).toString();
  return formatted.padStart(12, ' ');
}

/**
 * Extracts `du` flags from parsed command arguments.
 *
 * @param parsed - The parsed command arguments.
 * @returns The resolved du options.
 */
export function duOptions_parse(parsed: ParsedArgs): DuOptions {
  const maxDepth: number | undefined = parsed['d']
    ? parseInt(String(parsed['d']), 10)
    : parsed['max-depth']
      ? parseInt(String(parsed['max-depth']), 10)
      : undefined;
  return {
    humanReadable: !!parsed['h'] || !!parsed['human-readable'],
    summarize: !!parsed['s'] || !!parsed['summarize'],
    showAll: !!parsed['a'] || !!parsed['all'],
    showTotal: !!parsed['c'] || !!parsed['total'],
    separateDirs: !!parsed['S'] || !!parsed['separate-dirs'],
    maxDepth,
  };
}

/**
 * Resolves whether a target path is a directory or a file (with size).
 *
 * @param targetPath - The resolved ChRIS path to stat.
 * @returns A TargetStat on success, or an error message string on failure.
 */
async function targetStat_resolve(targetPath: string): Promise<TargetStat | string> {
  try {
    const result: Result<ListingItem[]> = await vfs.data_get(targetPath, { directory: true });
    if (result.ok && result.value.length > 0) {
      const item: ListingItem = result.value[0];
      if (item.type === 'dir' || item.type === 'vfs') {
        return { isDirectory: true, fileSize: 0 };
      }
      return { isDirectory: false, fileSize: item.size || 0 };
    }
    return `du: cannot access '${targetPath}': No such file or directory`;
  } catch (e: unknown) {
    return `du: cannot access '${targetPath}': ${e}`;
  }
}

/**
 * Accumulates per-directory sizes from a scan result, attributing each file's
 * size to its ancestor directories up to (and including) the target path.
 *
 * @param scanResult - The recursive scan result.
 * @param targetPath - The directory being measured.
 * @param opts - The du options (separateDirs / showAll affect attribution).
 * @returns A map of directory path to accumulated size.
 */
export function dirSizes_compute(
  scanResult: ScanRecord,
  targetPath: string,
  opts: DuOptions
): Map<string, number> {
  const dirSizes: Map<string, number> = new Map<string, number>();

  scanResult.fileInfo.forEach((fileInfo) => {
    const filePath: string = fileInfo.chrisPath;
    const fSize: number = fileInfo.size;

    if (fileInfo.isDirectory) {
      if (!dirSizes.has(filePath)) {
        dirSizes.set(filePath, 0);
      }
      return;
    }

    // File: add to its parent directory and all ancestor directories,
    // but only up to the targetPath currently being scanned.
    let currentPath: string = path.posix.dirname(filePath);
    while (currentPath && currentPath.startsWith(targetPath)) {
      const currentSize: number = dirSizes.get(currentPath) || 0;
      dirSizes.set(currentPath, currentSize + fSize);

      if (currentPath === targetPath) break;
      if (opts.separateDirs) break;
      currentPath = path.posix.dirname(currentPath);
    }

    if (opts.showAll) {
      dirSizes.set(filePath, fSize);
    }
  });

  // Ensure the target directory itself exists in the map with total size.
  if (!dirSizes.has(targetPath)) {
    dirSizes.set(targetPath, scanResult.totalSize);
  }

  return dirSizes;
}

/**
 * Renders accumulated directory sizes to stdout, honouring summary and
 * max-depth options.
 *
 * @param dirSizes - Map of directory path to size.
 * @param targetPath - The directory being measured.
 * @param opts - The du options.
 */
function dirUsage_render(
  dirSizes: Map<string, number>,
  targetPath: string,
  opts: DuOptions
): void {
  if (opts.summarize) {
    const size: number = dirSizes.get(targetPath) || 0;
    console.log(`${duSize_format(size, opts.humanReadable)}\t${targetPath}`);
    return;
  }

  const entries: Array<[string, number]> = Array.from(dirSizes.entries());
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  for (const [dirPath, dirSize] of entries) {
    if (opts.maxDepth !== undefined) {
      const rel: string = path.posix.relative(targetPath, dirPath);
      const depth: number = rel === '' ? 0 : rel.split('/').length;
      if (depth > opts.maxDepth) continue;
    }
    console.log(`${duSize_format(dirSize, opts.humanReadable)}\t${dirPath}`);
  }
}

/**
 * Displays disk usage statistics for ChRIS filesystem directories.
 * Mimics standard Linux du command behavior and flags.
 * Uses chili's scan_do machinery for recursive filesystem traversal.
 *
 * @param args - Command line arguments (optional path and flags).
 * @returns A Promise that resolves when disk usage is displayed.
 *
 * @example
 * ```
 * du                      # Disk usage of current directory
 * du -h                   # Human-readable sizes
 * du -s /home/user/data   # Summary only
 * du -a                   # Show all files, not just directories
 * du -c                   # Show grand total
 * du -d 2                 # Max depth of 2 levels
 * ```
 */
export async function builtin_du(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const opts: DuOptions = duOptions_parse(parsed);
  const pathArgs: string[] = parsed._ as string[];

  const originalFolder: string = await session.getCWD();
  const rawTargets: string[] = pathArgs.length > 0 ? pathArgs : ['.'];

  const resolvedTargets: string[] = [];
  for (const raw of rawTargets) {
    resolvedTargets.push(await path_resolve(raw));
  }

  let grandTotal: number = 0;

  try {
    for (const targetPath of resolvedTargets) {
      const argLabel: string = path.basename(targetPath);
      spinner.start(`Scanning ${argLabel}...`);

      const stat: TargetStat | string = await targetStat_resolve(targetPath);
      if (typeof stat === 'string') {
        spinner.stop();
        console.error(chalk.red(stat));
        continue;
      }

      if (!stat.isDirectory) {
        grandTotal += stat.fileSize;
        spinner.stop();
        console.log(`${duSize_format(stat.fileSize, opts.humanReadable)}\t${targetPath}`);
        continue;
      }

      await session.setCWD(targetPath);
      const scanOptions: CLIscan = {
        silent: true,
        tree: false,
        follow: false,
        dirsOnly: false,
      };
      const scanResult: ScanRecord | null = await scan_do(scanOptions);
      await session.setCWD(originalFolder);

      if (!scanResult) {
        spinner.stop();
        continue;
      }

      const dirSizes: Map<string, number> = dirSizes_compute(scanResult, targetPath, opts);
      grandTotal += scanResult.totalSize;
      spinner.stop();

      dirUsage_render(dirSizes, targetPath, opts);
    }

    if (opts.showTotal && rawTargets.length > 0) {
      console.log(`${duSize_format(grandTotal, opts.humanReadable)}\ttotal`);
    }
  } finally {
    spinner.stop();
    await session.setCWD(originalFolder);
  }
}
