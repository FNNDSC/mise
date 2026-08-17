/**
 * @file Download command implementation.
 * @module
 */
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";

import chalk from "chalk";

import { fileContent_getBinaryStream, files_listRecursive, files_path_isDirectory, FsItem } from "@fnndsc/salsa";
import { chiliLog } from "../../screen/output.js";
import { prompt_confirmOrThrow } from "../../utils/input_format.js";
import { path_resolveChrisFs } from "../../utils/cli.js";
import { bytes_format } from "./upload.js";

export { bytes_format };

/**
 * Download summary statistics.
 */
export interface DownloadSummary {
  startTime: number;
  endTime: number;
  totalFiles: number;
  transferredCount: number;
  failedCount: number;
  transferSize: number;
  duration: number;
  speed: number;
}

/** Download progress fact emitted to callers that want to render progress. */
export interface DownloadProgressEvent {
  operation: "download";
  kind: "transfer";
  phase: "scanning" | "transferring" | "complete" | "failed";
  label?: string;
  current?: number;
  total?: number;
  percent?: number;
  unit?: "files" | "bytes";
  status?: "running" | "done" | "error";
}

/** Options for download execution. */
export interface DownloadOptions {
  force?: boolean;
  onProgress?: (event: DownloadProgressEvent) => void;
}

/** One remote file and its precomputed host-local destination. */
interface DownloadPlan {
  remotePath: string;
  localPath: string;
}

/** All host-local artifacts needed for an aggregate download. */
interface DownloadBatchPlan {
  directories: string[];
  files: DownloadPlan[];
}

/**
 * Recursively creates a directory and all parent directories.
 * @param dirPath - Directory path to create.
 */
async function directory_ensureExists(dirPath: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

/**
 * Checks if a ChRIS path is a directory by attempting to list it.
 * @param chrisPath - ChRIS path to check.
 * @returns True if it's a directory, false if it's a file.
 */
async function chrisPath_isDirectory(chrisPath: string): Promise<boolean> {
  return files_path_isDirectory(chrisPath);
}

/**
 * Downloads files from ChRIS and optionally emits structured progress events.
 * @param chrisPath - Remote ChRIS path (file or directory).
 * @param localPath - Local filesystem path.
 * @param options - Download options.
 * @returns Promise<DownloadSummary> with download statistics.
 */
export async function files_downloadWithProgress(
  chrisPath: string,
  localPath: string,
  options: DownloadOptions = {}
): Promise<DownloadSummary> {
  const resolvedChris: string = await path_resolveChrisFs(chrisPath, {});

  // Check if local path exists (only block overwriting regular files unless force)
  if (fs.existsSync(localPath)) {
    const localStat: fs.Stats = await fs.promises.stat(localPath);
    if (localStat.isFile() && !options.force) {
      throw new Error(
        `Local path already exists: ${localPath}. Use -f flag to overwrite.`
      );
    }
    // If it's a directory, allow and handle below.
  }

  const summary: DownloadSummary = {
    startTime: Date.now(),
    endTime: 0,
    totalFiles: 0,
    transferredCount: 0,
    failedCount: 0,
    transferSize: 0,
    duration: 0,
    speed: 0,
  };

  const isDirectory: boolean = await chrisPath_isDirectory(resolvedChris);

  if (!isDirectory) {
    // Download single file
    try {
      const result = await fileContent_getBinaryStream(resolvedChris);
      if (!result.ok) {
        throw new Error("Failed to download file");
      }

      const { stream, size } = result.value as {
        stream: NodeJS.ReadableStream;
        size?: number;
        filename?: string;
      };

      // If localPath is a directory, place the file inside using remote basename
      const stats: fs.Stats | null = fs.existsSync(localPath) ? await fs.promises.stat(localPath) : null;
      const finalLocalPath: string =
        stats && stats.isDirectory()
          ? path.join(localPath, path.basename(resolvedChris))
          : localPath;

      // Warn if target file already exists (non-overwrite) or directory already exists
      if (fs.existsSync(finalLocalPath)) {
        const existingStat: fs.Stats = await fs.promises.stat(finalLocalPath);
        if (existingStat.isFile()) {
          if (!options.force) {
            await prompt_confirmOrThrow(
              `Local file exists at ${finalLocalPath}. Overwrite? (y/N)`
            );
          }
        } else if (existingStat.isDirectory()) {
          if (!options.force) {
            await prompt_confirmOrThrow(
              `Target directory exists. Download into existing folder: ${finalLocalPath}? (y/N)`
            );
          }
        }
      }

      // Ensure parent directory exists
      const parentDir: string = path.dirname(finalLocalPath);
      await directory_ensureExists(parentDir);

      let transferred: number = 0;
      const writeStream: fs.WriteStream = fs.createWriteStream(finalLocalPath);
      stream.on("data", (chunk: Buffer) => {
        transferred += chunk.length;
        options.onProgress?.({
          operation: "download",
          kind: "transfer",
          phase: "transferring",
          label: `Downloading ${path.basename(finalLocalPath)}`,
          current: transferred,
          total: size,
          percent: typeof size === "number" && size > 0 ? (Math.min(transferred, size) / size) * 100 : undefined,
          unit: "bytes",
          status: "running",
        });
      });

      await pipeline(stream, writeStream);

      summary.totalFiles = 1;
      summary.transferredCount = 1;
      summary.transferSize = transferred;

      summary.endTime = Date.now();
      summary.duration = (summary.endTime - summary.startTime) / 1000;
      summary.speed = summary.duration > 0 ? summary.transferSize / summary.duration : 0;

      options.onProgress?.({
        operation: "download",
        kind: "transfer",
        phase: "complete",
        label: "Download complete",
        current: transferred,
        total: size,
        percent: typeof size === "number" && size > 0 ? 100 : undefined,
        unit: "bytes",
        status: "done",
      });

      return summary;
    } catch (error: unknown) {
      summary.failedCount = 1;
      options.onProgress?.({
        operation: "download",
        kind: "transfer",
        phase: "failed",
        label: "Download failed",
        status: "error",
      });
      throw error;
    }
  }

  // Download directory
  chiliLog(chalk.cyan("Scanning files to download..."));
  options.onProgress?.({
    operation: "download",
    kind: "transfer",
    phase: "scanning",
    label: "Scanning files to download",
    status: "running",
  });
  const items: FsItem[] = await files_listRecursive(resolvedChris);
  const files: FsItem[] = items.filter((item: FsItem) => item.type === 'file');

  summary.totalFiles = files.length;

  // Apply Unix semantics: trailing slash determines merge behavior
  const targetDir: string = resolvedChris.endsWith('/')
    ? localPath  // Merge contents
    : path.join(localPath, path.basename(resolvedChris)); // Create subdir

  // Warn/confirm if target directory exists
  if (fs.existsSync(targetDir)) {
    const statTarget: fs.Stats = await fs.promises.stat(targetDir);
    if (statTarget.isDirectory()) {
      const entries: string[] = await fs.promises.readdir(targetDir);
      if (!options.force) {
        await prompt_confirmOrThrow(
          `Target directory exists${entries.length ? ' (will merge contents)' : ''}: ${targetDir}. Continue? (y/N)`
        );
      }
    } else if (statTarget.isFile()) {
      if (!options.force) {
        await prompt_confirmOrThrow(
          `Local file exists at ${targetDir}. Overwrite? (y/N)`
        );
      }
    }
  }

  // Ensure target directory exists
  await directory_ensureExists(targetDir);

  options.onProgress?.({
    operation: "download",
    kind: "transfer",
    phase: "transferring",
    label: "Downloading files",
    current: 0,
    total: files.length,
    percent: files.length === 0 ? 100 : 0,
    unit: "files",
    status: "running",
  });

  // Download each file
  for (const [index, file] of files.entries()) {
    try {
      const result = await fileContent_getBinaryStream(file.path);
      if (!result.ok) {
        summary.failedCount++;
        chiliLog(chalk.yellow(`\nFailed to download: ${file.path}`));
        continue;
      }

      const { stream, size } = result.value as {
        stream: NodeJS.ReadableStream;
        size?: number;
        filename?: string;
      };

      // Calculate relative path
      const relativePath: string = file.path.substring(resolvedChris.length).replace(/^\//, '');
      const localFilePath: string = path.join(targetDir, relativePath);

      // Ensure parent directory exists
      const parentDir: string = path.dirname(localFilePath);
      await directory_ensureExists(parentDir);

      const writeStream: fs.WriteStream = fs.createWriteStream(localFilePath);
      let transferred: number = 0;
      stream.on("data", (chunk: Buffer) => {
        transferred += chunk.length;
      });
      await pipeline(stream, writeStream);

      summary.transferredCount++;
      summary.transferSize += size ?? transferred;
    } catch (error: unknown) {
      summary.failedCount++;
      const msg: string = error instanceof Error ? error.message : String(error);
      chiliLog(chalk.red(`\nError downloading ${file.path}: ${msg}`));
    }

    options.onProgress?.({
      operation: "download",
      kind: "transfer",
      phase: "transferring",
      label: "Downloading files",
      current: index + 1,
      total: files.length,
      percent: files.length === 0 ? 100 : ((index + 1) / files.length) * 100,
      unit: "files",
      status: "running",
    });
  }

  summary.endTime = Date.now();
  summary.duration = (summary.endTime - summary.startTime) / 1000;
  summary.speed = summary.duration > 0 ? summary.transferSize / summary.duration : 0;

  options.onProgress?.({
    operation: "download",
    kind: "transfer",
    phase: summary.failedCount === 0 ? "complete" : "failed",
    label: "Download complete",
    current: summary.transferredCount,
    total: summary.totalFiles,
    percent: summary.totalFiles === 0 ? 100 : (summary.transferredCount / summary.totalFiles) * 100,
    unit: "files",
    status: summary.failedCount === 0 ? "done" : "error",
  });

  return summary;
}

/**
 * Builds concrete host-local transfer plans for multiple exact CFS sources.
 *
 * A directory source retains its basename below the local destination, while
 * an individual file is placed directly in that destination.
 *
 * @param sources - Exact CFS source paths.
 * @param localDirectory - Host-local directory receiving the matches.
 * @returns The CFS-file and directory plans needed for the transfer.
 */
async function downloadPlans_create(
  sources: readonly string[],
  localDirectory: string,
): Promise<DownloadBatchPlan> {
  const plan: DownloadBatchPlan = { directories: [], files: [] };

  for (const source of sources) {
    const resolvedChris: string = await path_resolveChrisFs(source, {});
    const isDirectory: boolean = await files_path_isDirectory(resolvedChris);
    if (isDirectory) {
      const targetDirectory: string = path.join(localDirectory, path.basename(resolvedChris));
      plan.directories.push(targetDirectory);
      const items: FsItem[] = await files_listRecursive(resolvedChris);
      for (const item of items) {
        const relativePath: string = item.path.substring(resolvedChris.length).replace(/^\//, '');
        const localPath: string = path.join(targetDirectory, relativePath);
        if (item.type === 'dir') {
          plan.directories.push(localPath);
        } else {
          plan.files.push({ remotePath: item.path, localPath });
        }
      }
      continue;
    }

    plan.files.push({
      remotePath: resolvedChris,
      localPath: path.join(localDirectory, path.basename(resolvedChris)),
    });
  }

  return plan;
}

/**
 * Ensures that a multi-source download can safely use its destination.
 *
 * @param localDirectory - Host-local directory receiving the matches.
 * @param plans - Concrete file transfers that will be written below the directory.
 * @param force - Whether existing files may be overwritten without prompting.
 * @returns A promise fulfilled when the destination is ready.
 * @throws If the destination is an existing non-directory or the operator rejects overwrite.
 */
async function downloadDestination_prepare(
  localDirectory: string,
  plans: readonly DownloadPlan[],
  force: boolean,
): Promise<void> {
  if (fs.existsSync(localDirectory)) {
    const stats: fs.Stats = await fs.promises.stat(localDirectory);
    if (!stats.isDirectory()) {
      throw new Error(`Wildcard download requires a local directory target: ${localDirectory}`);
    }
  } else {
    await directory_ensureExists(localDirectory);
  }

  if (force) return;

  const conflicts: DownloadPlan[] = [];
  for (const plan of plans) {
    if (fs.existsSync(plan.localPath)) {
      conflicts.push(plan);
    }
  }
  if (conflicts.length > 0) {
    await prompt_confirmOrThrow(
      `${conflicts.length} local file(s) already exist below ${localDirectory}. Overwrite? (y/N)`,
    );
  }
}

/**
 * Downloads multiple exact CFS paths into one host-local directory.
 *
 * This is the aggregate transfer seam used after the ChELL layer expands a
 * CFS source glob. It intentionally accepts paths rather than patterns: CFS
 * namespace expansion belongs to the VFS-aware Brasa layer.
 *
 * @param sources - Exact CFS files or directories selected by the shell.
 * @param localDirectory - Host-local directory receiving all matched sources.
 * @param options - Download options and an optional aggregate progress callback.
 * @returns Aggregate transfer statistics for all supplied sources.
 * @throws If no sources are provided or the local target is not a directory.
 */
export async function files_downloadManyWithProgress(
  sources: readonly string[],
  localDirectory: string,
  options: DownloadOptions = {},
): Promise<DownloadSummary> {
  if (sources.length === 0) {
    throw new Error('No CFS paths were provided for download');
  }

  const summary: DownloadSummary = {
    startTime: Date.now(),
    endTime: 0,
    totalFiles: 0,
    transferredCount: 0,
    failedCount: 0,
    transferSize: 0,
    duration: 0,
    speed: 0,
  };

  options.onProgress?.({
    operation: 'download',
    kind: 'transfer',
    phase: 'scanning',
    label: 'Scanning CFS files to download',
    status: 'running',
  });
  const plans: DownloadBatchPlan = await downloadPlans_create(sources, localDirectory);
  await downloadDestination_prepare(localDirectory, plans.files, options.force === true);
  for (const directory of plans.directories) {
    await directory_ensureExists(directory);
  }
  summary.totalFiles = plans.files.length;

  options.onProgress?.({
    operation: 'download',
    kind: 'transfer',
    phase: 'transferring',
    label: 'Downloading matching files',
    current: 0,
    total: plans.files.length,
    percent: plans.files.length === 0 ? 100 : 0,
    unit: 'files',
    status: 'running',
  });

  for (const [index, plan] of plans.files.entries()) {
    try {
      const result = await fileContent_getBinaryStream(plan.remotePath);
      if (!result.ok) {
        throw new Error('Failed to download file');
      }

      const { stream, size } = result.value as {
        stream: NodeJS.ReadableStream;
        size?: number;
      };
      await directory_ensureExists(path.dirname(plan.localPath));
      let transferred: number = 0;
      stream.on('data', (chunk: Buffer): void => {
        transferred += chunk.length;
      });
      await pipeline(stream, fs.createWriteStream(plan.localPath));
      summary.transferredCount++;
      summary.transferSize += size ?? transferred;
    } catch (error: unknown) {
      summary.failedCount++;
      const message: string = error instanceof Error ? error.message : String(error);
      chiliLog(chalk.red(`\nError downloading ${plan.remotePath}: ${message}`));
    }

    options.onProgress?.({
      operation: 'download',
      kind: 'transfer',
      phase: 'transferring',
      label: 'Downloading matching files',
      current: index + 1,
      total: plans.files.length,
      percent: plans.files.length === 0 ? 100 : ((index + 1) / plans.files.length) * 100,
      unit: 'files',
      status: 'running',
    });
  }

  summary.endTime = Date.now();
  summary.duration = (summary.endTime - summary.startTime) / 1000;
  summary.speed = summary.duration > 0 ? summary.transferSize / summary.duration : 0;
  options.onProgress?.({
    operation: 'download',
    kind: 'transfer',
    phase: summary.failedCount === 0 ? 'complete' : 'failed',
    label: 'Download complete',
    current: summary.transferredCount,
    total: summary.totalFiles,
    percent: summary.totalFiles === 0 ? 100 : (summary.transferredCount / summary.totalFiles) * 100,
    unit: 'files',
    status: summary.failedCount === 0 ? 'done' : 'error',
  });

  return summary;
}
