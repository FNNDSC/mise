/**
 * @file What a porter is told, and what it assumes when it is not.
 *
 * A porter stands in front of ONE CUBE: the door asks for a username and a
 * password and never for a server, because a page that asks where to send
 * a password is a phishing form with a logo on it. The CUBE, the state
 * directory, the bind address and the chell to start are the deployment's
 * facts, read from the environment once at start.
 *
 * @module
 */
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Everything a porter needs to know, resolved. */
export interface PorterConfig {
  /** The one CUBE this door serves, API base with its trailing slash. */
  cubeUrl: string;
  /** Where each identity's four directories live, one subtree per identity. */
  stateDir: string;
  /** The address the porter listens on; loopback unless a front says otherwise. */
  host: string;
  /** The port the porter listens on. */
  port: number;
  /** The chell entry to start a session with (`dist/index.js`). */
  chellEntry: string;
}

/** The environment variables a porter reads, and no others. */
export interface PorterEnv {
  PORTER_CUBE_URL?: string;
  PORTER_STATE_DIR?: string;
  PORTER_HOST?: string;
  PORTER_PORT?: string;
  PORTER_CHELL?: string;
  XDG_STATE_HOME?: string;
}

/** The port a porter takes when told none. */
export const PORTER_DEFAULT_PORT: number = 4180;

/**
 * Finds the chell this porter will start sessions with: the one installed
 * beside it, by the package's own entry.
 *
 * @returns The absolute path of chell's entry script.
 */
export function chellEntry_locate(): string {
  const require: NodeRequire = createRequire(import.meta.url);
  return require.resolve('@fnndsc/chell');
}

/**
 * Resolves the porter's configuration from the environment.
 *
 * @param env - The environment; `process.env` in production.
 * @param locateChell - How to find chell when the environment does not say.
 * @returns The resolved configuration.
 * @throws {Error} When the one fact with no default — the CUBE — is missing
 *   or not a URL, or the port is not a number.
 */
export function porterConfig_resolve(env: PorterEnv, locateChell: () => string = chellEntry_locate): PorterConfig {
  const cubeUrl: string | undefined = env.PORTER_CUBE_URL;
  if (cubeUrl === undefined || cubeUrl.length === 0) {
    throw new Error('PORTER_CUBE_URL is required: the one CUBE this door serves, e.g. https://cube.example.org/api/v1/');
  }
  try {
    new URL(cubeUrl);
  } catch {
    throw new Error(`PORTER_CUBE_URL is not a URL: ${cubeUrl}`);
  }
  const portText: string = env.PORTER_PORT ?? String(PORTER_DEFAULT_PORT);
  const port: number = Number(portText);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORTER_PORT is not a port: ${portText}`);
  }
  const stateBase: string = env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return {
    cubeUrl: cubeUrl.endsWith('/') ? cubeUrl : `${cubeUrl}/`,
    stateDir: env.PORTER_STATE_DIR ?? join(stateBase, 'porter'),
    host: env.PORTER_HOST ?? '127.0.0.1',
    port,
    chellEntry: env.PORTER_CHELL ?? locateChell(),
  };
}
