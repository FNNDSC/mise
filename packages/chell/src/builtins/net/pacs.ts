/**
 * @file Compound `pacs` command.
 *
 * Entry point for all PACS operations: server context management, querying,
 * and series retrieval. `pacs query` and `pacs pull` delegate to the standalone
 * builtins, which remain registered as permanent top-level aliases.
 *
 * @module
 */

import chalk from 'chalk';
import { chrisContext, pacsServers_list, PACSServer } from '@fnndsc/cumin';
import { builtin_query } from './query.js';
import { builtin_pull } from '../fs/pull.js';
import { args_checkHasHelpFlag, help_show } from '../help.js';

/**
 * Prints the list of registered PACS servers, marking the active one.
 *
 * @param active - Current active PACS server identifier or null.
 */
async function servers_print(active: string | null): Promise<void> {
  const result = await pacsServers_list();

  if (!result.ok || result.value.length === 0) {
    console.log(chalk.yellow('No PACS servers registered in CUBE.'));
    return;
  }

  console.log('');
  for (const srv of result.value) {
    const label: string = srv.identifier ?? srv.name ?? String(srv.id);
    const isActive: boolean =
      active !== null &&
      (label === active || String(srv.id) === active);
    const marker: string = isActive ? chalk.green(' ✓ active') : '';
    const idStr: string = chalk.gray(`[${srv.id}]`);
    console.log(`  ${idStr}  ${chalk.cyan(label.padEnd(20))}${marker}`);
  }
  console.log('');
  console.log(chalk.gray('  Use: pacs connect <name|id>'));
  console.log('');
}

/**
 * PACS subsystem command — server context management, query, and pull.
 *
 * Subcommands:
 *   pacs                      — show active server
 *   pacs connect              — list servers with active marked
 *   pacs connect <name|id>    — set active PACS server
 *   pacs disconnect           — clear active PACS server
 *   pacs list                 — list servers (alias for: pacs connect)
 *   pacs query <Key:Value...> — create PACS query and wait for results
 *   pacs pull <vfs-path...>   — pull DICOM series into ChRIS storage
 *
 * @param args - Command arguments (subcommand + its own args).
 */
export async function builtin_pacs(args: string[]): Promise<void> {
  if (args_checkHasHelpFlag(args, 'pacs')) {
    help_show('pacs');
    return;
  }

  const subcommand: string | undefined = args[0];

  // No subcommand — show active server
  if (!subcommand) {
    const active: string | null = await chrisContext.PACSserver_get();
    if (active) {
      console.log(`Active PACS server: ${chalk.cyan(active)}`);
      console.log(chalk.gray('  pacs connect         — list all servers'));
      console.log(chalk.gray('  pacs disconnect      — clear active server'));
    } else {
      console.log(chalk.yellow('No PACS server set.'));
      console.log(chalk.gray('  pacs connect         — list available servers'));
      console.log(chalk.gray('  pacs connect <id>    — set active server'));
    }
    return;
  }

  switch (subcommand) {
    case 'connect': {
      const target: string | undefined = args[1];
      if (!target) {
        const active: string | null = await chrisContext.PACSserver_get();
        await servers_print(active);
        return;
      }
      const ok: boolean = await chrisContext.PACSserver_set(target);
      if (ok) {
        console.log(chalk.green(`[+] PACS server set to '${target}'`));
      } else {
        console.error(chalk.red(`pacs connect: Failed to set server '${target}'`));
        process.exitCode = 1;
      }
      return;
    }

    case 'disconnect': {
      const ok: boolean = await chrisContext.PACSserver_set('');
      if (ok) {
        console.log(chalk.green('[-] PACS server context cleared.'));
      } else {
        console.error(chalk.red('pacs disconnect: Failed to clear PACS server context.'));
        process.exitCode = 1;
      }
      return;
    }

    case 'list': {
      const active: string | null = await chrisContext.PACSserver_get();
      await servers_print(active);
      return;
    }

    case 'query':
      await builtin_query(args.slice(1));
      return;

    case 'pull':
      await builtin_pull(args.slice(1));
      return;

    default:
      console.error(chalk.red(`pacs: Unknown subcommand '${subcommand}'`));
      console.log(chalk.gray('  Subcommands: connect, disconnect, list, query, pull'));
      console.log(chalk.gray('  Try: help pacs'));
      process.exitCode = 1;
  }
}
