import { pacsQuery_resultDecode as cumin_pacsQuery_resultDecode, PACSQueryDecodedResult, Result } from "@fnndsc/cumin";

/**
 * Decode the result payload of a PACS query by ID.
 *
 * @param queryId - PACS query ID.
 * @returns Result containing decoded payload (raw, decoded buffers/text/json) or Err.
 */
export async function pacsQuery_resultDecode(
  queryId: number
): Promise<Result<PACSQueryDecodedResult>> {
  return cumin_pacsQuery_resultDecode(queryId);
}
