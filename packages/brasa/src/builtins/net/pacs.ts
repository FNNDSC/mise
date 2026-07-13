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
import { chrisContext, pacsServers_list, PACSServer, type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { builtin_query } from './query.js';
import { builtin_pull } from '../fs/pull.js';
import { args_checkHasHelpFlag, help_render } from '../help.js';
import { sink_dataLine, sink_errLine } from '../../core/sink.js';

/**
 * Streams the list of registered PACS servers, marking the active one.
 *
 * @param active - Current active PACS server identifier or null.
 */
async function servers_print(active: string | null): Promise<void> {
  const result = await pacsServers_list();

  if (!result.ok || result.value.length === 0) {
    sink_dataLine(chalk.yellow('No PACS servers registered in CUBE.'));
    return;
  }

  sink_dataLine('');
  for (const srv of result.value) {
    const label: string = srv.identifier ?? srv.name ?? String(srv.id);
    const isActive: boolean =
      active !== null &&
      (label === active || String(srv.id) === active);
    const marker: string = isActive ? chalk.green(' ✓ active') : '';
    const idStr: string = chalk.gray(`[${srv.id}]`);
    sink_dataLine(`  ${idStr}  ${chalk.cyan(label.padEnd(20))}${marker}`);
  }
  sink_dataLine('');
  sink_dataLine(chalk.gray('  Use: pacs connect <name|id>'));
  sink_dataLine('');
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
 * @returns An envelope; streaming subcommands carry empty rendered text and
 *   emit their output live, while query/pull return their own envelopes.
 */
export async function builtin_pacs(args: string[]): Promise<CommandEnvelope> {
  if (args_checkHasHelpFlag(args, 'pacs')) {
    return envelope_ok(help_render('pacs'));
  }

  const subcommand: string | undefined = args[0];

  // No subcommand — show active server
  if (!subcommand) {
    const active: string | null = await chrisContext.PACSserver_get();
    if (active) {
      sink_dataLine(`Active PACS server: ${chalk.cyan(active)}`);
      sink_dataLine(chalk.gray('  pacs connect         — list all servers'));
      sink_dataLine(chalk.gray('  pacs disconnect      — clear active server'));
    } else {
      sink_dataLine(chalk.yellow('No PACS server set.'));
      sink_dataLine(chalk.gray('  pacs connect         — list available servers'));
      sink_dataLine(chalk.gray('  pacs connect <id>    — set active server'));
    }
    return envelope_ok('');
  }

  switch (subcommand) {
    case 'connect': {
      const target: string | undefined = args[1];
      if (!target) {
        const active: string | null = await chrisContext.PACSserver_get();
        await servers_print(active);
        return envelope_ok('');
      }
      const ok: boolean = await chrisContext.PACSserver_set(target);
      if (ok) {
        sink_dataLine(chalk.green(`[+] PACS server set to '${target}'`));
        return envelope_ok('');
      }
      sink_errLine(chalk.red(`pacs connect: Failed to set server '${target}'`));
      process.exitCode = 1;
      return envelope_error('');
    }

    case 'disconnect': {
      const ok: boolean = await chrisContext.PACSserver_set('');
      if (ok) {
        sink_dataLine(chalk.green('[-] PACS server context cleared.'));
        return envelope_ok('');
      }
      sink_errLine(chalk.red('pacs disconnect: Failed to clear PACS server context.'));
      process.exitCode = 1;
      return envelope_error('');
    }

    case 'list': {
      const active: string | null = await chrisContext.PACSserver_get();
      await servers_print(active);
      return envelope_ok('');
    }

    case 'query':
      return builtin_query(args.slice(1));

    case 'pull':
      return builtin_pull(args.slice(1));

    default:
      sink_errLine(chalk.red(`pacs: Unknown subcommand '${subcommand}'`));
      sink_dataLine(chalk.gray('  Subcommands: connect, disconnect, list, query, pull'));
      sink_dataLine(chalk.gray('  Try: help pacs'));
      process.exitCode = 1;
      return envelope_error('');
  }
}
