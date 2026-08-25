/**
 * @file Standalone example — host an engine behind a daemon and drive it
 * with the production remote client.
 *
 * The complete program, no CUBE and no credentials required: a real brasa
 * engine hosted by a real calypso daemon on an ephemeral port, and chell's
 * own RemoteEngine attached over a real WebSocket. One command line goes
 * across the wire; typed envelopes come back.
 *
 *   node exemplars/ts/dist/standalone/session_wire.js
 *
 * @module
 */
import type { CommandEnvelope } from '@fnndsc/cumin';
import { CalypsoDaemon, daemonSurface_create, DaemonSink } from '@fnndsc/calypso';
import { engine_create, sinkScope_run, surface_set, type BrasaEngine } from '@fnndsc/brasa';
import { RemoteEngine } from '@fnndsc/chell/dist/remote/remoteEngine.js';

/**
 * Hosts, attaches, executes one line, and prints the envelope.
 */
async function main(): Promise<void> {
  // The engine is the same one chell's REPL drives; disconnected it still
  // parses, dispatches and runs the builtins that need no CUBE.
  const engine: BrasaEngine = await engine_create();

  // The daemon hosts the engine behind a WebSocket. Scoping the daemon sink
  // around each executed line streams live output to the executing surface;
  // installing the daemon surface delegates prompts, pipes, shell escapes
  // and edits to whichever attached client runs the command.
  let sink: DaemonSink;
  const daemon: CalypsoDaemon = new CalypsoDaemon({
    engine: {
      line_execute: (line: string): Promise<CommandEnvelope[]> =>
        sinkScope_run(sink, (): Promise<CommandEnvelope[]> => engine.line_execute(line)),
      line_complete: (prefix: string) => engine.line_complete(prefix),
    },
    token: 'example-token',
    port: 0,
  });
  sink = new DaemonSink(daemon);
  surface_set(daemonSurface_create(daemon));

  const port: number = await daemon.start();

  // RemoteEngine is chell's production client: attach handshake, validated
  // messages, and the same line_execute interface as an in-process engine.
  const client: RemoteEngine = await RemoteEngine.connect({
    url: `ws://127.0.0.1:${port}`,
    token: 'example-token',
  });

  const envelopes: CommandEnvelope[] = await client.line_execute('help');
  const first: CommandEnvelope | undefined = envelopes[0];
  console.log(`status: ${first?.status}`);
  console.log(`rendered bytes: ${first?.rendered?.length ?? 0}`);

  await daemon.stop();
  process.exit(first?.status === 'ok' ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
