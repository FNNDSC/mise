/**
 * @file The backend descriptor: everything a session needs that the core does
 * not know.
 *
 * The engine runs over exactly one backend (docs/backend-neutral.adoc). The
 * core asks it to prepare its own state, where the session's home is, and
 * where the working directory was left. ChRIS is one backend
 * (`chris/backend.ts`), installed by the package entry; a host may install
 * another before the engine boots.
 *
 * @module
 */

/** What a backend tells the core about the session it serves. */
export interface BackendSession {
  /** Prepares the backend's own state (configuration, stored credentials) before the session starts. */
  init(): Promise<void>;
  /** The session's home: where it begins before it has a working directory of its own. */
  home_get(): Promise<string>;
  /** The working directory the identity left, or null when it has none stored. */
  cwd_load(): Promise<string | null>;
  /** Stores the working directory for the identity. */
  cwd_save(path: string): Promise<void>;
}

/** One backend, as the core sees it. */
export interface Backend {
  /** Stable id naming the backend. */
  readonly id: string;
  /** The session it serves. */
  readonly session: BackendSession;
}

let installed: Backend | null = null;

/**
 * Installs the session's backend. The last install wins; a host installs
 * before the engine boots.
 *
 * @param backend - The backend the session runs over.
 */
export function backend_install(backend: Backend): void {
  installed = backend;
}

/**
 * The installed backend.
 *
 * @returns The backend the session runs over.
 * @throws Error when no backend is installed: the session cannot run without one.
 */
export function backend_get(): Backend {
  if (installed === null) {
    throw new Error('brasa: no backend installed; install one with backend_install before the engine boots');
  }
  return installed;
}
