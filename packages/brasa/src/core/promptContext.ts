/**
 * @file The session's prompt context: the engine-known facts a prompt reflects.
 *
 * A prompt shows live session state — user, CUBE, working directory, PACS,
 * physical-mode, warm-up progress — plus the last command's outcome. Only the
 * process holding the session can know these, but how they are *rendered*
 * (theme, segments, terminal width) is a frontend concern. This module builds
 * the engine half; each frontend renders it with its own theme, so the daemon
 * ships context and never a themed string.
 *
 * @module
 */

import { session } from '../session/index.js';
import { context_getSingle } from '@fnndsc/salsa';
import {
  SingleContext,
  procCache_get,
  type ProcCacheLifecycle,
  type ProcPromptProgress,
  type ProcPromptState,
  type ProcWarmupProgress,
} from '@fnndsc/cumin';

/**
 * The engine-known facts a prompt reflects, independent of any theme.
 *
 * This is the shape carried over the wire to remote frontends. Rendering
 * inputs a frontend owns (terminal width, enabled segments, theme) are not
 * here — each surface supplies its own.
 */
export interface SessionPromptContext {
  user: string;
  uri: string;
  cwd: string;
  pacsserver: string | null;
  physicalMode: boolean;
  lastExitCode: number;
  lastCommandDurationMs: number;
  /** Present while /proc indexing is active, reconciling, or has failed. */
  procWarmup?: ProcPromptProgress;
  /** Steady-state index counts, present whenever the cache holds anything. */
  procIndex?: { jobs: number; feeds: number };
  /** The daemon's declared host-control tiers, when it acts on its own host. */
  hostControl?: string[];
}

/**
 * Inputs the caller knows that the session state does not.
 *
 * @property lastExitCode - The previous command's exit code (default 0).
 * @property lastCommandDurationMs - The previous command's duration (default 0).
 */
export interface SessionPromptContextOptions {
  lastExitCode?: number;
  lastCommandDurationMs?: number;
}

/**
 * Snapshots the live process-index counts, cheaply: no network, just the
 * cache's own registers. The daemon's telemetry heartbeat reads this.
 *
 * @returns The jobs and feeds the index currently holds.
 */
export function procIndex_snapshot(): { jobs: number; feeds: number } {
  const cache = procCache_get();
  return {
    jobs: cache.warmupProgress_get().loaded,
    feeds: cache.feedScopeCounts_get('').total,
  };
}

/**
 * Builds the current session's prompt context.
 *
 * @param options - The last-command inputs the session cannot know.
 * @returns The engine-known prompt facts.
 */
export async function sessionPromptContext_build(
  options: SessionPromptContextOptions = {},
): Promise<SessionPromptContext> {
  const context: SingleContext = await context_getSingle();
  const cwd: string = await session.getCWD();
  const isOffline: boolean = session.offline;

  const warmupRaw: ProcWarmupProgress = procCache_get().warmupProgress_get();
  const lifecycle: ProcCacheLifecycle = procCache_get().lifecycle_get();
  const restored: boolean = lifecycle.checkpointAt !== undefined;
  const procState: ProcPromptState = lifecycle.state === 'failed'
    ? 'failed'
    : restored ? 'cached' : 'cold';
  const procWarmup: ProcPromptProgress | undefined =
    warmupRaw.active || lifecycle.state === 'reconciling' || lifecycle.state === 'failed'
      ? { loaded: warmupRaw.loaded, total: warmupRaw.total, restored, state: procState }
      : undefined;
  // Steady-state counts stay visible after warm-up settles: warmup progress
  // retains its final figures, and the feed map is the live index.
  const procIndex: { jobs: number; feeds: number } | undefined =
    warmupRaw.loaded > 0 || procCache_get().feedScopeCounts_get(context.user ?? '').total > 0
      ? {
          jobs: warmupRaw.loaded,
          feeds: procCache_get().feedScopeCounts_get(context.user ?? '').total,
        }
      : undefined;

  return {
    user:                  isOffline ? 'disconnected' : (context.user ?? 'disconnected'),
    uri:                   isOffline ? 'no-cube'      : (context.URL  ?? 'no-cube'),
    cwd:                   isOffline ? '/'            : cwd,
    pacsserver:            context.pacsserver ?? null,
    physicalMode:          session.physicalMode_get(),
    lastExitCode:          options.lastExitCode ?? 0,
    lastCommandDurationMs: options.lastCommandDurationMs ?? 0,
    procWarmup,
    procIndex,
  };
}
