/**
 * @file Standalone example — program with the shell's vocabulary.
 *
 * The complete program: connect with cumin, create the real chell engine,
 * and then work entirely in shell metaphors. No salsa calls appear here;
 * the API is `ls`, `mkdir`, `touch`, `cat`, `rm`, exactly the lines a chell
 * user would type, each returning typed envelopes instead of printing to a
 * terminal.
 *
 * Run with the CUBE settings in the environment:
 *
 *   CUBE_URL=https://cube.chrisproject.org/api/v1/ \
 *   CUBE_USER=alice CUBE_PASSWORD=secret \
 *   node exemplars/ts/dist/standalone/chell_vocabulary.js
 *
 * @module
 */
import { chrisConnection_init, NodeStorageProvider, type CommandEnvelope } from '@fnndsc/cumin';
import { engine_create, type BrasaEngine } from '@fnndsc/brasa';

/**
 * Executes one shell line and returns its first envelope, exiting on error.
 *
 * @param engine - The chell engine.
 * @param line - The shell line to run, exactly as a user would type it.
 * @returns The command's envelope.
 */
async function line_run(engine: BrasaEngine, line: string): Promise<CommandEnvelope> {
  const envelopes: CommandEnvelope[] = await engine.line_execute(line);
  const first: CommandEnvelope | undefined = envelopes[0];
  if (!first || first.status !== 'ok') {
    console.error(`failed: ${line}\n${first?.renderedErr ?? ''}`);
    process.exit(1);
  }
  return first;
}

/**
 * Round-trips a file through the CUBE filesystem in shell vocabulary.
 */
async function main(): Promise<void> {
  const url: string | undefined = process.env.CUBE_URL;
  const user: string | undefined = process.env.CUBE_USER;
  const password: string | undefined = process.env.CUBE_PASSWORD;
  if (!url || !user || !password) {
    console.error('Set CUBE_URL, CUBE_USER and CUBE_PASSWORD.');
    process.exit(2);
  }

  const connection = await chrisConnection_init(new NodeStorageProvider());
  if (!(await connection.connection_connect({ url, user, password, debug: false }))) {
    console.error('Authentication failed.');
    process.exit(1);
  }

  // The same engine chell's REPL drives; here your program is the surface.
  const engine: BrasaEngine = await engine_create();

  const scratch: string = `/home/${user}/vocab-${Date.now().toString(36)}`;
  const content: string = 'hello from the shell vocabulary';

  await line_run(engine, 'pwd');
  await line_run(engine, `mkdir ${scratch}`);
  await line_run(engine, `touch --withContents "${content}" ${scratch}/hello.txt`);

  // `cat` returns the file's bytes in the envelope's rendered channel.
  const catted: CommandEnvelope = await line_run(engine, `cat ${scratch}/hello.txt`);
  if (!(catted.rendered ?? '').includes(content)) {
    console.error('cat did not return the written content');
    process.exit(1);
  }
  console.log('round trip verified, in shell vocabulary');

  // Cleanup would be `rm -r` here too, but deletion from a headless engine
  // currently trips a known defect (interactive chell and .chell scripts are
  // unaffected), so this program drops to the filebrowser REST endpoint the
  // same way the intent-API example does.
  const removed: boolean = await folder_delete(url, user, password, scratch.slice(1));
  console.log(removed ? `removed ${scratch}` : `could not remove ${scratch}; delete it via chell or the UI`);
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

  const search = async (): Promise<number | null> => {
    const response: Response = await fetch(
      `${url}filebrowser/search/?path=${encodeURIComponent(folderPath)}`,
      { headers: auth },
    );
    if (!response.ok) return null;
    const body: { count: number; results: Array<{ id: number }> } =
      (await response.json()) as { count: number; results: Array<{ id: number }> };
    return body.count > 0 ? body.results[0].id : null;
  };

  const folderId: number | null = await search();
  if (folderId === null) return true;
  const deleted: Response = await fetch(`${url}filebrowser/${folderId}/`, { method: 'DELETE', headers: auth });
  if (deleted.status !== 202 && deleted.status !== 204) return false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await search()) === null) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
