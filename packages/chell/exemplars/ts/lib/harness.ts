/**
 * @file Shared harness for the live-CUBE exemplar programs.
 *
 * The exemplars are written as flat sequences of small steps. Three ideas
 * keep them flat and honest:
 *
 * - every fallible step returns a cumin `Result<T>`, surfaced through
 *   `step()`, which prints one ✓/✗ line and lets the caller bail early;
 * - cleanup is declared at acquisition: the moment a program creates a
 *   CUBE resource it registers the undo on a `CleanupPlan`, which runs
 *   last-in-first-out in the program's `finally` — so the CUBE ends the
 *   run exactly as it began, even after a mid-run failure;
 * - waiting is one reusable `poll_until()` rather than bespoke loops.
 *
 * Also here: environment loading, a hermetic per-run config directory (a
 * developer's real chell/cumin session is never touched), CUBE login, and
 * the raw-REST helpers for the few operations chrisapi has no wrapper for.
 *
 * @module
 */

import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import {
  chrisConnection_init,
  NodeStorageProvider,
  ChRISConnection,
  Result,
  Ok,
  Err,
} from '@fnndsc/cumin';

/**
 * Connection and test-target settings, sourced from the environment.
 *
 * @property url - CUBE API base URL (e.g. `http://cube:8000/api/v1/`).
 * @property user - Regular test-user login.
 * @property password - Regular test-user password.
 * @property adminUser - Admin login, needed only for PACS-file cleanup.
 * @property adminPassword - Admin password.
 * @property pacs - PACS server identifier to query against.
 * @property accession - AccessionNumber of the designated test study.
 */
export interface CubeEnv {
  url: string;
  user: string;
  password: string;
  adminUser?: string;
  adminPassword?: string;
  pacs: string;
  accession: string;
}

/**
 * Applies `exemplars/e2e.config.json` as environment defaults.
 *
 * Instance-specific test data — the CUBE URL, logins, and above all the
 * designated test accession — must never be committed; it lives in this
 * gitignored file (see `e2e.config.example.json`), keyed by the same
 * `CUBE_*` names as the environment. Real environment variables win, so
 * CI (which injects secrets as env) needs no file at all.
 */
function configFile_applyToEnv(): void {
  const here: string = path.dirname(fileURLToPath(import.meta.url));
  const configPath: string = path.resolve(here, '../../..', 'e2e.config.json');
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, string>;
  } catch {
    return; // No config file: environment variables only.
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (key.startsWith('CUBE_') && !process.env[key]) process.env[key] = String(value);
  }
}

/**
 * Loads the CUBE settings from the environment, with
 * `exemplars/e2e.config.json` supplying defaults. Exits with a usage
 * message when required values are absent (exit code 2 = "not
 * configured", so CI can distinguish "skipped" from "failed").
 *
 * @returns The populated environment settings.
 */
export function env_load(): CubeEnv {
  configFile_applyToEnv();

  const url: string | undefined = process.env.CUBE_URL;
  const user: string | undefined = process.env.CUBE_USER;
  const password: string | undefined = process.env.CUBE_PASSWORD;
  const accession: string | undefined = process.env.CUBE_TEST_ACCESSION;

  if (!url || !user || !password) {
    console.log('CUBE_URL, CUBE_USER and CUBE_PASSWORD must be set (env or exemplars/e2e.config.json) — skipping.');
    process.exit(2);
  }
  if (!accession) {
    console.log('CUBE_TEST_ACCESSION must identify a designated test study on your instance — skipping.');
    process.exit(2);
  }

  return {
    url,
    user,
    password,
    adminUser: process.env.CUBE_ADMIN_USER,
    adminPassword: process.env.CUBE_ADMIN_PASSWORD,
    pacs: process.env.CUBE_PACS ?? 'PACSDCM',
    accession,
  };
}

/**
 * Exits with the "not configured" code when admin credentials are absent.
 * Exemplars that delete PACS folders call this right after `env_load`.
 *
 * @param env - The loaded environment settings.
 */
export function adminEnv_require(env: CubeEnv): void {
  if (!env.adminUser || !env.adminPassword) {
    console.log('CUBE_ADMIN_USER and CUBE_ADMIN_PASSWORD must be set for PACS cleanup — skipping.');
    process.exit(2);
  }
}

/**
 * Points cumin's config at a fresh temporary directory so the run never
 * reads or writes the developer's real session. Call before cube_connect.
 */
export function config_isolate(): void {
  process.env.XDG_CONFIG_HOME = mkdtempSync(path.join(tmpdir(), 'chell-exemplar-'));
}

/** The connection established by cube_connect, for use across the run. */
let activeConnection: ChRISConnection | null = null;

/**
 * Initializes the cumin connection layer and logs into the CUBE.
 *
 * @param env - The loaded environment settings.
 * @returns The auth token.
 * @throws {Error} When authentication fails.
 */
export async function cube_connect(env: CubeEnv): Promise<string> {
  const connection: ChRISConnection = await chrisConnection_init(new NodeStorageProvider());
  const token: string | null = await connection.connection_connect({
    user: env.user,
    password: env.password,
    url: env.url,
    debug: true,
  });
  if (!token) {
    throw new Error('CUBE authentication failed');
  }
  activeConnection = connection;
  return token;
}

/**
 * Returns the connection established by `cube_connect`.
 *
 * @returns The active connection.
 * @throws {Error} When called before cube_connect.
 */
export function connection_active(): ChRISConnection {
  if (!activeConnection) {
    throw new Error('cube_connect must run before connection_active');
  }
  return activeConnection;
}

/** Number of failed checks so far (drives the exit code). */
let failures: number = 0;
/** Number of checks executed so far. */
let checks: number = 0;

/**
 * Records and prints one boolean assertion.
 *
 * @param description - What is being asserted.
 * @param condition - The assertion outcome.
 * @returns The condition, so callers can branch on it.
 */
export function check(description: string, condition: boolean): boolean {
  checks++;
  if (condition) {
    console.log(chalk.green(`  ✓ ${description}`));
  } else {
    failures++;
    console.log(chalk.red(`  ✗ ${description}`));
  }
  return condition;
}

/**
 * Awaits a fallible step and records its outcome as one ✓/✗ line.
 *
 * The idiom in every exemplar is:
 * ```
 * const thing: Result<Thing> = await step('made a thing', thing_make());
 * if (!thing.ok) return;
 * ```
 *
 * @param description - What the step accomplishes.
 * @param action - The pending Result.
 * @returns The same Result, for early-return flow.
 */
export async function step<T>(description: string, action: Promise<Result<T>>): Promise<Result<T>> {
  const result: Result<T> = await action;
  check(description, result.ok);
  return result;
}

/**
 * Prints a section banner.
 *
 * @param title - The section title.
 */
export function section(title: string): void {
  console.log(chalk.bold(`\n== ${title}`));
}

/**
 * Prints the run summary and exits: 0 when all checks passed, 1 otherwise.
 */
export function summary_exit(): never {
  console.log(
    failures === 0
      ? chalk.green(`\nPASS: ${checks}/${checks} checks`)
      : chalk.red(`\nFAIL: ${checks - failures}/${checks} checks passed`),
  );
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * Builds a unique, greppable run identifier used to tag every resource an
 * exemplar creates (feeds, folders, query titles).
 *
 * @returns A short run id (e.g. `e2e-lx3k9f2a`).
 */
export function runId_make(): string {
  return `e2e-${Date.now().toString(36)}`;
}

/**
 * Sleeps for the given number of milliseconds.
 *
 * @param ms - Milliseconds to sleep.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve: (v: void) => void) => setTimeout(resolve, ms));
}

/**
 * Polls a probe until it yields a value or the deadline passes.
 *
 * @param probe - Returns the awaited value, or null to keep waiting.
 * @param timeoutMs - Give-up horizon.
 * @param intervalMs - Delay between probes.
 * @returns Ok(value) when the probe succeeded, Err on timeout.
 */
export async function poll_until<T>(
  probe: () => Promise<T | null>,
  timeoutMs: number,
  intervalMs: number = 3_000,
): Promise<Result<T>> {
  const deadline: number = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value: T | null = await probe();
    if (value !== null) return Ok(value);
    await sleep(intervalMs);
  }
  return Err();
}

/** One undo action on a CleanupPlan. */
interface CleanupAction {
  description: string;
  undo: () => Promise<boolean>;
}

/**
 * Collects undo actions as resources are created and replays them
 * last-in-first-out, recording each as a ✓/✗ check.
 *
 * Register the undo at the moment of acquisition; run the plan in the
 * program's `finally`. LIFO order means dependent resources unwind before
 * the resources they depend on.
 */
export class CleanupPlan {
  private actions: CleanupAction[] = [];

  /**
   * Registers one undo action.
   *
   * @param description - What the undo does (becomes the check line).
   * @param undo - The undo; resolves true on success.
   */
  register(description: string, undo: () => Promise<boolean>): void {
    this.actions.push({ description, undo });
  }

  /**
   * Removes a previously registered action by description (for undos that
   * turn out not to apply — e.g. restoring a folder that was never deleted).
   *
   * @param description - The registered description.
   */
  unregister(description: string): void {
    this.actions = this.actions.filter((a: CleanupAction) => a.description !== description);
  }

  /**
   * Runs all undo actions in reverse registration order.
   */
  async run(): Promise<void> {
    for (const action of [...this.actions].reverse()) {
      let outcome: boolean = false;
      try {
        outcome = await action.undo();
      } catch {
        outcome = false;
      }
      check(action.description, outcome);
    }
    this.actions = [];
  }
}

/**
 * Requests an auth token for arbitrary credentials over the raw REST API.
 *
 * @param url - CUBE API base URL.
 * @param user - Login name.
 * @param password - Password.
 * @returns The token string.
 * @throws {Error} On a non-OK response.
 */
export async function restToken_get(url: string, user: string, password: string): Promise<string> {
  const response: Response = await fetch(`${url}auth-token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password }),
  });
  if (!response.ok) {
    throw new Error(`auth-token request failed: ${response.status}`);
  }
  const body: { token: string } = (await response.json()) as { token: string };
  return body.token;
}

/**
 * Looks up a filebrowser folder id by CUBE path over the raw REST API.
 *
 * @param url - CUBE API base URL.
 * @param token - Auth token (folder must be visible to its owner).
 * @param folderPath - CUBE path without leading slash.
 * @returns The folder id, or null when the folder does not exist.
 */
export async function folderId_find(url: string, token: string, folderPath: string): Promise<number | null> {
  const search: string = `${url}filebrowser/search/?path=${encodeURIComponent(folderPath)}`;
  const response: Response = await fetch(search, {
    headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const body: { count: number; results: Array<{ id: number }> } =
    (await response.json()) as { count: number; results: Array<{ id: number }> };
  return body.count > 0 ? body.results[0].id : null;
}

/**
 * Deletes a filebrowser folder (and its contents) and waits until the CUBE
 * confirms it is gone — deletion is asynchronous (202 Accepted).
 *
 * PACS series folders under SERVICES/PACS are owned by the CUBE admin, so
 * pass an admin token when cleaning up pulled DICOM data. chrisapi has no
 * delete-by-path wrapper for this, hence the raw REST call — itself an
 * exemplar of dropping down to the API when the client lags.
 *
 * @param url - CUBE API base URL.
 * @param token - Auth token of the folder owner (admin for PACS folders).
 * @param folderPath - CUBE path without leading slash.
 * @returns True when the folder is verifiably gone.
 */
export async function folder_deleteAndConfirm(url: string, token: string, folderPath: string): Promise<boolean> {
  const folderId: number | null = await folderId_find(url, token, folderPath);
  if (folderId === null) return true;

  const response: Response = await fetch(`${url}filebrowser/${folderId}/`, {
    method: 'DELETE',
    headers: { Authorization: `Token ${token}` },
  });
  if (response.status !== 202 && response.status !== 204) return false;

  const gone: Result<boolean> = await poll_until<boolean>(
    async () => ((await folderId_find(url, token, folderPath)) === null ? true : null),
    30_000,
    2_000,
  );
  return gone.ok;
}

/**
 * Deletes a PACSQuery record by id over the raw REST API.
 *
 * Never call this while the query's retrieve is still transferring: the
 * deletion cascades to the retrieve and aborts it.
 *
 * @param url - CUBE API base URL.
 * @param token - Auth token of the query owner.
 * @param queryId - The PACSQuery id.
 * @returns True when deleted.
 */
export async function pacsQuery_deleteById(url: string, token: string, queryId: number): Promise<boolean> {
  const response: Response = await fetch(`${url}pacs/queries/${queryId}/`, {
    method: 'DELETE',
    headers: { Authorization: `Token ${token}` },
  });
  return response.status === 204;
}
