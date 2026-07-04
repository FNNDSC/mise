/**
 * @file Exemplar 02 — filesystem round-trip.
 *
 * Demonstrates the salsa file API against a live CUBE: make a scratch
 * directory, write a file with known content, read it back, verify
 * byte-for-byte equality, then remove everything so the CUBE ends the run
 * exactly as it began.
 *
 *   node exemplars/ts/dist/02_fsRoundtrip.js
 *
 * @module
 */

import { files_mkdir, files_touch, fileContent_get } from '@fnndsc/salsa';
import { Result } from '@fnndsc/cumin';
import {
  env_load, config_isolate, cube_connect, check, section, summary_exit,
  runId_make, restToken_get, folderId_find, folder_deleteById, sleep, CubeEnv,
} from './lib/harness.js';

/**
 * Creates, verifies and removes a scratch file under the test user's home.
 */
async function main(): Promise<void> {
  const env: CubeEnv = env_load();
  config_isolate();
  await cube_connect(env);

  const runId: string = runId_make();
  const scratchDir: string = `/home/${env.user}/${runId}`;
  const filePath: string = `${scratchDir}/hello.txt`;
  const content: string = `hello from ${runId}`;

  try {
    section('write');
    check('created the scratch directory', await files_mkdir(scratchDir));
    check('wrote hello.txt with content', await files_touch(filePath, content));

    section('read back');
    const readBack: Result<string> = await fileContent_get(filePath);
    check('read hello.txt', readBack.ok);
    if (readBack.ok) {
      check('content matches what was written', readBack.value === content);
    }
  } finally {
    section('cleanup');
    // Folder deletion removes contents too; a short settle avoids racing
    // the upload's own bookkeeping.
    await sleep(1_000);
    const token: string = await restToken_get(env.url, env.user, env.password);
    const folderId: number | null = await folderId_find(env.url, token, scratchDir.slice(1));
    if (folderId !== null) {
      check('deleted the scratch directory', await folder_deleteById(env.url, token, folderId));
    }
    // Deletion is asynchronous (202 Accepted): poll for the disappearance.
    let gone: boolean = false;
    for (let attempt: number = 0; attempt < 10 && !gone; attempt++) {
      await sleep(2_000);
      gone = (await folderId_find(env.url, token, scratchDir.slice(1))) === null;
    }
    check('scratch directory is gone', gone);
  }

  summary_exit();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
