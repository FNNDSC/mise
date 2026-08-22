/**
 * @file Bounded retry with backoff.
 *
 * The one implementation of the attempt-count-plus-backoff loop that was
 * previously reimplemented independently at every call site that talks to a
 * service that browns out under load (retrieve firing, storage resolution,
 * query polling). See docs/code-audit-2026-08.adoc, finding 2.
 *
 * @module
 */

/**
 * Runs `fn` up to `attempts` times, sleeping between attempts, until it
 * yields a non-null value.
 *
 * The delay before retry N (1-based) is `delaysMs[N-1]`, with the last entry
 * reused when attempts outnumber delays; no sleep precedes the first attempt.
 *
 * @param attempts - Maximum number of attempts (at least 1).
 * @param delaysMs - Backoff delays in milliseconds between attempts.
 * @param fn - The operation; `null` means "failed, retry if attempts remain".
 *   Receives the 0-based attempt index.
 * @returns The first non-null value, or null when every attempt failed.
 *
 * @example
 * ```
 * const record = await retry_untilValue(3, [250, 500], () => record_fetch(id));
 * ```
 */
export async function retry_untilValue<T>(
  attempts: number,
  delaysMs: readonly number[],
  fn: (attempt: number) => Promise<T | null>,
): Promise<T | null> {
  const sleep = (ms: number): Promise<void> => new Promise((r: (v: void) => void) => setTimeout(r, ms));
  for (let attempt: number = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await sleep(delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] ?? 0);
    }
    const value: T | null = await fn(attempt);
    if (value !== null) return value;
  }
  return null;
}
