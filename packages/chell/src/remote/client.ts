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
 * @module
 */
import chalk from 'chalk';
import type { CommandEnvelope } from '@fnndsc/cumin';
import { REPL } from '../core/repl.js';
import { RemoteEngine } from './remoteEngine.js';
import { discovery_read, type Discovery } from '@fnndsc/calypso';
import { surface_get } from '@fnndsc/brasa';

/**
 * Runs the remote client: discovers a daemon, attaches, and enters the REPL.
 *
 * @returns A promise that resolves when the client session ends.
 */
export async function remote_run(): Promise<void> {
  const discovery: Discovery | null = discovery_read();
  if (!discovery) {
    console.error(chalk.red('[!] No CALYPSO daemon found. Start one with:  chell --daemon'));
    process.exit(1);
  }

  let engine: RemoteEngine;
  try {
    engine = await RemoteEngine.connect({
      url: discovery.url,
      token: discovery.token,
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

  console.log(chalk.green(`[+] Attached to CALYPSO daemon at ${discovery.url}`));
  console.log(chalk.gray("    Type 'exit' to detach.\n"));

  // The daemon pushes the themed prompt string; the REPL renders whatever the
  // daemon last sent, falling back until the first push arrives.
  const repl: REPL = new REPL(engine, {
    promptText: (): string => engine.promptLine() || 'chell(remote) ❯ ',
  });
  await repl.start();
}
