/**
 * @file The `chell --remote` client.
 *
 * Attaches to a same-user CALYPSO daemon and drives it with the ordinary REPL,
 * proving the sibling-surfaces topology: the same REPL runs over either an
 * in-process engine or a remote one. The remote engine delivers received
 * output to the sink exactly as the local engine delivers live, so the REPL is
 * unchanged. Another surface's activity (the session bus) is printed as it
 * arrives.
 *
 * With identity-keyed berths, several daemons — one per `<user>@<url>` — can run
 * on one machine. This client resolves the berth to attach: by identity when one
 * was given (`chell --remote me@https://cube/api/v1/`), else the sole live berth,
 * else an interactive pick among several. A dead berth is reaped on the failed
 * probe. See docs/session-supervisor.adoc.
 *
 * @module
 */
import { createInterface, type Interface } from 'node:readline/promises';
import chalk from 'chalk';
import type { CommandEnvelope } from '@fnndsc/cumin';
import { REPL } from '../core/repl.js';
import { RemoteEngine, type DaemonStack } from './remoteEngine.js';
import { LocalBerthResolver, type Berth } from '@fnndsc/calypso';
import { sink_set, StdoutSink, surface_get, surface_set, welcomeLine_build, welcomeLine_compose, fortune_random } from '@fnndsc/brasa';
import { cliSurface_create } from '../core/cliSurface.js';
import type { FileDeliverRequest, FileDeliverResult } from '@fnndsc/menu';
import { TerminalProgressRenderer } from '../core/progressRenderer.js';
import { surfaceLine_execute } from '../core/surfaceDispatch.js';

/**
 * Builds a berth from an address given on the command line.
 *
 * Berth discovery reads this machine's runtime directory, so it cannot see a
 * daemon on another host. An explicit address is how a surface elsewhere
 * attaches, and the address accepted is the one the daemon prints — either the
 * ARGUS link, token and all, or the bare wire URL with `--token` beside it.
 *
 * @param address - `ws://host:port`, or `http://host:port/?token=…`.
 * @param token - The attach token, when the address does not carry one.
 * @returns The berth to attach, or null when the address cannot be read (a
 *   message is printed).
 */
export function berth_fromAddress(address: string, token?: string): Berth | null {
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    console.error(chalk.red(`[!] '${address}' is not a URL. Paste the address the daemon printed.`));
    return null;
  }

  const carried: string | null = parsed.searchParams.get('token');
  const attachToken: string | undefined = token ?? carried ?? undefined;
  if (attachToken === undefined) {
    console.error(chalk.red('[!] No attach token. Pass --token, or paste the URL the daemon printed, which carries one.'));
    return null;
  }

  // The daemon serves the web surface and the wire on one port, so an http
  // address names the same endpoint as its ws form.
  const scheme: string = parsed.protocol === 'https:' || parsed.protocol === 'wss:' ? 'wss' : 'ws';
  if (!parsed.hostname) {
    console.error(chalk.red(`[!] '${address}' names no host.`));
    return null;
  }
  const url: string = `${scheme}://${parsed.host}`;
  return { identity: `${url} (attached by address)`, url, token: attachToken };
}

/**
 * Fetches a file's bytes from a daemon's token-gated byte route.
 *
 * A remote client's engine is on another machine, so it cannot read the file
 * itself. It uses the same `/vfs` route a browser surface uses to render a
 * file natively — the intent travelled through the vocabulary, and only the
 * bytes travel here.
 *
 * @param berth - The daemon to fetch from, carrying its URL and attach token.
 * @returns A fetch bound to that daemon.
 */
function berthBytes_fetch(berth: Berth): (filePath: string) => Promise<Buffer> {
  return async (filePath: string): Promise<Buffer> => {
    const base: string = berth.url.replace(/^ws/, 'http');
    const url: string =
      `${base}/vfs?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(berth.token)}`;
    const response: Response = await fetch(url);
    if (!response.ok) {
      throw new Error(`the daemon refused to serve ${filePath} (HTTP ${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
  };
}

/**
 * Probes whether a berth's daemon is reachable, by performing the real attach
 * handshake and immediately closing. A rejected connect means the daemon is
 * gone, so the local resolver reaps the stale berth.
 *
 * @param berth - The berth to test.
 * @returns True when the daemon answered the attach handshake.
 */
export async function berth_probeLive(berth: Berth): Promise<boolean> {
  try {
    const probe: RemoteEngine = await RemoteEngine.connect({ url: berth.url, token: berth.token });
    probe.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Prompts the operator to choose one berth from several, over the terminal.
 *
 * @param berths - The live berths to choose among.
 * @returns The chosen berth, or null when the choice was invalid or aborted.
 */
async function berth_pick(berths: Berth[]): Promise<Berth | null> {
  console.log(chalk.cyan('Several CALYPSO daemons are running:'));
  berths.forEach((berth: Berth, index: number): void => {
    console.log(`  ${chalk.bold(String(index + 1))}. ${berth.identity}  ${chalk.gray(berth.url)}`);
  });
  const rl: Interface = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer: string = await rl.question(chalk.cyan(`Attach to which? [1-${berths.length}] `));
    const choice: number = parseInt(answer.trim(), 10);
    if (isNaN(choice) || choice < 1 || choice > berths.length) {
      console.error(chalk.red('[!] Invalid choice.'));
      return null;
    }
    return berths[choice - 1];
  } finally {
    rl.close();
  }
}

/**
 * Selects the berth to attach to: by identity when given, else the sole live
 * berth, else an interactive pick (a non-interactive caller must be explicit).
 *
 * @param identity - The normalised identity to attach to, or undefined for a
 *   bare `--remote`.
 * @returns The berth to attach, or null when none can be resolved (a message is
 *   printed).
 */
async function berth_select(identity: string | undefined): Promise<Berth | null> {
  const resolver: LocalBerthResolver = new LocalBerthResolver(berth_probeLive);

  if (identity) {
    const berth: Berth | null = await resolver.resolve(identity);
    if (!berth) {
      console.error(chalk.red(`[!] No live CALYPSO daemon for ${identity}. Start one with:  chell --daemon ${identity}`));
    }
    return berth;
  }

  const berths: Berth[] = await resolver.list();
  if (berths.length === 0) {
    console.error(chalk.red('[!] No CALYPSO daemon found. Start one with:  chell --daemon <user>@<url>'));
    return null;
  }
  if (berths.length === 1) {
    return berths[0];
  }
  if (!process.stdin.isTTY) {
    console.error(chalk.red('[!] Several daemons are running; specify one:  chell --remote <user>@<url>'));
    for (const berth of berths) {
      console.error(`      ${berth.identity}  ${chalk.gray(berth.url)}`);
    }
    return null;
  }
  return berth_pick(berths);
}

/**
 * Runs the remote client: resolves a daemon berth, attaches, and enters the
 * REPL.
 *
 * @param identity - The normalised `<user>@<url>` to attach to, or undefined to
 *   resolve the sole/most-suitable berth.
 * @param commandToExecute - An optional one-shot command. When present, execute
 *   it and detach without creating an interactive REPL.
 * @param attach - An explicit daemon address, for a daemon on another machine
 *   that this host's berth directory cannot know about. Bypasses discovery.
 * @returns A promise that resolves when the client session ends.
 */
export async function remote_run(
  identity?: string,
  commandToExecute?: string,
  attach?: { address: string; token?: string },
): Promise<void> {
  const berth: Berth | null = attach
    ? berth_fromAddress(attach.address, attach.token)
    : await berth_select(identity);
  if (!berth) {
    process.exit(1);
  }

  let engine: RemoteEngine;
  let intentionalClose: boolean = false;
  try {
    engine = await RemoteEngine.connect({
      url: berth.url,
      token: berth.token,
      onSession: commandToExecute === undefined
        ? (surface: string, envelope: CommandEnvelope): void => {
            if (envelope.rendered.length > 0) {
              process.stdout.write(`\n${chalk.gray(`[surface ${surface.slice(0, 6)}]`)}\n${envelope.rendered}`);
            }
          }
        : undefined,
      onPrompt: (message: string, hidden: boolean): Promise<string> =>
        // The REPL has installed the CLI surface (readline-backed) by the time
        // a prompt can arrive, so this reads from the local terminal.
        surface_get().prompt({ message, hidden }),
      onPipe: (command: string, input: Buffer): Promise<Buffer> =>
        // Pipeline segments run on this machine, through the client's own
        // tools — never on the daemon host.
        surface_get().pipeSegment(command, input),
      onShell: (command: string): Promise<number> =>
        // Host-shell escapes belong to the attached surface, so `!cmd` runs
        // on this client machine and never on the daemon host.
        surface_get().shellCommand(command),
      onEdit: (content: string, extension: string | undefined): Promise<{ content: string; changed: boolean }> =>
        // Editing happens in this machine's editor.
        surface_get().localEdit({ content, extension }),
      onDeliver: (request: FileDeliverRequest): Promise<FileDeliverResult> =>
        // A downloaded file lands on this machine's disk, never the daemon's.
        surface_get().fileDeliver(request),
      onClose: (): void => {
        if (intentionalClose) return;
        console.log(chalk.yellow('\n[!] Daemon disconnected.'));
        process.exit(0);
      },
    });
  } catch (err: unknown) {
    const message: string = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`[!] Could not attach to the daemon: ${message}`));
    process.exit(1);
    return;
  }

  if (commandToExecute !== undefined) {
    const progressRenderer: TerminalProgressRenderer = new TerminalProgressRenderer();
    sink_set(new StdoutSink(progressRenderer));
    surface_set(cliSurface_create(undefined, berthBytes_fetch(berth)));
    try {
      const envelopes: CommandEnvelope[] = await surfaceLine_execute(engine, commandToExecute);
      process.exitCode = envelopes.some((envelope: CommandEnvelope): boolean => envelope.status === 'error') ? 1 : 0;
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      process.exitCode = 1;
      console.error(chalk.red(`Command error: ${message}`));
    } finally {
      // Nothing announced by the command may outlive it; see the same clear in
      // the REPL's line handler.
      progressRenderer.clear();
      intentionalClose = true;
      engine.close();
    }
    return;
  }

  // Greet with the daemon's own reported versions and build hash; a daemon
  // that predates the handshake field falls back to the local install's.
  const stack: DaemonStack | undefined = engine.daemonStack();
  const welcome: string = stack !== undefined
    ? welcomeLine_compose('chell', stack.chell, stack.build)
    : welcomeLine_build('chell');
  console.log(chalk.bold.cyan(welcome));
  console.log(chalk.green(`[+] Attached to CALYPSO daemon ${berth.identity} at ${berth.url}`));
  if (stack !== undefined) {
    // Banner the daemon's whole stack, one aligned line per layer; older
    // daemons report only chell and calypso.
    const layers: Array<[string, string | undefined]> = [
      ['chell', stack.chell], ['brasa', stack.brasa], ['chili', stack.chili],
      ['salsa', stack.salsa], ['cumin', stack.cumin], ['calypso', stack.calypso],
    ];
    const present: Array<[string, string]> = layers.filter(
      (entry: [string, string | undefined]): entry is [string, string] => entry[1] !== undefined,
    );
    const pkgWidth: number = Math.max(...present.map(([pkg]: [string, string]) => pkg.length));
    for (const [pkg, version] of present) {
      console.log(chalk.gray(`    ${pkg.padEnd(pkgWidth)}  ${version}`));
    }
  }
  const hostControl: string[] = engine.hostControl ?? [];
  if (hostControl.length > 0) {
    // The daemon acts on its own host: `!`, pipes, and the disk are the
    // daemon's, not this machine's. Said once here, and on every prompt.
    console.log(chalk.yellow(`[!] HOST CONTROL: ${hostControl.join(' ')} — \`!\` and pipes run on the daemon host, upload/download reach ITS disk`));
  }
  console.log(chalk.gray("    Type 'exit' to detach.\n"));
  console.log(chalk.gray(fortune_random(4)));
  console.log('');

  // The daemon pushes the themed prompt string; the REPL renders whatever the
  // daemon last sent, falling back until the first push arrives.
  const repl: REPL = new REPL(engine, {
    promptText: (): string => engine.promptLine() || 'chell(remote) ❯ ',
    // The engine is on the daemon, so this surface fetches bytes from it
    // rather than reading a file it has no access to.
    bytesFetch: berthBytes_fetch(berth),
  });
  await repl.start();
}
