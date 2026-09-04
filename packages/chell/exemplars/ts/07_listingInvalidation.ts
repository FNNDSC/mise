/**
 * @file Exemplar 07 — a finished job dirties the folder listings it wrote.
 *
 * The claim this proves: `/proc` already learns when a job reaches a
 * terminal state, and that knowledge now reaches the folder-listing cache,
 * so a listing goes stale because something happened rather than because a
 * clock expired.
 *
 * The shape of the run is a race the old design always lost. List a feed's
 * folder while a job is still running, so the listing is cached and fresh.
 * Let the job finish. Without the notifier the cached listing stays fresh
 * for its whole lifetime and the operator sees a feed that appears empty;
 * with it, the listing is dirty the moment the status crosses over, and the
 * next visit shows the output.
 *
 * Creates one feed with pl-dircopy and deletes it again, so the CUBE ends
 * the run as it began.
 *
 *   node exemplars/ts/dist/07_listingInvalidation.js
 *
 * @module
 */

import {
  ChRISFeed, ChRISPlugin, feed_delete, listCache_get, listingInvalidation_flush,
  procCache_get, Result, Dictionary, PluginInstance,
} from '@fnndsc/cumin';
import { feedStatus_refresh, vfsDispatcher } from '@fnndsc/salsa';
import {
  env_load, config_isolate, cube_connect, check, step, section, summary_exit,
  poll_until, runId_make, CleanupPlan, CubeEnv,
} from './lib/harness.js';

/** CUBE job states from which a status never moves again. */
const TERMINAL_STATES: string[] = ['finishedSuccessfully', 'finishedWithError', 'cancelled'];

/**
 * Runs a feed to completion around a cached listing and checks the mark.
 */
async function main(): Promise<void> {
  const env: CubeEnv = env_load();
  config_isolate();

  section('authenticate');
  const token: string = await cube_connect(env);
  check('received an auth token', token.length > 0);

  const cleanup: CleanupPlan = new CleanupPlan();
  const runId: string = runId_make();
  const feedsPath: string = `/home/${env.user}/feeds`;

  // The roster speaks in feed ids; the host names the folders whose
  // membership an arrival or departure changes.
  procCache_get().rosterFolders_set({
    owner: env.user,
    own: feedsPath,
    shared: '/SHARED',
    public: '/PUBLIC',
  });

  try {
    section('root a feed');
    const plugin: ChRISPlugin = new ChRISPlugin();
    const created: Result<PluginInstance> = await step(
      'created a pl-dircopy root node',
      plugin.plugin_run('pl-dircopy', { dir: `/home/${env.user}`, title: `listing-invalidation-${runId}` } as Dictionary),
    );
    if (!created.ok) { summary_exit(); }
    const rootInstance: PluginInstance = created.value;
    const feedID: number = Number(rootInstance.feed_id);
    check('the new node belongs to a feed', Number.isFinite(feedID) && feedID > 0);
    cleanup.add(`feed ${feedID}`, async (): Promise<boolean> => (await feed_delete(feedID)).ok);

    section('cache the feed folder while the job is still running');
    const feedPath: string = `${feedsPath}/feed_${feedID}`;
    await vfsDispatcher.list(feedPath, {});
    const beforeCached = listCache_get().cache_get(feedPath);
    check('the feed folder is cached', beforeCached !== null);
    check('and is served as fresh', beforeCached?.fresh === true);

    section('let the job finish');
    // Poll through feedStatus_refresh, not a bare status read. That
    // function is what a session actually runs while watching a feed, and
    // it is the notifier's call site: it drives ProcCache.status_update,
    // which is what notices a job crossing into a terminal state. Reading
    // the status straight from CUBE would prove nothing, because nothing
    // would have told the cache.
    const settled: Result<string> = await poll_until(
      async (): Promise<string | null> => {
        await feedStatus_refresh(feedID);
        const status: string | null = procCache_get().instance_get(Number(rootInstance.id))?.status ?? null;
        return status !== null && TERMINAL_STATES.includes(status) ? status : null;
      },
      5 * 60_000,
      3_000,
    );
    check('the root job reached a terminal state through the session path', settled.ok);

    section('the listing knows');
    // Apply any movement still inside its coalescing window, so the check
    // does not race a timer it does not own.
    const marked: string[] = listingInvalidation_flush();
    const afterCached = listCache_get().cache_get(feedPath);
    check('the cached feed folder is no longer fresh', afterCached?.fresh === false);
    check('and it was kept, not deleted, so it can be served while it refreshes', afterCached !== null);
    console.log(`  marked in the flush: ${marked.length > 0 ? marked.join(', ') : '(already marked within the window)'}`);

    section('and the next visit is current');
    const relisted = await vfsDispatcher.list(feedPath, {});
    check('the feed folder lists again after the mark', relisted.ok);
  } finally {
    section('cleanup');
    await cleanup.run();
  }

  summary_exit();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
