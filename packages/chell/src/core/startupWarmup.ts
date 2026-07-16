/**
 * @file Shared startup cache warming for interactive and daemon ChELL hosts.
 *
 * Warms the VFS and process caches, reports each outcome through a small host
 * seam, and starts non-blocking job-topology warming after the jobs index is
 * available. Daemon startup additionally waits for this work before publishing
 * its listening berth.
 *
 * @module
 */
import {
  error_stripDebugPrefix,
  prefetch_path,
  prefetch_withSpinner,
  session,
  vfs,
  type BrasaEngine,
  type PrefetchResult,
} from '@fnndsc/brasa';
import { daemon_launch } from '@fnndsc/calypso';
import { errorStack, procCache_get, type ProcWarmupProgress, type Result, type StackMessage } from '@fnndsc/cumin';
import type { ListingItem } from '@fnndsc/chili/models/listing.js';
import { procCache_refresh, procTopology_status, procTopology_warmup, type ProcTopologyStatus } from '@fnndsc/salsa';
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

/**
 * Warms startup caches and begins non-blocking job-topology warming.
 *
 * @param flags - Resource caches selected by the host's boot flags.
 * @param user - Authenticated username used to construct the feed path.
 * @param interactive - Whether progress may use an interactive spinner.
 * @param reporter - Host status logger, or null for silent status reporting.
 * @returns Cache counts and the labels of any failed warm-up operations.
 */
export async function startupWarmup_run(
  flags: StartupWarmupFlags,
  user: string | undefined,
  interactive: boolean,
  reporter: StartupWarmupReporter | null,
): Promise<StartupWarmupCache> {
  const result: StartupWarmupCache = { failures: [] };

  if (!session.offline && flags.plugins) {
    const pluginsResult: PrefetchResult = await prefetch_withSpinner(
      'Plugins',
      'Prefetching /bin for completions',
      interactive,
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

  if (!session.offline && flags.feeds) {
    const feedPath: string | undefined = user ? `/home/${user}/feeds` : undefined;
    if (feedPath) {
      const feedsResult: PrefetchResult = await prefetch_withSpinner(
        'Feeds',
        'Prefetching user feeds',
        interactive,
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
      const publicResult: PrefetchResult = await prefetch_withSpinner(
        'Public',
        'Prefetching public feeds',
        interactive,
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
    const jobsResult: PrefetchResult = await prefetch_withSpinner(
      'Jobs',
      'Indexing /proc/jobs (feed list)...',
      interactive,
      async (): Promise<PrefetchResult> => {
        try {
          await procCache_refresh();
          return { ok: true, count: procCache_get().feedIDs_get().length };
        } catch (error: unknown) {
          const message: string = error instanceof Error ? error.message : String(error);
          return { ok: false, message };
        }
      },
    );
    if (jobsResult.ok) {
      reporter?.log('ok', 'Jobs', `Indexed ${jobsResult.count ?? 0} feed(s) — topology warming in background`);
      errorStack.scope_run((): void => {
        const topologySweep: Promise<void> = procTopology_warmup();
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
): Promise<void> {
  await daemon_launch(engine, async (): Promise<void> => {
    const cache: StartupWarmupCache = await startupWarmup_run(flags, user, interactive, reporter);
    if (cache.failures.length === 0) {
      reporter.log('ok', 'Engine', 'Ready');
    } else {
      reporter.log('fail', 'Engine', `Starting with incomplete warm-up: ${cache.failures.join(', ')}`);
    }
  });
}
