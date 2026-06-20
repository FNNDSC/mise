/**
 * @file Connect/login and logout operations against a ChRIS backend.
 *
 * @module
 */

import { chrisConnection } from "@fnndsc/cumin";

/**
 * Options for connecting to a ChRIS backend (url, username, password).
 */
export interface ConnectOptions {
  user: string;
  password: string;
  debug: boolean;
  url: string;
}

/**
 * Connects and authenticates against a ChRIS backend.
 *
 * @param options - Connection options.
 * @returns True on success, false otherwise.
 */
export async function connect_do(options: ConnectOptions): Promise<boolean> {
  const token: string | null = await chrisConnection.connection_connect(options);
  return token !== null;
}

/**
 * Logs out of the current ChRIS session, clearing stored credentials.
 */
export async function logout_do(): Promise<void> {
  await chrisConnection.connection_logout();
}
