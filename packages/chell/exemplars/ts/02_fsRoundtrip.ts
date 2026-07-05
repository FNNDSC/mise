/**
 * @file Exemplar 02 — filesystem round-trip.
 *
 * The salsa file API against a live CUBE: make a scratch directory, write
 * a file with known content, read it back, verify byte-for-byte equality.
 * The scratch directory's removal is registered on the cleanup plan the
 * moment it is created, so the CUBE ends the run exactly as it began even
 * if a later step fails.
 *
 *   node exemplars/ts/dist/02_fsRoundtrip.js
 *
 * @module
 */

import { files_mkdir, files_touch, fileContent_get } from '@fnndsc/salsa';
import { Result } from '@fnndsc/cumin';
import {
  env_load, config_isolate, cube_connect, check, step, section, summary_exit,
  runId_make, restToken_get, folder_deleteAndConfirm, CleanupPlan, CubeEnv,
} from './lib/harness.js';

/**
 * Writes, verifies and (via the cleanup plan) removes one scratch file.
 *
 * @param env - The CUBE environment.
 * @param cleanup - Undo actions, registered as resources are created.
 */
async function scenario_run(env: CubeEnv, cleanup: CleanupPlan): Promise<void> {
  const runId: string = runId_make();
  const scratchDir: string = `/home/${env.user}/${runId}`;
  const filePath: string = `${scratchDir}/hello.txt`;
  const content: string = `hello from ${runId}`;

  section('write');
  if (!check('created the scratch directory', await files_mkdir(scratchDir))) return;
  cleanup.register('removed the scratch directory', async () => {
    const token: string = await restToken_get(env.url, env.user, env.password);
    return folder_deleteAndConfirm(env.url, token, scratchDir.slice(1));
  });
  if (!check('wrote hello.txt with content', await files_touch(filePath, content))) return;

  section('read back');
  const readBack: Result<string> = await step('read hello.txt', fileContent_get(filePath));
  if (readBack.ok) check('content matches what was written', readBack.value === content);
}

/**
 * Program entry: connect, run the scenario, always run cleanup.
 */
async function main(): Promise<void> {
  const env: CubeEnv = env_load();
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
