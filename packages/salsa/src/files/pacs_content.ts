import * as path from 'path';
import {
  ChRISEmbeddedResourceGroup,
  errorStack,
  FilteredResourceData,
  Result,
  Ok,
  Err,
  pacsFile_getBlob,
  pacsFile_getText,
} from "@fnndsc/cumin";
import { FileBrowserFolder } from "@fnndsc/chrisapi";
import { files_getGroup } from './index';

/**
 * Fetches the content of a PACS file (DICOM).
 *
 * Path structure: /SERVICES/PACS/<service>/<patient>/<study>/<series>/<file>.dcm
 * Example: /SERVICES/PACS/PACSDCM/7654321-EVANS-19861111/.../0168-1.3...dcm
 *
 * PACS files appear in directory listings but must be downloaded through
 * the PACSFile API instead of the regular file download endpoint.
 *
 * @param filePath - The full path to the PACS file.
 * @returns A Result containing the file content as a string, or an error.
 */
export async function fileContent_getPACS(filePath: string): Promise<Result<string>> {
  const dir: string = path.posix.dirname(filePath);
  const name: string = path.posix.basename(filePath);

  // Get the directory listing to find the file ID
  const group: ChRISEmbeddedResourceGroup<FileBrowserFolder> | null = await files_getGroup('files', dir);
  if (!group) {
     return Err();
  }

  const results: FilteredResourceData | null = await group.asset.resources_getAll();
  if (!results || !results.tableData) {
     errorStack.stack_push("error", `No files found in PACS directory: ${dir}`);
     return Err();
  }

  const file: { id?: number, fname?: string } | undefined = results.tableData.find((f: { fname?: string }) => {
      const fname: string = f.fname || '';
      const basename = path.posix.basename(fname);
      return basename === name || basename === `? ${name}`;
  });

  if (!file) {
      errorStack.stack_push("error", `PACS file not found: ${name} in ${dir}`);
      return Err();
  }

  if (typeof file.id !== 'number') {
      errorStack.stack_push("error", `PACS file has no valid ID: ${name}`);
      return Err();
  }

  // Use cumin's pacsFile_getText to download the file
  return await pacsFile_getText(file.id);
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
  const dir: string = path.posix.dirname(filePath);
  const name: string = path.posix.basename(filePath);

  // Get the directory listing to find the file ID
  const group: ChRISEmbeddedResourceGroup<FileBrowserFolder> | null = await files_getGroup('files', dir);
  if (!group) {
     return Err();
  }

  const results: FilteredResourceData | null = await group.asset.resources_getAll();
  if (!results || !results.tableData) {
     errorStack.stack_push("error", `No files found in PACS directory: ${dir}`);
     return Err();
  }

  const file: { id?: number, fname?: string } | undefined = results.tableData.find((f: { fname?: string }) => {
      const fname: string = f.fname || '';
      const basename = path.posix.basename(fname);
      return basename === name || basename === `? ${name}`;
  });

  if (!file) {
      errorStack.stack_push("error", `PACS file not found: ${name} in ${dir}`);
      return Err();
  }

  if (typeof file.id !== 'number') {
      errorStack.stack_push("error", `PACS file has no valid ID: ${name}`);
      return Err();
  }

  // Use cumin's pacsFile_getBlob to download the file as binary
  return await pacsFile_getBlob(file.id);
}
