/**
 * @file Builtin cubepath command.
 *
 * Given one or more `/net/pacs/queries/...` VFS paths (at query, study, or series level),
 * resolves where each matching series lives in CUBE storage and reports the
 * actual file count there. Zero files means the series has not been pulled.
 *
 * @module
 */

import chalk from 'chalk';
import { Client } from '@fnndsc/cumin';
import { session } from '../../session/index.js';
import { args_checkHasHelpFlag, help_show } from '../help.js';
import { path_resolve } from '../utils.js';
import {
  ChRISPACSClient,
  PACSSeriesInfo,
  SeriesCubePath,
  pacs_seriesCollect,
  pacsServer_resolve,
  series_cubePathGet,
} from './pacsUtils.js';

/**
 * Resolves CUBE FS paths and file counts for all series under one or more PACS VFS paths.
 *
 * @param args - `<vfs-path> [...] [--pacsserver <id>] [--retry]`
 * @example
 * cubepath /net/pacs/queries/AccessionNumber:25162540_qid:2661
 * cubepath /net/pacs/queries/.../Series_1.2.3_AX_T2 /net/pacs/queries/.../Series_1.2.3_DWI
 */
export async function builtin_cubepath(args: string[]): Promise<void> {
  if (args_checkHasHelpFlag(args, 'cubepath')) {
    help_show('cubepath');
    return;
  }

  let pacsserverOverride: string | null = null;
  let retry: boolean = false;
  const positional: string[] = [];

  for (let i: number = 0; i < args.length; i++) {
    if (args[i] === '--pacsserver' && i + 1 < args.length) {
      pacsserverOverride = args[++i];
    } else if (args[i] === '--retry') {
      retry = true;
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }

  if (positional.length === 0) {
    console.error(chalk.red('cubepath: Missing path. Usage: cubepath <vfs-path> [...]'));
    process.exitCode = 1;
    return;
  }

  const pacsIdentifier: string | null = await pacsServer_resolve(pacsserverOverride);
  if (!pacsIdentifier) {
    console.error(chalk.red('cubepath: No PACS server available. Set context with: context set PACSserver <id>'));
    process.exitCode = 1;
    return;
  }

  // Collect series from all paths
  const allSeries: PACSSeriesInfo[] = [];
  for (const rawPath of positional) {
    const vfsPath: string = rawPath.startsWith('/') ? rawPath : await path_resolve(rawPath);
    if (!vfsPath.startsWith('/net/pacs')) {
      console.error(chalk.red(`cubepath: Not a PACS VFS path: ${rawPath}`));
      continue;
    }
    const found: PACSSeriesInfo[] = await pacs_seriesCollect(vfsPath, pacsIdentifier, 'cubepath');
    allSeries.push(...found);
  }

  if (allSeries.length === 0) {
    console.error(chalk.yellow('cubepath: No series found under that path.'));
    process.exitCode = 1;
    return;
  }

  const client: Client | null = await session.connection.client_get();
  if (!client) {
    console.error(chalk.red('cubepath: Not connected to ChRIS.'));
    process.exitCode = 1;
    return;
  }

  const pacsClient: ChRISPACSClient = client as unknown as ChRISPACSClient;
  const maxAttempts: number = retry ? 4 : 1;
  const retryDelayMs: number = retry ? 2_000 : 0;

  type SeriesResult = { info: PACSSeriesInfo; cubePath: SeriesCubePath | null };

  const results: SeriesResult[] =
    await Promise.all(
      allSeries.map(async (info: PACSSeriesInfo): Promise<SeriesResult> => {
        const cubePath: SeriesCubePath | null =
          await series_cubePathGet(info.seriesUID, pacsClient, maxAttempts, retryDelayMs);
        return { info, cubePath };
      }),
    );

  const maxLabelLen: number = Math.max(...results.map((r: SeriesResult) => r.info.seriesLabel.length));

  let notInCube: number = 0;
  for (const { info, cubePath } of results) {
    const label: string = info.seriesLabel.padEnd(maxLabelLen);
    const arrow: string = chalk.cyan('->');
    if (cubePath) {
      const countStr: string = cubePath.fileCount > 0
        ? chalk.green(`(${cubePath.fileCount} files)`)
        : chalk.yellow('(0 files — may not be pulled)');
      console.log(`  ${chalk.white(label)}  ${arrow}  ${chalk.cyan(cubePath.folderPath)}  ${countStr}`);
    } else {
      console.log(`  ${chalk.white(label)}  ${arrow}  ${chalk.gray('(not in CUBE)')}`);
      notInCube++;
    }
  }

  if (notInCube > 0) {
    console.log(chalk.gray(`\n  ${notInCube}/${results.length} series not found in CUBE — use pull to retrieve.`));
  }
}
