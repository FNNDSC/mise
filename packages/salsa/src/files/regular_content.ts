import * as path from 'path';
import {
  ChRISEmbeddedResourceGroup,
  errorStack,
  FilteredResourceData,
  Result,
  Ok,
  Err,
  chrisIO,
} from "@fnndsc/cumin";
import { ChrisPathNode } from "@fnndsc/cumin";
import { files_getGroup } from './index';

/**
 * Views content of a file in ChRIS by its ID.
 * This is a helper function, not directly exported to avoid circular deps.
 *
 * @param fileId - The ID of the file to view.
 * @returns A Promise resolving to a Result containing the file content as a Buffer, or Err on failure.
 */
async function files_view(fileId: number): Promise<Result<Buffer>> {
  const buffer: Buffer | null = await chrisIO.file_download(fileId);
  if (buffer === null) {
      // chrisIO.file_download should have already pushed an error
      return Err();
  }
  return Ok(buffer);
}

/**
 * Fetches the binary content of a regular ChRIS file as a stream/blob.
 *
 * @param filePath - The full path to the file.
 * @returns A Result containing the stream/blob and optional size metadata.
 */
export async function fileContent_getRegularStream(
  filePath: string
): Promise<Result<{ stream: any; size?: number; filename?: string }>> {
  const dir: string = path.posix.dirname(filePath);
  const name: string = path.posix.basename(filePath);

  const group: ChRISEmbeddedResourceGroup<ChrisPathNode> | null =
    await files_getGroup("files", dir);
  if (!group) {
    return Err();
  }

  const results: FilteredResourceData | null = await group.asset.resources_getAll();
  if (!results || !results.tableData) {
    errorStack.stack_push("error", `No files found in directory: ${dir}`);
    return Err();
  }

  const file: { id?: number; fname?: string } | undefined = results.tableData.find(
    (f: { fname?: string }) => {
      const fname: string = f.fname || "";
      const basename: string = path.posix.basename(fname);
      return basename === name || basename === `? ${name}`;
    }
  );

  if (!file) {
    errorStack.stack_push("error", `File not found: ${name} in ${dir}`);
    return Err();
  }

  if (typeof file.id !== "number") {
    errorStack.stack_push("error", `File has no valid ID: ${name}`);
    return Err();
  }

  const streamResult: Result<{ stream: unknown; size?: number; filename?: string }> =
    await chrisIO.file_downloadStream(file.id);
  if (!streamResult.ok) {
    return Err();
  }

  return Ok(streamResult.value);
}

/**
 * Fetches the content of a regular ChRIS file.
 *
 * @param filePath - The full path to the file.
 * @returns A Result containing the file content as a string, or an error.
 */
export async function fileContent_getRegular(filePath: string): Promise<Result<string>> {
  const dir: string = path.posix.dirname(filePath);
  const name: string = path.posix.basename(filePath);
  
  const group: ChRISEmbeddedResourceGroup<ChrisPathNode> | null = await files_getGroup('files', dir);
  if (!group) {
     return Err();
  }
  
  const results: FilteredResourceData | null = await group.asset.resources_getAll();
  if (!results || !results.tableData) {
     errorStack.stack_push("error", `No files found in directory: ${dir}`);
     return Err();
  }

  const file: { id?: number, fname?: string } | undefined = results.tableData.find((f: { fname?: string }) => {
      const fname: string = f.fname || '';
      const basename = path.posix.basename(fname);
      return basename === name || basename === `? ${name}`;
  });
  
  if (!file) {
      errorStack.stack_push("error", `File not found: ${name} in ${dir}`);
      return Err();
  }

  if (typeof file.id !== 'number') {
      errorStack.stack_push("error", `File has no valid ID: ${name}`);
      return Err();
  }

  const filesViewResult: Result<Buffer> = await files_view(file.id);
  if (!filesViewResult.ok) {
      // The error is already pushed by files_view or chrisIO.file_download
      return Err();
  }

  return Ok(filesViewResult.value.toString('utf-8'));
}

/**
 * Fetches the binary content of a regular ChRIS file.
 *
 * Same as fileContent_getRegular but returns raw Buffer instead of string.
 *
 * @param filePath - The full path to the file.
 * @returns A Result containing the file content as a Buffer, or an error.
 */
export async function fileContent_getRegularBinary(filePath: string): Promise<Result<Buffer>> {
  const dir: string = path.posix.dirname(filePath);
  const name: string = path.posix.basename(filePath);

  const group: ChRISEmbeddedResourceGroup<ChrisPathNode> | null = await files_getGroup('files', dir);
  if (!group) {
     return Err();
  }

  const results: FilteredResourceData | null = await group.asset.resources_getAll();
  if (!results || !results.tableData) {
     errorStack.stack_push("error", `No files found in directory: ${dir}`);
     return Err();
  }

  const file: { id?: number, fname?: string } | undefined = results.tableData.find((f: { fname?: string }) => {
      const fname: string = f.fname || '';
      const basename = path.posix.basename(fname);
      return basename === name || basename === `? ${name}`;
  });

  if (!file) {
      errorStack.stack_push("error", `File not found: ${name} in ${dir}`);
      return Err();
  }

  if (typeof file.id !== 'number') {
      errorStack.stack_push("error", `File has no valid ID: ${name}`);
      return Err();
  }

  const filesViewResult: Result<Buffer> = await files_view(file.id);
  if (!filesViewResult.ok) {
      // The error is already pushed by files_view or chrisIO.file_download
      return Err();
  }

  return Ok(filesViewResult.value);
}
