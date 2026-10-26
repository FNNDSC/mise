/**
 * @file The working directory a line stands in.
 *
 * It is read once, when the line first asks, and kept for the rest of it.
 * Lines run side by side, and a read that began in one folder must not
 * finish in another because a `cd` ran beside it (#1273). A line's own `cd`
 * moves it, and the session with it (`session.setCWD`).
 *
 * @module
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** Where a line stands, once it has asked. */
export interface LineCwd {
  cwd: string | null;
  /**
   * Whether its `cd` is its own: a joblet's is, as a subshell's is, and the
   * session stays where it was.
   */
  own: boolean;
}

const cwdScope: AsyncLocalStorage<LineCwd> = new AsyncLocalStorage<LineCwd>();

/**
 * Runs a line standing where the session stands when it first asks.
 *
 * @param operation - The line.
 * @param cwd - Where it stands from the start, its `cd`s its own (a
 *   joblet, where it was started); null to read the session's when it first
 *   asks, its `cd`s the session's.
 * @returns What the line returns.
 */
export async function cwdScope_run<T>(operation: () => Promise<T>, cwd: string | null = null): Promise<T> {
  // A line inside one that already stands somewhere (a joblet's) stands there too.
  if (cwd === null && cwdScope.getStore() !== undefined) return await operation();
  return await cwdScope.run({ cwd, own: cwd !== null }, operation);
}

/**
 * Where the running line stands.
 *
 * @returns Its slot, or undefined outside any line.
 */
export function lineCwd_get(): LineCwd | undefined {
  return cwdScope.getStore();
}
