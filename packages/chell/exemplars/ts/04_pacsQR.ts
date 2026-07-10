/**
 * @file Exemplar 04 — non-destructive PACS query/retrieve.
 *
 * The workflow: query the designated test accession, locate its smallest
 * series (a one-file Structured Report), and inspect its CUBE state. If the
 * series is absent, the exemplar pulls it, verifies the registered files, and
 * deletes only that test-created folder during cleanup. If the series already
 * exists, the exemplar verifies it and never retrieves, deletes, or restores
 * it.
 *
 * Every PACSQuery the run creates is removed. A fresh-series cleanup action is
 * registered before retrieval, so a timed-out partial materialization is also
 * removed without making any pre-existing series part of a recovery path.
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
 * Registers cleanup for a series that was absent before this run.
 *
 * Registered before retrieval so a partial materialization is cleaned after a
 * timeout. Callers must prove absence first; this action must never own a
 * pre-existing series.
 *
 * @param env - The CUBE environment.
 * @param cleanup - The cleanup plan.
 * @param target - The series whose test-created materialization may be removed.
 */
function freshSeriesCleanup_register(env: CubeEnv, cleanup: CleanupPlan, target: SeriesTarget): void {
  cleanup.register(`deleted test-created series ${target.seriesUID} folder (admin)`, async () => {
    const location: SeriesLocation | null = await series_locateInCube(target.seriesUID);
    if (!location) return true;
    const token: string = await restToken_get(env.url, env.adminUser!, env.adminPassword!);
    return folder_deleteAndConfirm(env.url, token, location.folderPath);
  });
}

/**
 * Queries and verifies, retrieving only when the target is absent.
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

  section('CUBE materialization');
  const preexisting: SeriesLocation | null = await series_locateInCube(target.value.seriesUID);
  const expected: number = Math.max(target.value.fileCount, 1);
  if (preexisting) {
    console.log(`  (series already in CUBE at ${preexisting.folderPath} — leaving it untouched)`);
    check(`pre-existing file count is at least ${expected}`, preexisting.fileCount >= expected);
    return;
  }

  console.log('  (series absent from CUBE — retrieving a test-owned materialization)');
  freshSeriesCleanup_register(env, cleanup, target.value);

  const pulled: Result<SeriesLocation> = await step(
    'series pulled and registered in CUBE',
    series_pull(env.pacs, target.value, `${runId}-pull`,
      (queryId: number) => queryCleanup_register(env, cleanup, queryId)),
  );
  if (!pulled.ok) return;
  check(`file count is ${expected}`, pulled.value.fileCount >= expected);
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
    section('cleanup — remove test-owned artifacts');
    await cleanup.run();
  }
  summary_exit();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
