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
import { chrisConnection_init, NodeStorageProvider, type ChRISConnection, type CommandEnvelope } from '@fnndsc/cumin';
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

  const connection: ChRISConnection = await chrisConnection_init(new NodeStorageProvider());
  if (!(await connection.connection_connect({ url, user, password, debug: false }))) {
    console.error('Authentication failed.');
    process.exit(1);
  }

  // The same engine chell's REPL drives; here your program is the surface.
  const engine: BrasaEngine = await engine_create();

  const scratch: string = `vocab-${Date.now().toString(36)}`;
  const content: string = 'hello from the shell vocabulary';

  // Work exactly as a shell user would: navigate, then use relative paths.
  await line_run(engine, `cd /home/${user}`);
  await line_run(engine, `mkdir ${scratch}`);
  await line_run(engine, `cd ${scratch}`);
  await line_run(engine, `touch --withContents "${content}" hello.txt`);

  // `cat` returns the file's bytes in the envelope's rendered channel.
  const catted: CommandEnvelope = await line_run(engine, 'cat hello.txt');
  if (!(catted.rendered ?? '').includes(content)) {
    console.error('cat did not return the written content');
    process.exit(1);
  }
  console.log('round trip verified, in shell vocabulary');

  await line_run(engine, 'cd ..');
  await line_run(engine, `rm -r ${scratch}`);
  console.log(`removed ${scratch}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
