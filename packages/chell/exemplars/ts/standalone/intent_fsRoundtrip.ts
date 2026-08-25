/**
 * @file Standalone example — a filesystem round trip that cleans up after
 * itself.
 *
 * The complete program: connect with cumin, then use salsa to make a scratch
 * directory, write a file, read it back and verify the content. Cleanup
 * drops to CUBE's filebrowser REST endpoint, because path-addressed folder
 * deletion has no salsa wrapper yet; the three small helpers at the bottom
 * show exactly what that takes, escape hatch included.
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
import { files_mkdir, files_touch, fileContent_get } from '@fnndsc/salsa';

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
    const removed: boolean = await folder_delete(url, user, password, scratchDir.slice(1));
    console.log(removed ? `Removed ${scratchDir}.` : `Could not remove ${scratchDir}; delete it via chell or the UI.`);
  }
}

/**
 * Deletes a CUBE folder by path over the filebrowser REST endpoint and waits
 * until the CUBE confirms it is gone (deletion is asynchronous: 202).
 *
 * @param url - CUBE API base URL.
 * @param user - Owner of the folder.
 * @param password - The owner's password.
 * @param folderPath - CUBE path without its leading slash.
 * @returns True when the folder is verifiably gone.
 */
async function folder_delete(url: string, user: string, password: string, folderPath: string): Promise<boolean> {
  const tokenResponse: Response = await fetch(`${url}auth-token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password }),
  });
  if (!tokenResponse.ok) return false;
  const token: string = ((await tokenResponse.json()) as { token: string }).token;
  const auth: Record<string, string> = { Authorization: `Token ${token}`, Accept: 'application/json' };

  const folderId: number | null = await folderId_find(url, auth, folderPath);
  if (folderId === null) return true;

  const deleted: Response = await fetch(`${url}filebrowser/${folderId}/`, { method: 'DELETE', headers: auth });
  if (deleted.status !== 202 && deleted.status !== 204) return false;

  // Poll until the folder stops resolving; the 202 only queued the delete.
  for (let attempt: number = 0; attempt < 20; attempt++) {
    if ((await folderId_find(url, auth, folderPath)) === null) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Looks up a filebrowser folder id by CUBE path.
 *
 * @param url - CUBE API base URL.
 * @param auth - Authorization headers.
 * @param folderPath - CUBE path without its leading slash.
 * @returns The folder id, or null when the folder does not exist.
 */
async function folderId_find(url: string, auth: Record<string, string>, folderPath: string): Promise<number | null> {
  const search: string = `${url}filebrowser/search/?path=${encodeURIComponent(folderPath)}`;
  const response: Response = await fetch(search, { headers: auth });
  if (!response.ok) return null;
  const body: { count: number; results: Array<{ id: number }> } =
    (await response.json()) as { count: number; results: Array<{ id: number }> };
  return body.count > 0 ? body.results[0].id : null;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
