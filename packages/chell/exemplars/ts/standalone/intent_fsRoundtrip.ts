/**
 * @file Standalone example — a filesystem round trip that cleans up after
 * itself.
 *
 * The complete program: connect with cumin, then use salsa to make a scratch
 * directory, write a file, read it back, verify the content, and delete the
 * scratch directory by path. Every call is the public API; nothing here
 * depends on a test harness.
 *
 * Run with the CUBE settings in the environment:
 *
 *   CUBE_URL=https://cube.chrisproject.org/api/v1/ \
 *   CUBE_USER=alice CUBE_PASSWORD=secret \
 *   node exemplars/ts/dist/standalone/intent_fsRoundtrip.js
 *
 * @module
 */
import { chrisConnection_init, NodeStorageProvider, type ChRISConnection, type Result } from '@fnndsc/cumin';
import { files_mkdir, files_touch, fileContent_get, folderByPath_delete } from '@fnndsc/salsa';

/**
 * Connects, round-trips one file, verifies it, and removes the evidence.
 */
async function main(): Promise<void> {
  const url: string | undefined = process.env.CUBE_URL;
  const user: string | undefined = process.env.CUBE_USER;
  const password: string | undefined = process.env.CUBE_PASSWORD;
  if (!url || !user || !password) {
    console.error('Set CUBE_URL, CUBE_USER and CUBE_PASSWORD.');
    process.exit(2);
  }

  const connection: ChRISConnection = await chrisConnection_init(new NodeStorageProvider());
  if (!(await connection.connection_connect({ url, user, password, debug: false }))) {
    console.error('Authentication failed.');
    process.exit(1);
  }

  // A unique scratch path under the user's home keeps reruns independent.
  const scratchDir: string = `/home/${user}/example-${Date.now().toString(36)}`;
  const filePath: string = `${scratchDir}/hello.txt`;
  const content: string = `hello from ${scratchDir}`;

  try {
    if (!(await files_mkdir(scratchDir))) throw new Error(`mkdir failed: ${scratchDir}`);
    if (!(await files_touch(filePath, content))) throw new Error(`write failed: ${filePath}`);

    const readBack: Result<string> = await fileContent_get(filePath);
    if (!readBack.ok) throw new Error(`read failed: ${filePath}`);
    if (readBack.value !== content) throw new Error('content mismatch after round trip');

    console.log(`Round trip verified through ${filePath}.`);
  } finally {
    // Path-addressed deletion; resolves only once the CUBE confirms the
    // folder is gone (server-side deletion is asynchronous).
    const removed: boolean = await folderByPath_delete(scratchDir);
    console.log(removed ? `Removed ${scratchDir}.` : `Could not remove ${scratchDir}; delete it via chell or the UI.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
