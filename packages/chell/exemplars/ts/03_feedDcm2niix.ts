/**
 * @file Exemplar 03 — feed with a DICOM → NIfTI analysis.
 *
 * The canonical ChRIS workflow, end to end: pull an MR image series from
 * PACS, root a feed on it with pl-dircopy, chain pl-dcm2niix onto that
 * node, wait for the job to finish, and verify NIfTI output landed in the
 * feed's tree. Cleanup deletes the feed, the run's PACSQueries, and — if
 * the series was not already on the CUBE — the pulled DICOM files (admin),
 * so the instance ends exactly as it began.
 *
 * Requires CUBE_ADMIN_USER/CUBE_ADMIN_PASSWORD for PACS cleanup.
 *
 *   node exemplars/ts/dist/03_feedDcm2niix.js
 *
 * @module
 */

import {
  ChRISFeed, ChRISPlugin, feed_delete, listData_get,
  Result, Dictionary, PluginInstance, SimpleRecord, Client,
} from '@fnndsc/cumin';
import { job_statusFetch, job_logFetch, vfsDispatcher } from '@fnndsc/salsa';
import {
  env_load, config_isolate, cube_connect, connection_active, check, section, summary_exit,
  sleep, runId_make, restToken_get, folderId_find, folder_deleteById, pacsQuery_deleteById, CubeEnv,
} from './lib/harness.js';
import {
  query_createAndWait, series_findInDecode, series_locateInCube, series_pull, SeriesLocation,
} from './lib/pacs.js';

/** Series description marker of a small MR image series in the test study. */
const IMAGE_SERIES_MARKER: string = 'SAG T1';
/** Terminal CUBE job states. */
const TERMINAL_STATES: string[] = ['finishedSuccessfully', 'finishedWithError', 'cancelled'];

/**
 * Resolves the highest registered version of a plugin by exact name.
 *
 * A plugin may be registered several times (one per version); take the
 * newest rather than whichever the API lists first.
 *
 * @param name - Exact plugin name (e.g. `pl-dcm2niix`).
 * @returns The plugin id, or null when the plugin is not registered.
 */
async function pluginNewest_resolve(name: string): Promise<number | null> {
  const client: Client | null = await connection_active().client_get();
  if (!client) return null;
  const plugins: Array<{ id: number; version: string }> =
    listData_get<{ id: number; version: string }>(await client.getPlugins({ name_exact: name, limit: 50 }));
  if (plugins.length === 0) return null;
  const byVersion = [...plugins].sort((a, b) =>
    b.version.localeCompare(a.version, undefined, { numeric: true }));
  console.log(`  (using ${name} v${byVersion[0].version})`);
  return byVersion[0].id;
}

/**
 * Polls a plugin instance until it reaches a terminal state.
 *
 * @param instanceId - The plugin instance id.
 * @param timeoutMs - Give-up horizon.
 * @returns The final status string, or null on timeout.
 */
async function job_awaitCompletion(instanceId: number, timeoutMs: number = 600_000): Promise<string | null> {
  const deadline: number = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status: Result<string> = await job_statusFetch(instanceId);
    if (status.ok && TERMINAL_STATES.includes(status.value)) {
      return status.value;
    }
    await sleep(5_000);
  }
  return null;
}

/**
 * Pulls an image series, runs dircopy → dcm2niix on it, verifies NIfTI
 * output, and restores the CUBE.
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
  let feedId: number | null = null;
  let pulledFresh: SeriesLocation | null = null;

  try {
    section(`stage the '${IMAGE_SERIES_MARKER}' series from PACS`);
    const queried = await query_createAndWait(env.pacs, { AccessionNumber: env.accession }, `${runId}-query`);
    check('query completed', queried !== null);
    if (!queried) return;
    createdQueryIds.push(queried.queryId);

    const target = series_findInDecode(queried.decoded, (d: string) => d.includes(IMAGE_SERIES_MARKER));
    check(`found the '${IMAGE_SERIES_MARKER}' series`, target !== null);
    if (!target) return;

    const preexisting: SeriesLocation | null = await series_locateInCube(target.seriesUID);
    let location: SeriesLocation | null = preexisting;
    if (!location) {
      const pulledResult = await series_pull(env.pacs, target, `${runId}-pull`);
      if (pulledResult) createdQueryIds.push(pulledResult.queryId);
      check('series pulled into CUBE', pulledResult?.location != null);
      if (!pulledResult?.location) return;
      location = pulledResult.location;
      pulledFresh = pulledResult.location;
    } else {
      console.log(`  (series already in CUBE at ${location.folderPath})`);
    }

    section('feed: pl-dircopy on the series folder');
    const feed: ChRISFeed = new ChRISFeed();
    const detail: SimpleRecord | null = await feed.createFromDirs(location.folderPath, { params: '' });
    check('feed created from the series directory', detail !== null);
    if (!detail) return;
    feedId = Number(detail.id);
    check(`feed id ${feedId} resolved`, Number.isFinite(feedId));

    const plugin: ChRISPlugin = new ChRISPlugin();
    const dircopyDict: Dictionary | null = plugin.pluginInstance_toDict(
      detail.pluginInstance as PluginInstance,
    );
    const dircopyId: number = Number(dircopyDict?.id);
    check('dircopy instance id resolved', Number.isFinite(dircopyId));

    section('analysis: pl-dcm2niix');
    const dcm2niixId: number | null = await pluginNewest_resolve('pl-dcm2niix');
    check('pl-dcm2niix is registered', dcm2niixId !== null);
    if (dcm2niixId === null) return;

    const instance: PluginInstance | undefined | null = await plugin.plugin_runOnCUBE(
      dcm2niixId, dircopyId, { title: `${runId}-dcm2niix` },
    );
    check('dcm2niix instance created', !!instance);
    if (!instance) return;
    const instanceDict: Dictionary | null = plugin.pluginInstance_toDict(instance);
    const instanceId: number = Number(instanceDict?.id);

    const finalState: string | null = await job_awaitCompletion(instanceId);
    if (!check(`dcm2niix finished (state: ${finalState ?? 'timeout'})`, finalState === 'finishedSuccessfully')) {
      const log: Result<string> = await job_logFetch(instanceId);
      if (log.ok) console.log(`  --- job log tail ---\n${log.value.slice(-1_500)}`);
    }

    section('verify NIfTI output');
    const outputPath: string = String(instanceDict?.output_path ?? '');
    check('instance reports an output path', outputPath.length > 0);
    const listing = await vfsDispatcher.list(`/${outputPath}`);
    check('listed the output directory', listing.ok);
    if (listing.ok) {
      const hasNii: boolean = listing.value.some((item: { name: string }) => item.name.includes('.nii'));
      check('output contains a NIfTI file', hasNii);
    }
  } finally {
    section('cleanup — restore the CUBE');
    if (feedId !== null && Number.isFinite(feedId)) {
      const deleted: Result<boolean> = await feed_delete(feedId);
      check(`deleted feed ${feedId}`, deleted.ok);
    }
    const userToken: string = await restToken_get(env.url, env.user, env.password);
    for (const queryId of createdQueryIds) {
      check(`deleted PACSQuery ${queryId}`, await pacsQuery_deleteById(env.url, userToken, queryId));
    }
    if (pulledFresh && env.adminUser && env.adminPassword) {
      const adminToken: string = await restToken_get(env.url, env.adminUser, env.adminPassword);
      const folderId: number | null = await folderId_find(env.url, adminToken, pulledFresh.folderPath);
      if (folderId !== null) {
        check('deleted the freshly pulled series folder (admin)', await folder_deleteById(env.url, adminToken, folderId));
      }
    }
  }

  summary_exit();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
