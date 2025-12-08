/**
 * @file Pipeline-related business logic
 * @module
 */
import { chrisConnection, errorStack, FilteredResourceData, Result, Ok, Err } from '@fnndsc/cumin';
import axios from 'axios';

/**
 * Lists pipelines.
 *
 * @param options - List options.
 * @returns A Promise resolving to FilteredResourceData or null.
 */
export async function pipelines_list(
  options: Record<string, unknown> = {}
): Promise<FilteredResourceData | null> {
  const client = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push('error', 'Not connected to ChRIS');
    return null;
  }

  try {
    const pipelines = await client.getPipelines(options);
    if (pipelines && pipelines.data) {
      return {
        tableData: pipelines.data,
        selectedFields: Object.keys(pipelines.data[0] || {}),
      };
    }
    return null;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `Failed to list pipelines: ${msg}`);
    return null;
  }
}

/**
 * Gets the content of a pipeline source file from a URL.
 * @param url - The URL of the source file.
 * @returns A Promise resolving to the file content as a string, or null on failure.
 */
export async function pipeline_getContent(url: string): Promise<Result<string>> {
  const token = await chrisConnection.authToken_get();
  if (!token) {
    errorStack.stack_push('error', 'Not connected to ChRIS');
    return Err();
  }

  try {
    const response = await axios.get(url, { headers: { Authorization: `Token ${token}` } });
    return Ok(response.data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `Failed to get pipeline content: ${msg}`);
    return Err();
  }
}
