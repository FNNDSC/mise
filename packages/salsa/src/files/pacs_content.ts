/**
 * @file Content retrieval for PACS-backed files (text and binary).
 *
 * @module
 */

import { Result, Err, pacsFile_getBlob, pacsFile_getText } from "@fnndsc/cumin";
import { fileId_atPath_resolve } from './fileLookup.js';

/**
 * Fetches the content of a PACS file (DICOM).
 *
 * Path structure: /SERVICES/PACS/<service>/<patient>/<study>/<series>/<file>.dcm
 *
 * PACS files appear in directory listings but must be downloaded through
 * the PACSFile API instead of the regular file download endpoint.
 *
 * @param filePath - The full path to the PACS file.
 * @returns A Result containing the file content as a string, or an error.
 */
export async function fileContent_getPACS(filePath: string): Promise<Result<string>> {
  const idResult: Result<number> = await fileId_atPath_resolve(filePath);
  if (!idResult.ok) {
    return Err();
  }
  return await pacsFile_getText(idResult.value);
}

/**
 * Fetches the binary content of a PACS file (DICOM).
 *
 * Same as fileContent_getPACS but returns raw Buffer instead of string.
 * Use this for binary files like DICOM (.dcm) that should not be converted to UTF-8.
 *
 * @param filePath - The full path to the PACS file.
 * @returns A Result containing the file content as a Buffer, or an error.
 */
export async function fileContent_getPACSBinary(filePath: string): Promise<Result<Buffer>> {
  const idResult: Result<number> = await fileId_atPath_resolve(filePath);
  if (!idResult.ok) {
    return Err();
  }
  return await pacsFile_getBlob(idResult.value);
}
