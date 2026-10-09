/**
 * @file The ChRIS backend's descriptor: a session over a CUBE.
 *
 * The identity's context (cumin's per-user, per-CUBE configuration) holds the
 * working directory; the home is the CUBE user's home. The CUBE connection
 * the ChRIS commands use is reached as `session.connection`, which this
 * module adds to the session.
 *
 * @module
 */
import { chrisConnection, chrisConnection_init, NodeStorageProvider, chrisContext, Context } from '@fnndsc/cumin';
import type { Backend } from '../core/backend.js';
import { Session } from '../session/index.js';
import { homePath_of } from '../builtins/utils.js';

declare module '../session/index.js' {
  interface Session {
    /** The CUBE connection the ChRIS commands use. */
    readonly connection: typeof chrisConnection;
  }
}

let connection: typeof chrisConnection | undefined;

Object.defineProperty(Session.prototype, 'connection', {
  get(): typeof chrisConnection {
    return connection || chrisConnection;
  },
  configurable: true,
});

/** The ChRIS backend: a session over a CUBE. */
export const chrisBackend: Backend = {
  id: 'chris',
  session: {
    async init(): Promise<void> {
      const nodeStorageProvider: NodeStorageProvider = new NodeStorageProvider();
      // Initialize the connection singleton which also initializes config
      connection = await chrisConnection_init(nodeStorageProvider);

      try {
        // Also initialize chili's duplicate copy of the connection singleton to align monorepo package boundaries
        const { chrisConnection_init: chiliConnection_init } = await import('@fnndsc/chili/utils');
        await chiliConnection_init(nodeStorageProvider);
      } catch (e: unknown) {
        // Deliberate absorption, adjudicated 2026-08: chili's connection init
        // is an optional secondary wiring (cumin's own init is the required
        // one); when it is absent or fails, chili paths fall back to cumin's
        // connection at call time.
      }
    },
    async home_get(): Promise<string> {
      return homePath_of(await chrisContext.current_get(Context.ChRISuser));
    },
    async cwd_load(): Promise<string | null> {
      return chrisContext.current_get(Context.ChRISfolder);
    },
    async cwd_save(path: string): Promise<void> {
      // Cache invalidation is handled automatically by cumin's chrisContext.
      await chrisContext.current_set(Context.ChRISfolder, path);
    },
  },
};
