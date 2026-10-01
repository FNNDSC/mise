/**
 * @file Builtin `netstat`: what the session has asked of CUBE.
 *
 * A navigation that felt slow was fourteen requests where four would do,
 * and nothing in the session could say so. `netstat` reads the kernel's
 * request ledger: how many requests since the session began (or the last
 * `netstat -r`), by endpoint family with the time spent, and the last few
 * timed. Smoke asserts budgets against the same model; an operator on a
 * slow day asks it before guessing where the time went.
 */
import chalk from 'chalk';
import { type CommandEnvelope, envelope_ok, envelope_error, requestLedger_snapshot, requestLedger_reset, type LedgerSnapshot, type LedgerFamily, type LedgerEntry } from '@fnndsc/cumin';
import { NET_STATS_MODEL_KIND } from '@fnndsc/menu';

/** How many recent requests the table shows unless asked otherwise. */
const LAST_SHOWN: number = 10;

/**
 * Renders the ledger: the total, the families, the last requests.
 *
 * @param snapshot - The ledger.
 * @param last - How many recent requests to list.
 * @returns The text, coloured.
 */
export function netstat_render(snapshot: LedgerSnapshot, last: number): string {
  const lines: string[] = [];
  lines.push(`${chalk.cyan('REQUESTS')} ${chalk.bold(String(snapshot.total))} since ${snapshot.since}  ${chalk.gray(`${snapshot.ms} ms on the wire`)}`);
  if (snapshot.families.length > 0) {
    const width: number = Math.max(...snapshot.families.map((f: LedgerFamily): number => f.family.length));
    for (const family of snapshot.families) {
      lines.push(`  ${family.family.padEnd(width)}  ${String(family.count).padStart(5)}  ${chalk.gray(`${family.ms} ms`)}`);
    }
  }
  const recent: LedgerEntry[] = snapshot.last.slice(-last);
  if (recent.length > 0) {
    lines.push(chalk.cyan(`LAST ${recent.length}`));
    for (const entry of recent) {
      const status: string = entry.status === 0 ? chalk.red('FAIL') : entry.status >= 400 ? chalk.yellow(String(entry.status)) : chalk.green(String(entry.status));
      lines.push(`  ${String(entry.ms).padStart(5)} ms  ${status}  ${entry.method.padEnd(4)} ${entry.path}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * `netstat [-n <count>] [-r]`
 *
 * @param args - `-n <count>` lists that many recent requests; `-r` / `--reset`
 *   forgets the count (the readout then shows what was forgotten).
 * @returns The ledger as text and as the `net.stats` model.
 */
export async function builtin_netstat(args: string[] = []): Promise<CommandEnvelope> {
  let last: number = LAST_SHOWN;
  let reset: boolean = false;
  for (let index: number = 0; index < args.length; index++) {
    const arg: string = args[index] as string;
    if (arg === '-r' || arg === '--reset') { reset = true; continue; }
    if (arg === '-n') {
      const value: number = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 0) return envelope_error('', undefined, `${chalk.red('netstat: -n takes a count')}\n`);
      last = value;
      index += 1;
      continue;
    }
    return envelope_error('', undefined, `${chalk.red(`netstat: unknown option ${arg}`)}\n`);
  }
  const snapshot: LedgerSnapshot = requestLedger_snapshot({ last: Math.max(last, LAST_SHOWN) });
  if (reset) requestLedger_reset();
  const rendered: string = netstat_render(snapshot, last) + (reset ? `${chalk.gray('count reset')}\n` : '');
  return envelope_ok(rendered, { kind: NET_STATS_MODEL_KIND, data: snapshot });
}
