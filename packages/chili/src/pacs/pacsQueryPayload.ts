/**
 * @file Pure builder for PACS query creation payloads.
 *
 * Accepts a JSON string or comma-separated `key:value` pairs. Dependency-free
 * (type-only import) for easy unit testing.
 *
 * @module
 */
import type { PACSQueryCreateData } from "@fnndsc/cumin";

/**
 * Builds a PACS query payload from either a JSON string or comma-separated
 * `key:value` pairs.
 *
 * @param queryInput - JSON or comma-separated key:value query specification.
 * @param title - Optional query title (defaults to a timestamped title).
 * @param description - Optional query description.
 * @returns The payload, or null if no usable query fields were parsed.
 */
export function pacsQueryPayload_build(
  queryInput: string,
  title?: string,
  description?: string
): PACSQueryCreateData | null {
  let queryObject: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(queryInput);
    if (typeof parsed === "object" && parsed !== null) {
      queryObject = parsed as Record<string, string>;
    }
  } catch {
    // Fallback to comma-separated key:value pairs
    queryObject = queryInput.split(",").reduce<Record<string, string>>((acc, part) => {
      const [keyRaw, ...rest] = part.split(":");
      if (!keyRaw || rest.length === 0) {
        return acc;
      }
      const key: string = keyRaw.trim();
      const value: string = rest.join(":").trim();
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    }, {});
  }

  if (Object.keys(queryObject).length === 0) {
    return null;
  }

  const payload: PACSQueryCreateData = {
    title: title || `Query ${Date.now()}`,
    query: JSON.stringify(queryObject),
  };
  if (description) {
    payload.description = description;
  }
  return payload;
}
