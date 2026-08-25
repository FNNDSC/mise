/**
 * @file Exemplar 06 — mock-free wire round trip, no CUBE required.
 *
 * A real chell `RemoteEngine` attaches to a real in-process `CalypsoDaemon`
 * over a real WebSocket, and every surface capability crosses the wire:
 * attach, execute, completion, pipeline segments, shell escapes, prompts,
 * and local edits. Two hosted engines are exercised — the real brasa engine
 * (disconnected: builtins, pipes, shell escapes) and a small scripted engine
 * that drives the prompt/edit capability seam deterministically (the real
 * builtins that prompt or edit require a live CUBE).
 *
 * Unlike the other exemplars this needs no credentials, so it gates every
 * pull request in CI:
 *
 *   node exemplars/ts/dist/06_wireRoundtrip.js
 *
 * @module
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { CommandEnvelope } from '@fnndsc/cumin';
import { CalypsoDaemon, daemonSurface_create, DaemonSink } from '@fnndsc/calypso';
import {
  engine_create,
  segment_pipeThrough,
  sinkScope_run,
  surface_get,
  surface_set,
  type BrasaEngine,
  type CompletionResult,
  type LocalEditResult,
} from '@fnndsc/brasa';
import { RemoteEngine } from '@fnndsc/chell/dist/remote/remoteEngine.js';
import { config_isolate, check, section, summary_exit } from './lib/harness.js';

const TOKEN: string = 'wire-roundtrip-token';

/** Runs a host-shell command for the client side, exactly as a surface would. */
function shell_run(command: string): Promise<number> {
  return new Promise((resolve: (code: number) => void) => {
    const child: ChildProcess = spawn('sh', ['-c', command], { stdio: 'ignore' });
    child.on('close', (code: number | null) => resolve(code ?? 1));
  });
}

/**
 * Joins the rendered channels of a command's envelopes.
 *
 * @param envelopes - The envelopes a command returned.
 * @returns The concatenated rendered and error text.
 */
function rendered_join(envelopes: CommandEnvelope[]): string {
  return envelopes.map((envelope: CommandEnvelope): string =>
    `${envelope.rendered ?? ''}${envelope.renderedErr ?? ''}`).join('');
}

/**
 * Drives the real brasa engine over the wire: execute, completion, pipes,
 * and shell escapes.
 */
async function realEngine_roundtrip(): Promise<void> {
  section('real engine: attach and execute');

  // tag::daemonHost[]
  const engine: BrasaEngine = await engine_create();
  const pipeCommands: string[] = [];
  const shellCommands: string[] = [];

  // The hosted engine runs each line with the daemon sink scoped in, so live
  // output crosses the wire instead of leaking to this process's stdout. The
  // sink needs the daemon, which needs this wrapper: the wrapper closes over
  // the binding, assigned right after construction.
  let sinkForDaemon: DaemonSink;
  const daemon: CalypsoDaemon = new CalypsoDaemon({
    engine: {
      line_execute: (line: string): Promise<CommandEnvelope[]> =>
        sinkScope_run(sinkForDaemon, (): Promise<CommandEnvelope[]> => engine.line_execute(line)),
      line_complete: (prefix: string) => engine.line_complete(prefix),
    },
    token: TOKEN,
    port: 0,
  });
  sinkForDaemon = new DaemonSink(daemon);
  surface_set(daemonSurface_create(daemon));
  // end::daemonHost[]

  // tag::clientAttach[]
  const port: number = await daemon.start();
  const client: RemoteEngine = await RemoteEngine.connect({
    url: `ws://127.0.0.1:${port}`,
    token: TOKEN,
    onPipe: (command: string, input: Buffer): Promise<Buffer> => {
      pipeCommands.push(command);
      return segment_pipeThrough(command, input);
    },
    onShell: (command: string): Promise<number> => {
      shellCommands.push(command);
      return shell_run(command);
    },
  });
  // end::clientAttach[]
  check('attached over the WebSocket handshake', true);

  // tag::execute[]
  const helpEnvelopes: CommandEnvelope[] = await client.line_execute('help');
  check('help returned an ok envelope', helpEnvelopes[0]?.status === 'ok');
  check('help rendered its text across the wire', rendered_join(helpEnvelopes).includes('help'));
  // end::execute[]

  const badEnvelopes: CommandEnvelope[] = await client.line_execute('definitelynotacommand');
  check('unknown command returned an error envelope', badEnvelopes[0]?.status === 'error');

  section('real engine: completion');
  const completion: CompletionResult = await client.line_complete('hel');
  check('completion offered help for "hel"', completion.candidates.includes('help'));

  section('real engine: pipeline segments run on the client');
  const pipeEnvelopes: CommandEnvelope[] = await client.line_execute('help | tr a-z A-Z');
  check('the pipe segment reached the client', pipeCommands.length === 1 && pipeCommands[0] === 'tr a-z A-Z');
  check('the piped output threaded back through the daemon', rendered_join(pipeEnvelopes).includes('HELP'));

  section('real engine: shell escapes run on the client');
  const okShell: CommandEnvelope[] = await client.line_execute('!true');
  check('the shell command reached the client', shellCommands.includes('true'));
  check('exit 0 mapped to an ok envelope', okShell[0]?.status === 'ok');
  const errShell: CommandEnvelope[] = await client.line_execute('!exit 7');
  check('exit 7 mapped to an error envelope', errShell[0]?.status === 'error');

  await daemon.stop();
}

/**
 * Drives the prompt and local-edit capability seams over the wire with a
 * scripted hosted engine.
 */
async function capability_roundtrip(): Promise<void> {
  section('capabilities: prompt and local edit');

  let promptMessage: string = '';
  let promptHidden: boolean = false;
  let editContent: string = '';
  let editExtension: string | undefined;

  const daemon: CalypsoDaemon = new CalypsoDaemon({
    engine: {
      line_execute: async (line: string): Promise<CommandEnvelope[]> => {
        if (line === 'ask') {
          const answer: string = await surface_get().prompt({ message: 'Password: ', hidden: true });
          return [{ status: 'ok', rendered: `answered:${answer}\n` }];
        }
        if (line === 'revise') {
          const edit: LocalEditResult = await surface_get().localEdit({ content: 'draft text', extension: '.txt' });
          return [{ status: 'ok', rendered: `edited:${edit.changed}:${edit.content}\n` }];
        }
        return [{ status: 'error', rendered: '' }];
      },
      line_complete: async () => ({ candidates: [], prefix: '' }),
    },
    token: TOKEN,
    port: 0,
  });
  surface_set(daemonSurface_create(daemon));

  const port: number = await daemon.start();
  const client: RemoteEngine = await RemoteEngine.connect({
    url: `ws://127.0.0.1:${port}`,
    token: TOKEN,
    onPrompt: async (message: string, hidden: boolean): Promise<string> => {
      promptMessage = message;
      promptHidden = hidden;
      return 'sekrit';
    },
    onEdit: async (content: string, extension: string | undefined): Promise<{ content: string; changed: boolean }> => {
      editContent = content;
      editExtension = extension;
      return { content: 'REVISED TEXT', changed: true };
    },
  });

  const askEnvelopes: CommandEnvelope[] = await client.line_execute('ask');
  check('the hidden prompt reached the client', promptMessage === 'Password: ' && promptHidden);
  check('the answer threaded back to the engine', rendered_join(askEnvelopes) === 'answered:sekrit\n');

  const editEnvelopes: CommandEnvelope[] = await client.line_execute('revise');
  check('the edit content reached the client', editContent === 'draft text' && editExtension === '.txt');
  check('the edited result threaded back to the engine', rendered_join(editEnvelopes) === 'edited:true:REVISED TEXT\n');

  await daemon.stop();
}

/**
 * Runs both round trips and reports.
 */
async function main(): Promise<void> {
  config_isolate();
  await realEngine_roundtrip();
  await capability_roundtrip();
  summary_exit();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
