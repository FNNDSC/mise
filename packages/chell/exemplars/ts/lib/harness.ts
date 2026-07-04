/**
 * @file Shared harness for the live-CUBE exemplar programs.
 *
 * Provides environment loading, a hermetic per-run config directory (so a
 * developer's real chell/cumin session is never touched), CUBE connection,
 * lightweight ✓/✗ assertion tracking, and the admin-credentialed cleanup
 * helpers that keep the CUBE invariant: the instance must look the same
 * after a run as before it.
 *
 * Every exemplar is a standalone program: it connects, exercises one
 * scenario through the public cumin/salsa APIs, cleans up after itself,
 * and exits 0 only if every check passed.
 *
 * @module
 */

import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import chalk from 'chalk';
import {
  chrisConnection_init,
  NodeStorageProvider,
  ChRISConnection,
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
 * Loads the CUBE environment, exiting with a usage message when the
 * required variables are absent (exit code 2 = "not configured", so CI can
 * distinguish "skipped" from "failed").
 *
 * @returns The populated environment settings.
 */
export function env_load(): CubeEnv {
  const url: string | undefined = process.env.CUBE_URL;
  const user: string | undefined = process.env.CUBE_USER;
  const password: string | undefined = process.env.CUBE_PASSWORD;

  if (!url || !user || !password) {
    console.log('CUBE_URL, CUBE_USER and CUBE_PASSWORD must be set — skipping.');
    process.exit(2);
  }

  return {
    url,
    user,
    password,
    adminUser: process.env.CUBE_ADMIN_USER,
    adminPassword: process.env.CUBE_ADMIN_PASSWORD,
    pacs: process.env.CUBE_PACS ?? 'PACSDCM',
    accession: process.env.CUBE_TEST_ACCESSION ?? '12345678',
  };
}

/**
 * Points cumin's config at a fresh temporary directory so the run never
 * reads or writes the developer's real session. Call before cube_connect.
 */
export function config_isolate(): void {
  process.env.XDG_CONFIG_HOME = mkdtempSync(path.join(tmpdir(), 'chell-exemplar-'));
}

/**
 * Initializes the cumin connection layer and logs into the CUBE.
 *
 * @param env - The loaded environment settings.
 * @returns The auth token.
 * @throws {Error} When authentication fails.
 */
/** The connection established by cube_connect, for use across the run. */
let activeConnection: ChRISConnection | null = null;

export async function cube_connect(env: CubeEnv): Promise<string> {
  // Use the instance returned by init: cumin reassigns its module-level
  // singleton, and ESM named imports of a CJS module do not track that.
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
 * Records and prints one assertion.
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
 * Deletes a filebrowser folder (and its contents) by id.
 *
 * PACS series folders under SERVICES/PACS are owned by the CUBE admin, so
 * pass an admin token to satisfy the after-equals-before invariant when
 * cleaning up pulled DICOM data. chrisapi has no delete-by-path wrapper for
 * this, hence the raw REST call — itself an exemplar of dropping down to
 * the API when the client lags.
 *
 * @param url - CUBE API base URL.
 * @param token - Auth token of the folder owner (admin for PACS folders).
 * @param folderId - The filebrowser folder id.
 * @returns True when the CUBE accepted the deletion.
 */
export async function folder_deleteById(url: string, token: string, folderId: number): Promise<boolean> {
  const response: Response = await fetch(`${url}filebrowser/${folderId}/`, {
    method: 'DELETE',
    headers: { Authorization: `Token ${token}` },
  });
  return response.status === 202 || response.status === 204;
}

/**
 * Deletes a PACSQuery record by id over the raw REST API.
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
