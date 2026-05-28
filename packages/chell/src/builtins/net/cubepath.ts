/**
 * @file Builtin cubepath command.
 *
 * Given a `/net/pacs/queries/...` VFS path (at query, study, or series level),
 * resolves where each matching series lives in CUBE storage and reports the
 * actual file count there. Zero files means the series has not been pulled.
 *
 * @module
 */

import chalk from 'chalk';
import { pacsServers_list } from '@fnndsc/cumin';
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
 * Resolves CUBE FS paths and file counts for all series under a PACS VFS path.
 *
 * @param args - `<vfs-path> [--pacsserver <id>]`
 * @example
 * cubepath /net/pacs/queries/AccessionNumber:25162540_qid:2661
 * cubepath /net/pacs/queries/.../Study_.../Series_...
 */
export async function builtin_cubepath(args: string[]): Promise<void> {
  if (args_checkHasHelpFlag(args, 'cubepath')) {
    help_show('cubepath');
    return;
  }

  let pacsserverOverride: string | null = null;
  const positional: string[] = [];

  for (let i: number = 0; i < args.length; i++) {
    if (args[i] === '--pacsserver' && i + 1 < args.length) {
      pacsserverOverride = args[++i];
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }

  if (positional.length === 0) {
    console.error(chalk.red('cubepath: Missing path. Usage: cubepath <vfs-path>'));
    process.exitCode = 1;
    return;
  }

  const rawPath: string = positional[0];
  const vfsPath: string = rawPath.startsWith('/') ? rawPath : await path_resolve(rawPath);

  if (!vfsPath.startsWith('/net/pacs')) {
    console.error(chalk.red(`cubepath: Not a PACS VFS path: ${rawPath}`));
    process.exitCode = 1;
    return;
  }

  const pacsIdentifier: string | null = await pacsServer_resolve(pacsserverOverride);
  if (!pacsIdentifier) {
    console.error(chalk.red('cubepath: No PACS server available. Set context with: context set PACSserver <id>'));
    process.exitCode = 1;
    return;
  }

  const series: PACSSeriesInfo[] = await pacs_seriesCollect(vfsPath, pacsIdentifier, 'cubepath');
  if (series.length === 0) {
    console.error(chalk.yellow('cubepath: No series found under that path.'));
    process.exitCode = 1;
    return;
  }

  const client = await session.connection.client_get();
  if (!client) {
    console.error(chalk.red('cubepath: Not connected to ChRIS.'));
    process.exitCode = 1;
    return;
  }

  const pacsClient: ChRISPACSClient = client as unknown as ChRISPACSClient;

  // Resolve all series in parallel — no retry needed (cubepath is not called immediately post-pull)
  const results: Array<{ info: PACSSeriesInfo; cubePath: SeriesCubePath | null }> =
    await Promise.all(
      series.map(async (info: PACSSeriesInfo) => {
        const cubePath: SeriesCubePath | null = await series_cubePathGet(info.seriesUID, pacsClient, 1, 0);
        return { info, cubePath };
      }),
    );

  // Compute label column width for alignment
  const maxLabelLen: number = Math.max(...results.map(r => r.info.seriesLabel.length));

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
