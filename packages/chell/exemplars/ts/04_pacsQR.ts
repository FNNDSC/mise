/**
 * @file Exemplar 04 — PACS query/retrieve with the after-equals-before invariant.
 *
 * The workflow: query the designated test accession, locate its smallest
 * series (a one-file Structured Report), pull it, and verify the files
 * registered in CUBE. The test then proves deletability — pulled PACS
 * folders are admin-owned — by deleting the folder and confirming it is
 * gone.
 *
 * The cleanup plan restores the CUBE: if the series existed before the
 * run it is re-pulled; every PACSQuery the run created is removed (only
 * after any restore retrieve has finished — deleting a query cascades to
 * its in-flight retrieve).
 *
 * Requires CUBE_ADMIN_USER/CUBE_ADMIN_PASSWORD for the folder deletion.
 *
 *   node exemplars/ts/dist/04_pacsQR.js
 *
 * @module
 */

import { Result } from '@fnndsc/cumin';
import {
  env_load, adminEnv_require, config_isolate, cube_connect, check, step, section,
  summary_exit, runId_make, restToken_get, folder_deleteAndConfirm, pacsQuery_deleteById,
  CleanupPlan, CubeEnv,
} from './lib/harness.js';
import {
  query_createAndWait, series_findInDecode, series_locateInCube, series_pull,
  QueryOutcome, SeriesTarget, SeriesLocation,
} from './lib/pacs.js';

/** Series description marker of the one-file test series. */
const SMALL_SERIES_MARKER: string = 'FUJI Basic Text SR';

/**
 * Registers deletion of a PACSQuery on the cleanup plan.
 *
 * @param env - The CUBE environment.
 * @param cleanup - The cleanup plan.
 * @param queryId - The query to delete during cleanup.
 */
function queryCleanup_register(env: CubeEnv, cleanup: CleanupPlan, queryId: number): void {
  cleanup.register(`deleted PACSQuery ${queryId}`, async () => {
    const token: string = await restToken_get(env.url, env.user, env.password);
    return pacsQuery_deleteById(env.url, token, queryId);
  });
}

/**
 * Registers the re-pull that restores a series the run is about to delete.
 *
 * The restore uses a fresh single-series query of its own (re-firing a
 * retrieve on the earlier query proved unreliable) and removes that query
 * once the series is back. Registered before the deletion so that, in
 * LIFO order, the restore runs ahead of the other query deletions.
 *
 * @param env - The CUBE environment.
 * @param cleanup - The cleanup plan.
 * @param target - The series to restore.
 */
function restoreCleanup_register(env: CubeEnv, cleanup: CleanupPlan, target: SeriesTarget): void {
  cleanup.register('restored the series to its pre-run state', async () => {
    let restoreQueryId: number = 0;
    const arrived: Result<SeriesLocation> = await series_pull(
      env.pacs, target, `restore-${Date.now().toString(36)}`,
      (queryId: number) => { restoreQueryId = queryId; },
    );
    if (!arrived.ok) return false;

    const token: string = await restToken_get(env.url, env.user, env.password);
    return pacsQuery_deleteById(env.url, token, restoreQueryId);
  });
}

/**
 * Queries, pulls, verifies, deletes — registering every undo on the plan.
 *
 * @param env - The CUBE environment.
 * @param cleanup - Undo actions, registered as resources are created.
 */
async function scenario_run(env: CubeEnv, cleanup: CleanupPlan): Promise<void> {
  const runId: string = runId_make();

  section(`query accession ${env.accession}`);
  const queried: Result<QueryOutcome> = await step(
    'query completed with a decoded result',
    query_createAndWait(env.pacs, { AccessionNumber: env.accession }, `${runId}-query`),
  );
  if (!queried.ok) return;
  queryCleanup_register(env, cleanup, queried.value.queryId);

  const target: Result<SeriesTarget> = series_findInDecode(
    queried.value.decoded,
    (d: string) => d.includes(SMALL_SERIES_MARKER),
  );
  if (!check(`found the '${SMALL_SERIES_MARKER}' series`, target.ok) || !target.ok) return;

  section('retrieve');
  const preexisting: SeriesLocation | null = await series_locateInCube(target.value.seriesUID);
  console.log(preexisting
    ? `  (series already in CUBE at ${preexisting.folderPath} — the cleanup plan will restore it)`
    : '  (series not in CUBE — clean pull)');

  const pulled: Result<SeriesLocation> = await step(
    'series pulled and registered in CUBE',
    series_pull(env.pacs, target.value, `${runId}-pull`,
      (queryId: number) => queryCleanup_register(env, cleanup, queryId)),
  );
  if (!pulled.ok) return;
  const expected: number = Math.max(target.value.fileCount, 1);
  check(`file count is ${expected}`, pulled.value.fileCount >= expected);

  section('delete the pulled files (admin)');
  if (preexisting) restoreCleanup_register(env, cleanup, target.value);
  const adminToken: string = await restToken_get(env.url, env.adminUser!, env.adminPassword!);
  check(
    'series folder deleted and confirmed gone',
    await folder_deleteAndConfirm(env.url, adminToken, pulled.value.folderPath),
  );
}

/**
 * Program entry: connect, run the scenario, always run cleanup.
 */
async function main(): Promise<void> {
  const env: CubeEnv = env_load();
  adminEnv_require(env);
  config_isolate();
  await cube_connect(env);

  const cleanup: CleanupPlan = new CleanupPlan();
  try {
    await scenario_run(env, cleanup);
  } finally {
    section('cleanup — restore the CUBE');
    await cleanup.run();
  }
  summary_exit();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
