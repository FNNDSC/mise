/**
 * @file The stratus backend: the descriptor a session over a cloud runs with.
 *
 * One backend for every cloud (docs/stratus.adoc, D1): its id is `stratus`,
 * its filesystem is the tenancy tree over whichever driver it was given, its
 * identity the cloud user at the tenancy. It registers no commands yet and
 * no answer kinds (every row is a folder or a file, D5); the prompt is the
 * wire's ChRIS-shaped context filled with what a substrate session has,
 * until the segments of D9 land.
 *
 * @module
 */
import type { Backend, PromptLastCommand } from '@fnndsc/brasa/core';
import { VFSDispatcher } from '@fnndsc/fond';
import type { PromptContext } from '@fnndsc/menu';
import type { CloudDriver } from './cloud/driver.js';
import { AnswerCache } from './cache.js';
import { StratusSession } from './session.js';
import { TenancyProvider } from './vfs/tenancy.js';
import { stratusListingLook } from './vfs/look.js';

/** How the backend is made. */
export interface StratusBackendOptions {
  /** The cloud. */
  readonly driver: CloudDriver;
  /** The region the session works in; the credential's home region when absent. */
  readonly region?: string;
  /** Where the working directory is kept. */
  readonly configDir?: string;
  /** How long the tree keeps a cloud answer, in milliseconds. */
  readonly cacheLifeMs?: number;
}

/** The backend and the pieces a host may reach into. */
export interface StratusBackend {
  readonly backend: Backend;
  readonly session: StratusSession;
  readonly tenancy: TenancyProvider;
}

/**
 * Makes the stratus backend over a driver.
 *
 * @param options - The driver and the session's settings.
 * @returns The backend, ready for `engine_create`, with its session and tree.
 */
export function stratusBackend_make(options: StratusBackendOptions): StratusBackend {
  const session: StratusSession = new StratusSession({ driver: options.driver, region: options.region, configDir: options.configDir });
  const tenancy: TenancyProvider = new TenancyProvider({ driver: options.driver, cache: new AnswerCache(options.cacheLifeMs) });
  const dispatcher: VFSDispatcher = new VFSDispatcher();
  dispatcher.provider_register(tenancy);
  const backend: Backend = {
    id: 'stratus',
    session,
    vfs: {
      dispatcher,
      structural: ['/', '/net', session.mount],
    },
    completion: { rootWords: ['net'] },
    listingLook: stratusListingLook,
    prompt: async (last?: PromptLastCommand): Promise<PromptContext> => ({
      user: (await session.user_get()) ?? 'disconnected',
      uri: session.identity?.tenancy ?? '',
      cwd: session.cwd_get() ?? (await session.home_get()),
      pacsserver: null,
      physicalMode: false,
      lastExitCode: last?.lastExitCode ?? 0,
      lastCommandDurationMs: last?.lastCommandDurationMs ?? 0,
    }),
  };
  return { backend, session, tenancy };
}
