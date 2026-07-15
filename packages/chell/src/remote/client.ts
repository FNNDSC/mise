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
import { RemoteEngine } from './remoteEngine.js';
import { LocalBerthResolver, type Berth } from '@fnndsc/calypso';
import { surface_get } from '@fnndsc/brasa';

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
 * @returns A promise that resolves when the client session ends.
 */
export async function remote_run(identity?: string): Promise<void> {
  const berth: Berth | null = await berth_select(identity);
  if (!berth) {
    process.exit(1);
  }

  let engine: RemoteEngine;
  try {
    engine = await RemoteEngine.connect({
      url: berth.url,
      token: berth.token,
      onSession: (surface: string, envelope: CommandEnvelope): void => {
        if (envelope.rendered.length > 0) {
          process.stdout.write(`\n${chalk.gray(`[surface ${surface.slice(0, 6)}]`)}\n${envelope.rendered}`);
        }
      },
      onPrompt: (message: string, hidden: boolean): Promise<string> =>
        // The REPL has installed the CLI surface (readline-backed) by the time
        // a prompt can arrive, so this reads from the local terminal.
        surface_get().prompt({ message, hidden }),
      onPipe: (command: string, input: Buffer): Promise<Buffer> =>
        // Pipeline segments run on this machine, through the client's own
        // tools — never on the daemon host.
        surface_get().pipeSegment(command, input),
      onEdit: (content: string, extension: string | undefined): Promise<{ content: string; changed: boolean }> =>
        // Editing happens in this machine's editor.
        surface_get().localEdit({ content, extension }),
      onClose: (): void => {
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

  console.log(chalk.green(`[+] Attached to CALYPSO daemon ${berth.identity} at ${berth.url}`));
  console.log(chalk.gray("    Type 'exit' to detach.\n"));

  // The daemon pushes the themed prompt string; the REPL renders whatever the
  // daemon last sent, falling back until the first push arrives.
  const repl: REPL = new REPL(engine, {
    promptText: (): string => engine.promptLine() || 'chell(remote) ❯ ',
  });
  await repl.start();
}
