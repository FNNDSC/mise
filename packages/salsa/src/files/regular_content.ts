/**
 * @file Content retrieval for regular uploaded files (text, binary, stream).
 *
 * @module
 */

import { Result, Ok, Err, chrisIO } from "@fnndsc/cumin";
import { fileId_atPath_resolve } from './fileLookup.js';

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
): Promise<Result<{ stream: unknown; size?: number; filename?: string }>> {
  const idResult: Result<number> = await fileId_atPath_resolve(filePath);
  if (!idResult.ok) {
    return Err();
  }

  const streamResult: Result<{ stream: unknown; size?: number; filename?: string }> =
    await chrisIO.file_downloadStream(idResult.value);
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
  const idResult: Result<number> = await fileId_atPath_resolve(filePath);
  if (!idResult.ok) {
    return Err();
  }

  const filesViewResult: Result<Buffer> = await files_view(idResult.value);
  if (!filesViewResult.ok) {
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
  const idResult: Result<number> = await fileId_atPath_resolve(filePath);
  if (!idResult.ok) {
    return Err();
  }

  const filesViewResult: Result<Buffer> = await files_view(idResult.value);
  if (!filesViewResult.ok) {
    return Err();
  }

  return Ok(filesViewResult.value);
}
