/**
 * @file Exemplar 04 — PACS query/retrieve with the after-equals-before invariant.
 *
 * Queries the designated test accession, pulls its smallest series (a
 * one-file Structured Report), verifies the files registered in CUBE, then
 * restores the CUBE to its prior state: pulled files are deleted with admin
 * credentials — or, if the series already existed before the run, it is
 * re-pulled after the deletion check — and every PACSQuery the run created
 * is removed.
 *
 * Requires CUBE_ADMIN_USER/CUBE_ADMIN_PASSWORD for the cleanup phase.
 *
 *   node exemplars/ts/dist/04_pacsQR.js
 *
 * @module
 */

import { pacsRetrieve_create, Result, PACSRetrieveRecord } from '@fnndsc/cumin';
import {
  env_load, config_isolate, cube_connect, check, section, summary_exit, sleep,
  runId_make, restToken_get, folderId_find, folder_deleteById, pacsQuery_deleteById, CubeEnv,
} from './lib/harness.js';
import {
  query_createAndWait, series_findInDecode, series_locateInCube, series_pull,
  SeriesTarget, SeriesLocation,
} from './lib/pacs.js';

/** Series description marker of the one-file test series. */
const SMALL_SERIES_MARKER: string = 'FUJI Basic Text SR';

/**
 * Runs the full Q/R cycle and restores the CUBE afterwards.
 */
async function main(): Promise<void> {
  const env: CubeEnv = env_load();
  if (!env.adminUser || !env.adminPassword) {
    console.log('CUBE_ADMIN_USER and CUBE_ADMIN_PASSWORD must be set for PACS cleanup — skipping.');
    process.exit(2);
  }
  config_isolate();
  await cube_connect(env);

  const runId: string = runId_make();
  const createdQueryIds: number[] = [];
  let pulled: { queryId: number; location: SeriesLocation } | null = null;
  let preexisting: SeriesLocation | null = null;
  let target: SeriesTarget | null = null;

  try {
    section(`query accession ${env.accession}`);
    const queried = await query_createAndWait(
      env.pacs,
      { AccessionNumber: env.accession },
      `${runId}-query`,
    );
    check('query completed with a decoded result', queried !== null);
    if (!queried) return;
    createdQueryIds.push(queried.queryId);

    target = series_findInDecode(queried.decoded, (d: string) => d.includes(SMALL_SERIES_MARKER));
    check(`found the '${SMALL_SERIES_MARKER}' series`, target !== null);
    if (!target) return;

    section('retrieve');
    preexisting = await series_locateInCube(target.seriesUID);
    console.log(preexisting
      ? `  (series already in CUBE at ${preexisting.folderPath} — will restore after cleanup)`
      : '  (series not in CUBE — clean pull)');

    const pullResult = await series_pull(env.pacs, target, `${runId}-pull`);
    if (pullResult) createdQueryIds.push(pullResult.queryId);
    check('series pulled and registered in CUBE', pullResult?.location != null);
    if (!pullResult?.location) return;
    pulled = { queryId: pullResult.queryId, location: pullResult.location };
    check(
      `file count is ${Math.max(target.fileCount, 1)}`,
      pulled.location.fileCount >= Math.max(target.fileCount, 1),
    );
  } finally {
    section('cleanup — restore the CUBE');
    const adminToken: string = await restToken_get(env.url, env.adminUser, env.adminPassword);
    const userToken: string = await restToken_get(env.url, env.user, env.password);

    if (pulled) {
      const folderId: number | null = await folderId_find(env.url, adminToken, pulled.location.folderPath);
      if (folderId !== null) {
        check('deleted the pulled series folder (admin)', await folder_deleteById(env.url, adminToken, folderId));
        // Deletion is asynchronous (202 Accepted): poll for the disappearance.
        let gone: boolean = false;
        for (let attempt: number = 0; attempt < 15 && !gone; attempt++) {
          await sleep(2_000);
          gone = (await folderId_find(env.url, adminToken, pulled.location.folderPath)) === null;
        }
        check('series folder is gone', gone);
      }

      if (preexisting && target) {
        // The series was on the CUBE before this run: put it back.
        const restore: Result<PACSRetrieveRecord> = await pacsRetrieve_create(pulled.queryId);
        check('fired the restore retrieve', restore.ok);
        const deadline: number = Date.now() + 600_000;
        let restored: SeriesLocation | null = null;
        while (Date.now() < deadline && !restored) {
          await sleep(5_000);
          restored = await series_locateInCube(target.seriesUID);
        }
        if (!check('series restored to its pre-run state', restored !== null)) {
          // Deleting the query would cascade the still-running retrieve
          // away; leave it so the restore can complete on its own.
          const index: number = createdQueryIds.indexOf(pulled.queryId);
          if (index >= 0) createdQueryIds.splice(index, 1);
          console.log(`  (left PACSQuery ${pulled.queryId} in place — its retrieve is still restoring)`);
        }
      }
    }

    for (const queryId of createdQueryIds) {
      check(`deleted PACSQuery ${queryId}`, await pacsQuery_deleteById(env.url, userToken, queryId));
    }
  }

  summary_exit();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
