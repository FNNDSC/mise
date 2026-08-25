/**
 * @file Standalone example — connect to a CUBE and identify yourself.
 *
 * The complete minimal life of a cumin program: initialize the connection
 * layer, authenticate, and read back who you are. Nothing here depends on
 * any test harness; this file is the whole program.
 *
 * Run with the CUBE settings in the environment:
 *
 *   CUBE_URL=https://cube.chrisproject.org/api/v1/ \
 *   CUBE_USER=alice CUBE_PASSWORD=secret \
 *   node exemplars/ts/dist/standalone/intent_connect.js
 *
 * @module
 */
import {
  chrisConnection_init,
  NodeStorageProvider,
  currentUser_get,
  type ChRISConnection,
  type ChrisUser,
  type Result,
} from '@fnndsc/cumin';

/**
 * Connects, identifies the session user, and prints the identity.
 */
async function main(): Promise<void> {
  const url: string | undefined = process.env.CUBE_URL;
  const user: string | undefined = process.env.CUBE_USER;
  const password: string | undefined = process.env.CUBE_PASSWORD;
  if (!url || !user || !password) {
    console.error('Set CUBE_URL, CUBE_USER and CUBE_PASSWORD.');
    process.exit(2);
  }

  // cumin persists the session (URL, token) through a storage provider; the
  // Node provider keeps it under the XDG config directory, so a later
  // program, or chell itself, can resume this session without a password.
  const connection: ChRISConnection = await chrisConnection_init(new NodeStorageProvider());
  const token: string | null = await connection.connection_connect({ url, user, password, debug: false });
  if (!token) {
    console.error('Authentication failed.');
    process.exit(1);
  }

  // Every fallible call returns Result<T>: check `ok` before using `value`.
  const who: Result<ChrisUser> = await currentUser_get();
  if (!who.ok) {
    console.error('Could not fetch the current user.');
    process.exit(1);
  }

  console.log(`Connected to ${url} as ${who.value.username} (id ${who.value.id}).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
