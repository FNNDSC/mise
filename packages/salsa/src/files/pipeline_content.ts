import {
  chrisConnection,
  errorStack,
  Result,
  Ok,
  Err,
} from "@fnndsc/cumin";
import Client, { PipelineSourceFile, PipelineSourceFileList } from "@fnndsc/chrisapi";

/**
 * Fetches the content of a pipeline source file.
 *
 * @param filePath - The full path to the pipeline file, e.g., /PIPELINES/<owner>/<filename>.
 * @returns A Result containing the file content as a string, or an error.
 */
export async function fileContent_getPipeline(filePath: string): Promise<Result<string>> {
  const client: Client | null = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push("error", "Not connected to ChRIS. Cannot fetch pipeline file content.");
    return Err();
  }

  // The API returns fname as the full path like "PIPELINES/sandip.samal/PHI_detection.yml"
  // So we need to match against the full path minus the leading slash
  const expectedFname: string = filePath.startsWith('/') ? filePath.substring(1) : filePath;

  try {
    // Query for all pipeline source files and filter client-side
    const pipelineSourceFileListResult: PipelineSourceFileList | null = await client.getPipelineSourceFiles();

    if (pipelineSourceFileListResult === null) {
      errorStack.stack_push("error", `Failed to retrieve pipeline source file list.`);
      return Err();
    }

    // @ts-ignore - Bypassing persistent TS error
    const allItems: PipelineSourceFile[] = pipelineSourceFileListResult.getItems();

    // Filter by full fname path (API returns full path like "PIPELINES/user/file.yml")
    // @ts-ignore - Bypassing persistent TS error
    const matchingPipelineFiles: PipelineSourceFile[] = allItems.filter((item: PipelineSourceFile) => {
        const itemData = item.data as { fname: string };
        return itemData.fname === expectedFname;
    });

    if (matchingPipelineFiles.length === 0) {
      errorStack.stack_push("error", `Pipeline source file not found: ${filePath}`);
      return Err();
    }
    
    const pipelineSourceFile: PipelineSourceFile = matchingPipelineFiles[0]!;
    const blob: unknown = await pipelineSourceFile.getFileBlob();

    if (!blob) {
      errorStack.stack_push("error", `Pipeline source file ${filePath} exists but returned no content/blob.`);
      return Err();
    }

    let buffer: Buffer;
    if (typeof blob === "string") {
      buffer = Buffer.from(blob);
    } else if (blob instanceof ArrayBuffer) {
      buffer = Buffer.from(blob);
    } else if (blob instanceof Blob) {
      const arrayBuffer: ArrayBuffer = await blob.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      throw new Error(`Unexpected blob type for pipeline file: ${typeof blob}`);
    }

    return Ok(buffer.toString('utf-8'));

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Failed to fetch pipeline file content for ${filePath}: ${msg}`);
    return Err();
  }
}
