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
}

const cwdScope: AsyncLocalStorage<LineCwd> = new AsyncLocalStorage<LineCwd>();

/**
 * Runs a line standing where the session stands when it first asks.
 *
 * @param operation - The line.
 * @returns What the line returns.
 */
export async function cwdScope_run<T>(operation: () => Promise<T>): Promise<T> {
  return await cwdScope.run({ cwd: null }, operation);
}

/**
 * Where the running line stands.
 *
 * @returns Its slot, or undefined outside any line.
 */
export function lineCwd_get(): LineCwd | undefined {
  return cwdScope.getStore();
}
