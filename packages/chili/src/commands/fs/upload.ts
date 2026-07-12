/**
 * @file Upload command implementation.
 * @module
 */
import { files_uploadPath } from "@fnndsc/salsa";
import { chrisIO } from "@fnndsc/cumin";
import { path_resolveChrisFs } from "../../utils/cli.js";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { prompt_confirmOrThrow } from "../../utils/input_format.js";
import { chiliLog } from "../../screen/output.js";

/**
 * File information for upload tracking.
 */
export interface UploadFileInfo {
  hostPath: string;
  chrisPath: string;
  size: number;
}

/**
 * Upload summary statistics.
 */
export interface UploadSummary {
  startTime: number;
  endTime: number;
  totalFiles: number;
  transferredCount: number;
  failedCount: number;
  transferSize: number;
  duration: number;
  speed: number;
  actualTargetPath: string; // The actual path where files were uploaded
}

/** Upload progress fact emitted to callers that want to render progress. */
export interface UploadProgressEvent {
  operation: "upload";
  kind: "transfer";
  phase: "scanning" | "transferring" | "complete" | "failed";
  label?: string;
  current?: number;
  total?: number;
  percent?: number;
  unit?: "files";
  status?: "running" | "done" | "error";
}

/** Options for upload execution. */
export interface UploadOptions {
  force?: boolean;
  onProgress?: (event: UploadProgressEvent) => void;
}

/**
 * Formats bytes into human-readable format.
 * @param bytes - Number of bytes.
 * @returns Formatted string (e.g., "1.23 MB").
 */
export function bytes_format(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k: number = 1024;
  const sizes: string[] = ["B", "KB", "MB", "GB", "TB"];
  const i: number = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Formats seconds into a human-friendly ETA string.
 * @param seconds - Remaining seconds.
 */
export function eta_format(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "--";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const hrs: number = Math.floor(seconds / 3600);
  const mins: number = Math.floor((seconds % 3600) / 60);
  const secs: number = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  }
  return `${mins}m ${secs}s`;
}

/**
 * Formats a bytes-per-second rate into human-readable string.
 * @param rateBytesPerSec - Rate in bytes per second.
 */
export function rate_format(rateBytesPerSec: number): string {
  if (!Number.isFinite(rateBytesPerSec) || rateBytesPerSec <= 0) return "--";
  return `${bytes_format(rateBytesPerSec)}/s`;
}

/**
 * Recursively scans a local directory to get all files for upload.
 * @param localPath - The local filesystem path.
 * @param remotePath - The target ChRIS path.
 * @returns Array of UploadFileInfo objects.
 */
async function localFiles_scan(localPath: string, remotePath: string): Promise<UploadFileInfo[]> {
  const files: UploadFileInfo[] = [];

  async function walkDir(currentLocal: string, currentRemote: string): Promise<void> {
    const entries: fs.Dirent<string>[] = await fs.promises.readdir(currentLocal, { withFileTypes: true });

    for (const entry of entries) {
      const localFilePath: string = path.join(currentLocal, entry.name);
      const remoteFilePath: string = currentRemote.endsWith('/')
        ? currentRemote + entry.name
        : currentRemote + '/' + entry.name;

      if (entry.isDirectory()) {
        await walkDir(localFilePath, remoteFilePath);
      } else {
        const stats: fs.Stats = await fs.promises.stat(localFilePath);
        files.push({
          hostPath: localFilePath,
          chrisPath: remoteFilePath,
          size: stats.size,
        });
      }
    }
  }

  const stats: fs.Stats = await fs.promises.stat(localPath);
  if (stats.isDirectory()) {
    // Preserve directory basename in remote path (Unix cp semantics)
    const basename: string = path.basename(localPath);
    const targetDir: string = remotePath.endsWith('/')
      ? remotePath + basename
      : remotePath + '/' + basename;
    await walkDir(localPath, targetDir);
  } else {
    // Single file upload
    const filename: string = path.basename(localPath);
    const targetPath: string = remotePath.endsWith('/')
      ? remotePath + filename
      : remotePath + '/' + filename;
    files.push({
      hostPath: localPath,
      chrisPath: targetPath,
      size: stats.size,
    });
  }

  return files;
}

/**
 * Uploads files and optionally emits structured progress events.
 * @param localPath - Local path (file or directory).
 * @param remotePath - Remote ChRIS path.
 * @param options - Upload options, including an optional progress callback.
 * @returns Promise<UploadSummary> with upload statistics.
 */
export async function files_uploadWithProgress(
  localPath: string,
  remotePath: string,
  options: UploadOptions = {}
): Promise<UploadSummary> {
  const resolvedRemote: string = await path_resolveChrisFs(remotePath, {});

  // Scan files
  chiliLog(chalk.cyan("Scanning files to upload..."));
  options.onProgress?.({
    operation: "upload",
    kind: "transfer",
    phase: "scanning",
    label: "Scanning files to upload",
    status: "running",
  });
  const fileList: UploadFileInfo[] = await localFiles_scan(localPath, resolvedRemote);

  // Determine actual target path (where files will be uploaded)
  const stats: fs.Stats = await fs.promises.stat(localPath);
  let actualTarget: string = resolvedRemote;
  if (stats.isDirectory()) {
    const basename: string = path.basename(localPath);
    actualTarget = resolvedRemote.endsWith('/')
      ? resolvedRemote + basename
      : resolvedRemote + '/' + basename;
  }

  // Detect existing target and require confirmation unless force is set
  if (!options.force) {
    try {
      const client = await chrisIO.client_get();
      if (client) {
        const folderList = await client.getFileBrowserFolders({ path: actualTarget });
        const items: Object[] | null = await folderList.getItems();
        if (items && items.length > 0) {
          await prompt_confirmOrThrow(`Target '${actualTarget}' already exists in ChRIS. Merge/overwrite? (y/N)`);
        }
      }
    } catch {
      // If listing fails (path absent or error), continue.
    }
  } else {
    // Force mode: if target exists and is a directory, no prompt. If it's a file and we're uploading a single file, proceed.
  }

  // Upload files
  const summary: UploadSummary = {
    startTime: Date.now(),
    endTime: 0,
    totalFiles: fileList.length,
    transferredCount: 0,
    failedCount: 0,
    transferSize: 0,
    duration: 0,
    speed: 0,
    actualTargetPath: actualTarget,
  };

  options.onProgress?.({
    operation: "upload",
    kind: "transfer",
    phase: "transferring",
    label: "Uploading files",
    current: 0,
    total: fileList.length,
    percent: fileList.length === 0 ? 100 : 0,
    unit: "files",
    status: "running",
  });

  for (const [index, file] of fileList.entries()) {
    try {
      const fileContent: NonSharedBuffer = await fs.promises.readFile(file.hostPath);
      const fileBlob: Blob = new Blob([fileContent as unknown as BlobPart]);

      // Split chrisPath into dir and filename for the new API
      const lastSlash: number = file.chrisPath.lastIndexOf('/');
      const dir: string = file.chrisPath.substring(0, lastSlash) || '/';
      const filename: string = file.chrisPath.substring(lastSlash + 1);

      const uploadResult: boolean = await chrisIO.file_upload(fileBlob, dir, filename);

      if (uploadResult) {
        summary.transferredCount++;
        summary.transferSize += fileContent.length;
      } else {
        summary.failedCount++;
        chiliLog(chalk.yellow(`Failed to upload: ${file.hostPath}`));
      }
    } catch (error: unknown) {
      summary.failedCount++;
      chiliLog(
        chalk.red(
          `Error uploading ${file.hostPath}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }

    options.onProgress?.({
      operation: "upload",
      kind: "transfer",
      phase: "transferring",
      label: "Uploading files",
      current: index + 1,
      total: fileList.length,
      percent: fileList.length === 0 ? 100 : ((index + 1) / fileList.length) * 100,
      unit: "files",
      status: "running",
    });
  }

  summary.endTime = Date.now();
  summary.duration = (summary.endTime - summary.startTime) / 1000; // seconds
  summary.speed = summary.transferSize / summary.duration; // bytes per second

  options.onProgress?.({
    operation: "upload",
    kind: "transfer",
    phase: summary.failedCount === 0 ? "complete" : "failed",
    label: "Upload complete",
    current: summary.transferredCount,
    total: summary.totalFiles,
    percent: summary.totalFiles === 0 ? 100 : (summary.transferredCount / summary.totalFiles) * 100,
    unit: "files",
    status: summary.failedCount === 0 ? "done" : "error",
  });

  return summary;
}

/**
 * Uploads a local file or directory to ChRIS.
 *
 * @param localPath - Local path.
 * @param remotePath - Remote ChRIS path.
 * @returns Promise<boolean> true if successful.
 */
export async function files_upload(localPath: string, remotePath: string): Promise<boolean> {
  const resolvedRemote: string = await path_resolveChrisFs(remotePath, {});

  return await files_uploadPath(localPath, resolvedRemote);
}
