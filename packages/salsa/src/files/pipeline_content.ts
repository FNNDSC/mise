import {
  errorStack,
  Result,
  pipelineFile_getByPath,
  pipelineFile_getTextByPath,
} from "@fnndsc/cumin";

/**
 * Fetches the content of a pipeline source file.
 *
 * @param filePath - The full path to the pipeline file, e.g., /PIPELINES/<owner>/<filename>.
 * @returns A Result containing the file content as a string, or an error.
 */
export async function fileContent_getPipeline(filePath: string): Promise<Result<string>> {
  // Use cumin's pipelineFile_getTextByPath to download the file
  return await pipelineFile_getTextByPath(filePath);
}

/**
 * Fetches the binary content of a pipeline source file.
 *
 * Same as fileContent_getPipeline but returns raw Buffer instead of string.
 *
 * @param filePath - The full path to the pipeline file, e.g., /PIPELINES/<owner>/<filename>.
 * @returns A Result containing the file content as a Buffer, or an error.
 */
export async function fileContent_getPipelineBinary(filePath: string): Promise<Result<Buffer>> {
  // Use cumin's pipelineFile_getByPath to download the file as binary
  return await pipelineFile_getByPath(filePath);
}
