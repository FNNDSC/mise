/**
 * @file The backend descriptor: everything a session needs that the core does
 * not know.
 *
 * The engine runs over exactly one backend (docs/backend-neutral.adoc). The
 * core asks it to prepare its own state, where the session's home is, and
 * where the working directory was left, what the prompt shows and what the
 * daemon heartbeats. ChRIS is one backend
 * (`chris/backend.ts`), installed by the package entry; a host may install
 * another before the engine boots.
 *
 * @module
 */
import type { PromptContext, CubeTelemetry, JobsStateTelemetry } from '@fnndsc/menu';

/**
 * Who a session is and where: the input a host keys the session by (calypso's
 * berth name is `user@where`, normalised).
 *
 * A disconnected session still has one, so it stays discoverable; each
 * backend names its own (`where` naming the backend), so two backends'
 * disconnected sessions never share a name.
 */
export interface SessionIdentity {
  /** The user, exactly as the backend knows them. */
  readonly user: string;
  /** Where the session lives: a server URL, or a name for no server. */
  readonly where: string;
  /** Whether the session is connected to `where`. */
  readonly connected: boolean;
}

/** What a backend tells the core about the session it serves. */
export interface BackendSession {
  /** Prepares the backend's own state (configuration, stored credentials) before the session starts. */
  init(): Promise<void>;
  /** Who the session is, connected or not. */
  identity_get(): Promise<SessionIdentity>;
  /** The session's home: where it begins before it has a working directory of its own. */
  home_get(): Promise<string>;
  /** The working directory the identity left, or null when it has none stored. */
  cwd_load(): Promise<string | null>;
  /** Stores the working directory for the identity. */
  cwd_save(path: string): Promise<void>;
}

/** What the core knows about the previous command, for the prompt. */
export interface PromptLastCommand {
  lastExitCode?: number;
  lastCommandDurationMs?: number;
}

/**
 * What a daemon heartbeats about the backend's own state, in the wire's
 * telemetry shape: the index counts, the server's pace, the work in flight.
 */
export interface BackendTelemetry {
  jobs: number;
  feeds: number;
  cube?: CubeTelemetry;
  state?: JobsStateTelemetry;
}

/** One backend, as the core sees it. */
export interface Backend {
  /** Stable id naming the backend. */
  readonly id: string;
  /** The session it serves. */
  readonly session: BackendSession;
  /** The session facts a prompt shows, in the wire's prompt context. */
  readonly prompt?: (last?: PromptLastCommand) => Promise<PromptContext>;
  /** The daemon's heartbeat about the backend's state; read often, so it is cheap. */
  readonly telemetry?: () => BackendTelemetry;
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
