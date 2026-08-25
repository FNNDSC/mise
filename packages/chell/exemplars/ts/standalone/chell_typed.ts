/**
 * @file Standalone example — the typed chell API.
 *
 * The complete program: connect with cumin, then drive the shell's
 * vocabulary as function calls. No command line is assembled and no parser
 * runs; each method enters the same implementation the shell's parsed
 * command enters, and returns the command's envelope with its model slot
 * typed, so results are read as data without a cast.
 *
 * Run with the CUBE settings in the environment:
 *
 *   CUBE_URL=https://cube.chrisproject.org/api/v1/ \
 *   CUBE_USER=alice CUBE_PASSWORD=secret \
 *   node exemplars/ts/dist/standalone/chell_typed.js
 *
 * @module
 */
import { chrisConnection_init, NodeStorageProvider, type ChRISConnection } from '@fnndsc/cumin';
import { chellApi_create, type ChellApi, type TypedEnvelope } from '@fnndsc/brasa';

/**
 * Round-trips a file through the CUBE filesystem in typed calls.
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

  const sh: ChellApi = await chellApi_create();
  const scratch: string = `typed-${Date.now().toString(36)}`;

  await sh.cd(`/home/${user}`);
  const where: TypedEnvelope<'fs.cwd'> = await sh.pwd();
  if (where.status !== 'ok' || !where.model) {
    console.error('pwd failed');
    process.exit(1);
  }
  console.log(`working in ${where.model.data.path}`);

  const made: TypedEnvelope<'fs.mkdir'> = await sh.mkdir(scratch);
  if (made.status !== 'ok') {
    console.error(made.renderedErr ?? 'mkdir failed');
    process.exit(1);
  }

  const wrote: TypedEnvelope<'fs.touch'> = await sh.touch(`${scratch}/hello.txt`, {
    contents: 'hello from the typed API',
  });
  // The model is data, not text: outcomes are read field by field.
  const created: boolean = wrote.status === 'ok'
    && (wrote.model?.data ?? []).every((outcome) => outcome.created);
  if (!created) {
    console.error(wrote.renderedErr ?? 'touch failed');
    process.exit(1);
  }
  console.log(`created ${wrote.model?.data[0]?.path}`);

  const gone: TypedEnvelope<'fs.rm'> = await sh.rm(scratch, { recursive: true });
  if (gone.status !== 'ok') {
    console.error(gone.renderedErr ?? 'rm failed');
    process.exit(1);
  }
  console.log(`removed ${scratch}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
