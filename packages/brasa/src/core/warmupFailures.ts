/**
 * @file Warm-up steps that failed behind the prompt.
 *
 * A warm-up moved off the boot gate reports its failure afterwards, and a
 * boot readout has scrolled away by then. So a failure is held here until
 * a later attempt succeeds, and every surface reads it from the prompt
 * context: a message that vanishes is one nobody acts on.
 *
 * Kept free of imports so it can be unit tested; the engine graph cannot
 * be loaded under jest.
 *
 * @module
 */

/**
 * One warm-up step that failed and has not since succeeded.
 *
 * @property label - The boot-step label, as the readout named it.
 * @property message - What the failure said.
 */
export interface WarmupFailure {
  label: string;
  message: string;
}

/** Failures by label, so a later attempt replaces rather than repeats. */
const failures: Map<string, string> = new Map();

/**
 * Records that a deferred warm-up step failed.
 *
 * @param label - The boot-step label.
 * @param message - What the failure said.
 */
export function warmupFailure_note(label: string, message: string): void {
  failures.set(label, message);
}

/**
 * Records that a step succeeded, clearing any failure it was holding.
 *
 * @param label - The boot-step label.
 */
export function warmupFailure_clear(label: string): void {
  failures.delete(label);
}

/**
 * The failures still outstanding, in the order they were first recorded.
 *
 * @returns One entry per step that failed and has not since succeeded.
 */
export function warmupFailures_list(): WarmupFailure[] {
  return Array.from(failures, ([label, message]: [string, string]): WarmupFailure => ({ label, message }));
}

/** Forgets every recorded failure (tests, and a session starting over). */
export function warmupFailures_reset(): void {
  failures.clear();
}
