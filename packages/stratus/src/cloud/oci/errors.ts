/**
 * @file How an OCI SDK error is read, without loading the SDK: a module the
 * build calls and the builder both use.
 *
 * @module
 */

/**
 * Whether an SDK error is a not-found.
 *
 * @param error - The error.
 * @returns True for a 404.
 */
export function notFound(error: unknown): boolean {
  return (error as { statusCode?: number }).statusCode === 404;
}
