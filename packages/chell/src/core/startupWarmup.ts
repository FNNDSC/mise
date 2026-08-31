/**
 * @file Shared startup cache warming for interactive and daemon ChELL hosts.
 *
 * Warms the VFS and process caches, reports each outcome through a small host
 * seam, and starts non-blocking job-topology warming after the jobs index is
 * available. Daemon startup waits for the blocking cache indexes before
 * publishing its listening berth, then reports topology settlement separately.
 *
 * @module
 */
import {
  error_stripDebugPrefix,
  prefetch_path,
  prefetch_withSpinner,
  repl_question,
  session,
  vfs,
  type BrasaEngine,
  type PrefetchResult,
} from '@fnndsc/brasa';
import {
  daemon_launch,
  face_boot,
  face_ready,
  face_resume,
  face_stop,
  face_suspend,
  identity_forSession,
  type DaemonLaunchInfo,
  type FaceInfo,
  type FaceTelemetry,
} from '@fnndsc/calypso';
import { procIndex_snapshot } from '@fnndsc/brasa';
import { logo_animateStop } from '../lib/logo.js';
import { sink_set, StdoutSink } from '@fnndsc/brasa';
import { TerminalProgressRenderer } from './progressRenderer.js';
import {
  chrisContext,
  errorStack,
  procCache_get,
  procCheckpoint_restore,
  procCheckpoint_watch,
  type ProcCheckpointRestoreResult,
  type ProcWarmupProgress,
  type Result,
  type StackMessage,
} from '@fnndsc/cumin';
import type { ListingItem } from '@fnndsc/chili/models/listing.js';
import {
  procCache_refresh,
  procTopology_reconcileFeeds,
  procTopology_status,
  procTopology_warmup,
  vfsDispatcher,
  type ProcTopologyStatus,
} from '@fnndsc/salsa';
import type { BootStatus } from '../lib/bootsequence.js';

/** Startup cache selections shared by interactive and daemon modes. */
export interface StartupWarmupFlags {
  plugins: boolean;
  feeds: boolean;
  publicFeeds: boolean;
  jobs: boolean;
}

/** Counts and failures produced by startup warming. */
export interface StartupWarmupCache {
  plugins?: number;
  pipelines?: number;
  feeds?: number;
  public?: number;
  failures: string[];
}

/** Minimal status reporter accepted by startup warming. */
export interface StartupWarmupReporter {
  log(status: BootStatus, label: string, message: string): void;
}

/** Number of attempts for a blocking startup cache operation. */
const STARTUP_WARMUP_ATTEMPTS: number = 3;
/** Brief backoff before the second and third startup attempts. */
const STARTUP_WARMUP_RETRY_DELAYS_MS: readonly number[] = [250, 500];

/** Operator choice after a daemon exhausts its startup retries. */
export type DaemonWarmupFailureDecision = 'continue' | 'exit';

/** Injectable operator-decision seam for daemon warm-up failures. */
export type DaemonWarmupRecovery = (failures: string[]) => Promise<DaemonWarmupFailureDecision>;

/** Sentinel used to prevent CALYPSO from binding after the operator exits boot. */
class DaemonWarmupAbortedError extends Error {}

/**
 * Waits briefly between transient startup attempts without retaining a timer.
 *
 * @param attempt - One-based attempt that just failed.
 * @returns Nothing after the corresponding retry delay.
 */
async function startupRetry_wait(attempt: number): Promise<void> {
  const delay: number = STARTUP_WARMUP_RETRY_DELAYS_MS[attempt - 1] ?? 0;
  if (delay === 0) return;
  await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, delay); });
}

/**
 * Runs one blocking warm-up action with a bounded retry policy.
 *
 * @param label - Stable boot-step label.
 * @param message - Description shown while the action is running.
 * @param interactive - Whether an interactive spinner may render.
 * @param reporter - Optional boot-status reporter.
 * @param action - One attempt at the cache operation.
 * @returns The first successful result, or the last failed result.
 */
async function startupPrefetch_retry(
  label: string,
  message: string,
  interactive: boolean,
  reporter: StartupWarmupReporter | null,
  action: () => Promise<PrefetchResult>,
): Promise<PrefetchResult> {
  let last: PrefetchResult = { ok: false, message: 'Warm-up did not run.' };
  for (let attempt: number = 1; attempt <= STARTUP_WARMUP_ATTEMPTS; attempt++) {
    last = await prefetch_withSpinner(label, message, interactive, action);
    if (last.ok || attempt === STARTUP_WARMUP_ATTEMPTS) return last;
    reporter?.log(
      'retry',
      label,
      `Attempt ${attempt}/${STARTUP_WARMUP_ATTEMPTS} failed: ${last.message ?? 'unknown error'}; retrying.`,
    );
    await startupRetry_wait(attempt);
  }
  return last;
}

/**
 * Asks a terminal operator whether a daemon with incomplete caches may start.
 *
 * A non-interactive launch retains the existing availability-first behavior:
 * it starts degraded rather than hanging or silently terminating.
 *
 * @param failures - Labels of cache steps that exhausted their retries.
 * @returns Whether to start degraded or exit before binding the daemon.
 */
async function daemonWarmupFailure_decide(failures: string[]): Promise<DaemonWarmupFailureDecision> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return 'continue';
  try {
    const answer: string = await repl_question(
      `Warm-up incomplete (${failures.join(', ')}). Continue with degraded caches? [c]ontinue/[E]xit: `,
    );
    return /^(c|continue)$/i.test(answer.trim()) ? 'continue' : 'exit';
  } catch {
    return 'exit';
  }
}

/**
 * Warms startup caches and begins non-blocking job-topology warming.
 *
 * @param flags - Resource caches selected by the host's boot flags.
 * @param user - Authenticated username used to construct the feed path.
 * @param interactive - Whether progress may use an interactive spinner.
 * @param reporter - Host status logger, or null for silent status reporting.
 * @param reportTopologySettlement - Whether to report the asynchronous topology
 *   result; daemon hosts enable this, while interactive hosts use prompt progress.
 * @returns Cache counts and the labels of any failed warm-up operations.
 */
export async function startupWarmup_run(
  flags: StartupWarmupFlags,
  user: string | undefined,
  interactive: boolean,
  reporter: StartupWarmupReporter | null,
  reportTopologySettlement: boolean = false,
): Promise<StartupWarmupCache> {
  const result: StartupWarmupCache = { failures: [] };

  if (!session.offline && flags.plugins) {
    const pluginsResult: PrefetchResult = await startupPrefetch_retry(
      'Plugins',
      'Prefetching /bin for completions',
      interactive,
      reporter,
      async (): Promise<PrefetchResult> => {
        const listingResult: Result<ListingItem[]> = await vfs.data_get('/bin');
        if (listingResult.ok) {
          return {
            ok: true,
            count: listingResult.value.filter((item: ListingItem): boolean => item.type === 'plugin').length,
            pipelineCount: listingResult.value.filter((item: ListingItem): boolean => item.type === 'pipeline').length,
          };
        }
        const error: StackMessage | undefined = errorStack.stack_pop();
        return { ok: false, message: error ? error_stripDebugPrefix(error.message) : 'Failed to prefetch /bin' };
      },
    );
    if (pluginsResult.ok) {
      result.plugins = pluginsResult.count;
      result.pipelines = pluginsResult.pipelineCount;
      reporter?.log('ok', 'Plugins', `Cached ${pluginsResult.count ?? 0} plugin(s)`);
      reporter?.log('ok', 'Pipelines', `Cached ${pluginsResult.pipelineCount ?? 0} pipeline(s)`);
    } else {
      result.failures.push('Plugins');
      reporter?.log('fail', 'Plugins', pluginsResult.message || 'Failed to prefetch /bin');
    }
  } else if (!session.offline) {
    reporter?.log('skip', 'Plugins', 'Prefetch disabled');
    reporter?.log('skip', 'Pipelines', 'Prefetch disabled');
  } else {
    reporter?.log('skip', 'Plugins', 'Offline mode');
    reporter?.log('skip', 'Pipelines', 'Offline mode');
  }

  if (!session.offline) {
    const groupsResult: PrefetchResult = await startupPrefetch_retry(
      'Groups',
      'Resolving /etc/group memberships',
      interactive,
      reporter,
      async (): Promise<PrefetchResult> => {
        const projection: Result<string> = await vfsDispatcher.read('/etc/group');
        if (projection.ok) {
          const count: number = projection.value.split('\n').filter(Boolean).length;
          return { ok: true, count };
        }
        const error: StackMessage | undefined = errorStack.stack_pop();
        return { ok: false, message: error?.message ?? 'Failed to resolve /etc/group' };
      },
    );
    if (groupsResult.ok) {
      reporter?.log('ok', 'Groups', `Cached ${groupsResult.count ?? 0} group(s)`);
    } else {
      result.failures.push('Groups');
      reporter?.log('fail', 'Groups', groupsResult.message || 'Failed to resolve /etc/group');
    }
  } else {
    reporter?.log('skip', 'Groups', 'Offline mode');
  }

  if (!session.offline && flags.feeds) {
    const feedPath: string | undefined = user ? `/home/${user}/feeds` : undefined;
    if (feedPath) {
      const feedsResult: PrefetchResult = await startupPrefetch_retry(
        'Feeds',
        'Prefetching user feeds',
        interactive,
        reporter,
        (): Promise<PrefetchResult> => prefetch_path(feedPath),
      );
      if (feedsResult.ok) {
        result.feeds = feedsResult.count;
        reporter?.log('ok', 'Feeds', `Cached ${feedsResult.count ?? 0} item(s) from ${feedPath}`);
      } else {
        result.failures.push('Feeds');
        reporter?.log('fail', 'Feeds', feedsResult.message || `Prefetch failed for ${feedPath}`);
      }
    } else {
      reporter?.log('skip', 'Feeds', 'No user context');
    }

    if (flags.publicFeeds) {
      const publicResult: PrefetchResult = await startupPrefetch_retry(
        'Public',
        'Prefetching public feeds',
        interactive,
        reporter,
        (): Promise<PrefetchResult> => prefetch_path('/PUBLIC'),
      );
      if (publicResult.ok) {
        result.public = publicResult.count;
        reporter?.log('ok', 'Public', `Cached ${publicResult.count ?? 0} item(s) from /PUBLIC`);
      } else {
        result.failures.push('Public');
        reporter?.log('fail', 'Public', publicResult.message || 'Prefetch failed for /PUBLIC');
      }
    }
  } else if (!session.offline) {
    reporter?.log('skip', 'Feeds', 'Prefetch disabled');
  } else {
    reporter?.log('skip', 'Feeds', 'Offline mode');
  }

  if (!session.offline && flags.jobs) {
    let checkpoint: ProcCheckpointRestoreResult | null = null;
    let reconciliationFeedIDs: number[] = [];
    if (reportTopologySettlement && user) {
      const cubeUrl: string | null = await chrisContext.ChRISURL_get();
      if (cubeUrl) {
        const identity: string = identity_forSession(user, cubeUrl);
        checkpoint = await procCheckpoint_restore(identity);
        procCheckpoint_watch(identity);
      }
    }
    const jobsResult: PrefetchResult = await startupPrefetch_retry(
      'Jobs',
      'Indexing /proc/jobs (feed list)...',
      interactive,
      reporter,
      async (): Promise<PrefetchResult> => {
        try {
          reconciliationFeedIDs = await procCache_refresh();
          return { ok: true, count: procCache_get().feedIDs_get().length };
        } catch (error: unknown) {
          if (procCache_get().lifecycle_get().checkpointAt) procCache_get().cache_clear();
          const message: string = error instanceof Error ? error.message : String(error);
          return { ok: false, message };
        }
      },
    );
    if (jobsResult.ok) {
      const jobsMessage: string = checkpoint?.restored
        ? `Restored ${checkpoint.count} job(s); indexed ${jobsResult.count ?? 0} feed(s) — topology reconciling in background`
        : `Indexed ${jobsResult.count ?? 0} feed(s) — topology reconciling in background`;
      reporter?.log('ok', 'Jobs', jobsMessage);
      errorStack.scope_run((): void => {
        const topologySweep: Promise<void> = checkpoint?.restored
          ? procTopology_reconcileFeeds(reconciliationFeedIDs)
          : procTopology_warmup();
        if (reportTopologySettlement) {
          void topologySweep.then(
            (): void => {
              const topology: ProcTopologyStatus = procTopology_status();
              if (topology.state !== 'complete') {
                reporter?.log('fail', 'Topology', `Warm-up failed: ${topology.failure ?? 'the topology index did not complete'}`);
                return;
              }
              const progress: ProcWarmupProgress = procCache_get().warmupProgress_get();
              const total: number = progress.total > 0 ? progress.total : progress.loaded;
              reporter?.log('ok', 'Topology', `Ready — ${progress.loaded}/${total} job(s) indexed`);
            },
            (error: unknown): void => {
              const message: string = error instanceof Error ? error.message : String(error);
              reporter?.log('fail', 'Topology', `Warm-up failed: ${message}`);
            },
          );
        } else {
          void topologySweep.catch((): void => { /* failure is visible through proc lifecycle state */ });
        }
      });
    } else {
      result.failures.push('Jobs');
      reporter?.log('fail', 'Jobs', jobsResult.message || 'Failed to index /proc/jobs');
    }
  } else if (!session.offline) {
    reporter?.log('skip', 'Jobs', 'Prefetch disabled');
  } else {
    reporter?.log('skip', 'Jobs', 'Offline mode');
  }

  return result;
}

/**
 * Warms a connected engine, reports readiness, then publishes its daemon.
 *
 * @param engine - Connected BRASA engine to host.
 * @param user - Authenticated username used for feed warming.
 * @param flags - Resource caches selected by daemon boot flags.
 * @param interactive - Whether progress may use an interactive spinner.
 * @param reporter - Daemon boot status logger.
 */
export async function daemonSession_run(
  engine: BrasaEngine,
  user: string | undefined,
  flags: StartupWarmupFlags,
  interactive: boolean,
  reporter: StartupWarmupReporter,
  recovery: DaemonWarmupRecovery = daemonWarmupFailure_decide,
): Promise<void> {
  try {
    // Warm-up runs before the daemon installs its own sink, so the engine is
    // still writing to this terminal — and a daemon boot is the one time
    // anyone watches it. Without a renderer the migrated spinner emits typed
    // events into StdoutSink's null renderer and the boot looks frozen.
    if (interactive) {
      sink_set(new StdoutSink(new TerminalProgressRenderer()));
      // The boot face: the brain races over the streaming boot log on the
      // alternate screen. Everything printed from here on is captured into
      // the face's ring — visible live in its strip, and flushed verbatim
      // into the normal buffer on the first Esc.
      face_boot();
    }
    // A warm-up failure asks the operator a question; the face steps aside
    // so the prompt's readline owns the terminal and every keystroke.
    const recovery_askAside = async (failures: string[]): Promise<DaemonWarmupFailureDecision> => {
      face_suspend();
      try {
        return await recovery(failures);
      } finally {
        face_resume();
      }
    };
    const info: DaemonLaunchInfo = await daemon_launch(engine, async (): Promise<void> => {
      const cache: StartupWarmupCache = await startupWarmup_run(flags, user, interactive, reporter, true);
      if (cache.failures.length === 0) {
        reporter.log('ok', 'Engine', 'Ready');
        return;
      }

      if (await recovery_askAside(cache.failures) === 'exit') {
        reporter.log('fail', 'Engine', `Startup aborted after incomplete warm-up: ${cache.failures.join(', ')}`);
        throw new DaemonWarmupAbortedError();
      }
      reporter.log('fail', 'Engine', `Starting with incomplete warm-up: ${cache.failures.join(', ')}`);
    });

    if (interactive) {
      // Boot is over: the face settles from its boot phase into the steady
      // instrument — calm pulse, identity panel, toggle hint — repainting
      // the same alternate screen in place. (animateStop is a safety catch:
      // daemon boots start no normal-buffer pulse any more.)
      logo_animateStop();
      const faceInfo: FaceInfo[] = [
        { label: 'identity', value: info.identity },
        { label: 'wire', value: info.url },
        ...(info.argusUrl !== null ? [{ label: 'ARGUS', value: info.argusUrl }] : []),
        { label: 'token', value: info.token },
        { label: 'berth', value: info.berthPath },
        { label: 'attach', value: `chell --remote --attach ${info.url} --token ${info.token}` },
      ];
      face_ready({
        info: faceInfo,
        telemetry_get: (): FaceTelemetry => {
          const index: { jobs: number; feeds: number } = procIndex_snapshot();
          return {
            sessions: info.daemon.surfaces_count(),
            busy: info.daemon.busy_get(),
            jobs: index.jobs,
            feeds: index.feeds,
          };
        },
      });
    }
  } catch (error: unknown) {
    // A boot dying with the face up must hand the terminal back — and flush
    // whatever the ring caged, the abort reason included.
    face_stop();
    if (error instanceof DaemonWarmupAbortedError) {
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
