/**
 * @file Exemplar 08 — a feed shared by another identity arrives, and the
 * listing that gains it goes stale.
 *
 * The case that started the whole listing-invalidation epic: a colleague
 * shares a feed, and the client says nothing because its cached folder
 * listing is still inside its lifetime. This proves the notifier closes
 * that gap for a *real* share by a *real* second identity — not a
 * synthesized arrival.
 *
 * Requires a second identity: CUBE_SHARE_USER and CUBE_SHARE_PASSWORD.
 * Skips when they are absent, as the PACS and admin exemplars do.
 *
 *   node exemplars/ts/dist/08_sharedFeedArrival.js
 *
 * @module
 */

import {
  ChRISFeed, feed_delete, feed_share, listCache_get, listingInvalidation_flush,
  procCache_get, type Result, SimpleRecord,
} from '@fnndsc/cumin';
import { procCache_refresh, vfsDispatcher } from '@fnndsc/salsa';
import { vfs } from '@fnndsc/brasa';
import {
  env_load, config_isolate, cube_connect, check, section, summary_exit,
  CleanupPlan, CubeEnv,
} from './lib/harness.js';

/** Folder the shared feed is rooted on, under the sharer's home. */
const SOURCE_FOLDER: string = process.env.LISTING_EXEMPLAR_SOURCE ?? 'e2e-chell-scratch';

/**
 * Shares a feed from a second identity and watches the arrival land.
 */
async function main(): Promise<void> {
  const env: CubeEnv = env_load();
  config_isolate();

  const sharer: string | undefined = process.env.CUBE_SHARE_USER;
  const sharerPassword: string | undefined = process.env.CUBE_SHARE_PASSWORD;
  if (sharer === undefined || sharerPassword === undefined) {
    console.log('CUBE_SHARE_USER and CUBE_SHARE_PASSWORD must name a second identity — skipping.');
    process.exit(2);
  }
  if (sharer === env.user) {
    console.log('CUBE_SHARE_USER must differ from CUBE_USER — a feed shared with yourself is not an arrival. Skipping.');
    process.exit(2);
  }

  const cleanup: CleanupPlan = new CleanupPlan();
  const feedsPath: string = `/home/${env.user}/feeds`;

  section('authenticate as the receiving identity');
  const token: string = await cube_connect(env);
  check('received an auth token', token.length > 0);

  procCache_get().rosterFolders_set({
    owner: env.user,
    own: feedsPath,
    shared: '/SHARED',
    public: '/PUBLIC',
  });

  try {
    section('build the roster first');
    // An arrival is a feed the roster did not know about; a first build
    // has no "before", so the roster must exist before the share.
    const roster = await vfsDispatcher.list('/proc/jobs', {});
    check('the roster is built', roster.ok);

    section('cache the folders a share would change, fresh');
    const shared = await vfs.data_get('/SHARED');
    check('/SHARED lists', shared.ok);
    check('and is served as fresh', listCache_get().cache_get('/SHARED')?.fresh === true);

    section('the other identity creates a feed and shares it');
    // Through mise, never around it: sharing is a kernel operation
    // (`feed_share`), exposed by brasa's `share` verb. An exemplar that
    // reached past the stack to CUBE's REST would be proving something
    // no surface can actually do.
    const sharerEnv: CubeEnv = { ...env, user: sharer, password: sharerPassword };
    await cube_connect(sharerEnv);

    const feed: ChRISFeed = new ChRISFeed();
    const detail: SimpleRecord | null = await feed.createFromDirs(`/home/${sharer}/${SOURCE_FOLDER}`, { params: '' });
    if (!check('the sharer created a feed', detail !== null) || !detail) { summary_exit(); }
    const feedID: number = Number(detail.id);
    cleanup.register(`deleted feed ${feedID}`, async (): Promise<boolean> => (await feed_delete(feedID)).ok);

    const granted: Result<boolean> = await feed_share(feedID, env.user);
    check(`feed ${feedID} shared with ${env.user}`, granted.ok);

    // Back to the receiving identity for the observation.
    await cube_connect(env);

    check('/SHARED is still fresh — nothing has told the cache yet',
      listCache_get().cache_get('/SHARED')?.fresh === true);

    section('the roster notices the arrival');
    const changed: number[] = await procCache_refresh();
    check('the walk completed', Array.isArray(changed));
    check('the shared feed is on the roster', procCache_get().feed_get(feedID) !== undefined);

    section('the listing knows');
    const marked: string[] = listingInvalidation_flush();
    const after = listCache_get().cache_get('/SHARED');
    check('the cached /SHARED listing is no longer fresh', after?.fresh === false);
    check('and it was kept, not deleted, so it can be served while it refreshes', after !== null);
    console.log(`  marked in the flush: ${marked.length > 0 ? marked.join(', ') : '(already marked within the window)'}`);

    section('and the next visit is current');
    const relisted = await vfs.data_get('/SHARED');
    check('/SHARED lists again after the mark', relisted.ok);
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
