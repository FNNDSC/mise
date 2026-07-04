/**
 * @file Exemplar 01 — connect and identify.
 *
 * Demonstrates the minimal life of a cumin client program: isolate config,
 * authenticate against a CUBE, confirm who you are, and confirm the PACS
 * service is visible. Run with CUBE_URL/CUBE_USER/CUBE_PASSWORD set:
 *
 *   node exemplars/ts/dist/01_connect.js
 *
 * @module
 */

import { currentUser_get, pacsServers_list, Result, ChrisUser, PACSServer } from '@fnndsc/cumin';
import { env_load, config_isolate, cube_connect, check, section, summary_exit, CubeEnv } from './lib/harness.js';

/**
 * Connects to the CUBE and verifies identity and PACS visibility.
 */
async function main(): Promise<void> {
  const env: CubeEnv = env_load();
  config_isolate();

  section('authenticate');
  const token: string = await cube_connect(env);
  check('received an auth token', token.length > 0);

  section('identify');
  const user: Result<ChrisUser> = await currentUser_get();
  check('fetched the current user', user.ok);
  if (user.ok) {
    check(`logged in as ${env.user}`, user.value.username === env.user);
  }

  section('PACS visibility');
  const servers: Result<PACSServer[]> = await pacsServers_list();
  check('listed PACS servers', servers.ok);
  if (servers.ok) {
    check(
      `configured PACS '${env.pacs}' is registered`,
      servers.value.some((s: PACSServer) => s.identifier === env.pacs),
    );
  }

  summary_exit();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
