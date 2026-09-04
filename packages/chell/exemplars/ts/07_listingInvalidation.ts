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
  ChRISFeed, feed_delete, listCache_get, listingInvalidation_flush,
  procCache_get, SimpleRecord,
} from '@fnndsc/cumin';
import { procCache_refresh, vfsDispatcher } from '@fnndsc/salsa';
import { vfs } from '@fnndsc/brasa';
import {
  env_load, config_isolate, cube_connect, check, section, summary_exit,
  CleanupPlan, CubeEnv,
} from './lib/harness.js';

/**
 * Folder the feed is rooted on, under the identity's home.
 *
 * CUBE rejects a home or top-level folder as a feed source, so this names
 * a subfolder. Override with LISTING_EXEMPLAR_SOURCE when the default is
 * absent on a given CUBE.
 */
const SOURCE_FOLDER: string = process.env.LISTING_EXEMPLAR_SOURCE ?? 'e2e-chell-scratch';

/**
 * Caches a folder listing, makes a feed arrive, and checks the mark.
 */
async function main(): Promise<void> {
  const env: CubeEnv = env_load();
  config_isolate();

  section('authenticate');
  const token: string = await cube_connect(env);
  check('received an auth token', token.length > 0);

  const cleanup: CleanupPlan = new CleanupPlan();
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
    section('build the roster first');
    // An arrival is a feed the roster did not know about. A first build has
    // no "before", so the roster has to exist before the feed is made.
    const procRoot = await vfsDispatcher.list('/proc/jobs', {});
    check('the roster is built', procRoot.ok);

    section('cache the feeds folder, fresh');
    // Through brasa's `vfs`, not salsa's dispatcher: the dispatcher reads
    // the provider and never touches the listing cache, so a dispatcher
    // call would leave nothing cached to go stale.
    const listedBefore = await vfs.data_get(feedsPath);
    check('the feeds folder lists', listedBefore.ok);
    check('and is served as fresh', listCache_get().cache_get(feedsPath)?.fresh === true);

    section('a feed arrives');
    const sourcePath: string = `/home/${env.user}/${SOURCE_FOLDER}`;
    const source = await vfs.data_get(sourcePath);
    if (!check(`the source folder ${sourcePath} exists`, source.ok)) { summary_exit(); }

    const feed: ChRISFeed = new ChRISFeed();
    const detail: SimpleRecord | null = await feed.createFromDirs(sourcePath, { params: '' });
    if (!check('feed created from the source folder', detail !== null) || !detail) { summary_exit(); }

    const feedID: number = Number(detail.id);
    check('the new feed has an id', Number.isFinite(feedID) && feedID > 0);
    cleanup.register(`deleted feed ${feedID}`, async (): Promise<boolean> => (await feed_delete(feedID)).ok);

    check('the feeds folder is still fresh — nothing has told the cache yet',
      listCache_get().cache_get(feedsPath)?.fresh === true);

    section('the roster notices');
    // A full walk is what a session runs on its own timer; running it here
    // removes the wait, not the mechanism. `procRoster_sync` is the timed
    // entry point and declines unless the cache lifecycle is already
    // current, which a fresh process's is not, so this drives the rebuild
    // it would eventually have reached.
    const changed: number[] = await procCache_refresh();
    check('the walk completed', Array.isArray(changed));
    check('the new feed is on the roster', procCache_get().feed_get(feedID) !== undefined);

    section('the listing knows');
    const marked: string[] = listingInvalidation_flush();
    const after = listCache_get().cache_get(feedsPath);
    check('the cached feeds folder is no longer fresh', after?.fresh === false);
    check('and it was kept, not deleted, so it can be served while it refreshes', after !== null);
    check('and it still holds the listing it was serving', after?.data !== undefined);
    console.log(`  marked in the flush: ${marked.length > 0 ? marked.join(', ') : '(already marked within the window)'}`);

    section('and the next visit is current');
    const relisted = await vfs.data_get(feedsPath);
    check('the feeds folder lists again after the mark', relisted.ok);
    check('and is fresh once more', listCache_get().cache_get(feedsPath)?.fresh === true);
    const names: string[] = relisted.ok ? relisted.value.map((i): string => String(i.name)) : [];
    check('and the arrived feed is in it', names.includes(`feed_${feedID}`));

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
