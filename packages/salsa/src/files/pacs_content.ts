import * as path from 'path';
import {
  ChRISEmbeddedResourceGroup,
  errorStack,
  FilteredResourceData,
  Result,
  Ok,
  Err,
  chrisConnection,
} from "@fnndsc/cumin";
import Client, { FileBrowserFolder, PACSFile } from "@fnndsc/chrisapi";
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
  const client: Client | null = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push("error", "Not connected to ChRIS. Cannot fetch PACS file.");
    return Err();
  }

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

  try {
    // Get the PACSFile resource using the file ID
    const pacsFile: PACSFile | null = await client.getPACSFile(file.id);

    if (!pacsFile) {
      errorStack.stack_push("error", `Could not retrieve PACSFile resource for ID ${file.id}`);
      return Err();
    }

    // Download the file blob using the PACS-specific method
    const blob: unknown = await pacsFile.getFileBlob();

    if (!blob) {
      errorStack.stack_push("error", `PACS file ${filePath} exists but returned no content/blob.`);
      return Err();
    }

    // Convert blob to Buffer (handle different blob types)
    let buffer: Buffer;
    if (typeof blob === "string") {
      buffer = Buffer.from(blob);
    } else if (blob instanceof ArrayBuffer) {
      buffer = Buffer.from(blob);
    } else if (blob instanceof Blob) {
      const arrayBuffer: ArrayBuffer = await blob.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else if (Buffer.isBuffer(blob)) {
      buffer = blob;
    } else {
      throw new Error(`Unexpected blob type for PACS file: ${typeof blob}`);
    }

    return Ok(buffer.toString('utf-8'));

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Failed to fetch PACS file content for ${filePath}: ${msg}`);
    return Err();
  }
}
