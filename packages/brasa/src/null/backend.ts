/**
 * @file The null backend: a session with no commands of its own and a
 * filesystem held in memory.
 *
 * It is the standing proof that the core is neutral. A session over it runs
 * the core shell (the file tools, navigation, pipes, redirection, help, the
 * games shelf) and nothing else; it loads none of the ChRIS packages.
 *
 * @module
 */
import { MemoryVfsProvider, VFSDispatcher, type MemorySeed } from '@fnndsc/fond';
import type { Backend, SessionIdentity, TaskSource } from '../core/backend.js';

/** What a null session starts with. */
export interface NullBackendOptions {
  /** The session's user; `user` when not given. */
  user?: string;
  /** What the filesystem holds at the start, by path (null for a folder). The home folder is always there. */
  seed?: MemorySeed;
  /** Task sources the session shows under `/proc`, as a backend would bring them. */
  tasks?: ReadonlyArray<TaskSource>;
}

/**
 * Makes a null backend. Its home is `/home/<user>`; its working directory
 * lives only as long as the session.
 *
 * @param options - The user and what the filesystem holds.
 * @returns The backend, ready for `engine_create`.
 */
export function nullBackend_make(options: NullBackendOptions = {}): Backend {
  const user: string = options.user ?? 'user';
  const home: string = `/home/${user}`;
  const store: MemoryVfsProvider = new MemoryVfsProvider('', { [home]: null, ...(options.seed ?? {}) }, user);
  const identity: SessionIdentity = { user, where: 'memory', connected: true };
  let cwd: string | null = null;
  return {
    id: 'null',
    session: {
      init: async (): Promise<void> => undefined,
      identity_get: async (): Promise<SessionIdentity> => identity,
      user_get: async (): Promise<string | null> => user,
      home_get: async (): Promise<string> => home,
      cwd_load: async (): Promise<string | null> => cwd,
      cwd_save: async (path: string): Promise<void> => {
        cwd = path;
      },
    },
    vfs: { dispatcher: new VFSDispatcher(store) },
    ...(options.tasks !== undefined ? { tasks: options.tasks } : {}),
  };
}
