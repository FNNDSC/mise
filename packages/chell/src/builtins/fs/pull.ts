/**
 * @file Builtin pull command.
 *
 * Blocking PACS series retrieve with parallel execution and per-series MultiBar progress.
 * Accepts one or more `/net/pacs/queries/...` VFS paths (query, study, or series level)
 * and materialises the matching DICOM series into ChRIS storage.
 *
 * Progress is driven by LONK WebSocket push notifications (api/v1/pacs/ws/).
 *
 * @module
 */

import chalk from 'chalk';
import cliProgress from 'cli-progress';
import WebSocket from 'ws';
import {
  errorStack,
  pacsQueries_create,
  pacsRetrieve_create,
  PACSQueryCreateData,
  PACSRetrieveRecord,
  Client,
} from '@fnndsc/cumin';
import { session } from '../../session/index.js';
import { args_checkHasHelpFlag, help_show } from '../help.js';
import { pacsQuery_createAndWait, queryExpr_parse } from '../net/query.js';
import { spinner } from '../../lib/spinner.js';
import { path_resolve } from '../utils.js';
import {
  PACSSeriesInfo,
  pacs_tagValueExtract,
  folderUID_get,
  pacs_seriesCollect,
  pacsServer_resolve,
} from '../net/pacsUtils.js';
import { builtin_cubepath } from '../net/cubepath.js';

const STALL_TIMEOUT_MS: number = 30_000;
const NO_ACTIVITY_TIMEOUT_MS: number = 15_000;
const SERIES_TIMEOUT_MS: number = 5 * 60 * 1_000;
const CHECKER_INTERVAL_MS: number = 2_000;

type SeriesStatus = 'pending' | 'pulling' | 'pulled' | 'stalled' | 'timeout' | 'error';

/**
 * Runtime state for a single series being pulled.
 *
 * @property label - Display label: `queryDesc|studyDesc|seriesDesc`
 * @property seriesUID - DICOM SeriesInstanceUID
 * @property studyUID - DICOM StudyInstanceUID
 * @property pacsName - PACS identifier (pacs_name for LONK subscriptions)
 * @property expectedFiles - File count from original query decode
 * @property syntheticQueryId - ID of the per-series synthetic PACSQuery
 * @property retrieveId - ID of the PACSRetrieve created for syntheticQueryId
 * @property status - Current lifecycle status
 * @property actualFiles - Most recent file count from LONK progress updates
 * @property lastProgressFiles - `actualFiles` at last progress-update tick (stall detection)
 * @property lastProgressTime - Timestamp of last progress-update tick
 * @property startTime - Timestamp when retrieve was fired
 * @property cubePathDir - CUBE filesystem directory where the series landed (resolved post-pull)
 */
interface SeriesPullTask {
  label: string;
  seriesUID: string;
  studyUID: string;
  pacsName: string;
  expectedFiles: number;
  syntheticQueryId: number | null;
  retrieveId: number | null;
  status: SeriesStatus;
  actualFiles: number;
  lastProgressFiles: number;
  lastProgressTime: number;
  startTime: number;
  cubePathDir: string | null;
}


/**
 * Walks a VFS path and returns SeriesPullTask array, delegating collection to pacsUtils.
 */
async function path_seriesCollect(pathStr: string, fallbackPacsName: string): Promise<SeriesPullTask[]> {
  const infos: PACSSeriesInfo[] = await pacs_seriesCollect(pathStr, fallbackPacsName, 'pull');
  return infos.map((info: PACSSeriesInfo): SeriesPullTask => ({
    label: info.label,
    seriesUID: info.seriesUID,
    studyUID: info.studyUID,
    pacsName: info.pacsName,
    expectedFiles: info.expectedFiles,
    syntheticQueryId: null,
    retrieveId: null,
    status: 'pending',
    actualFiles: 0,
    lastProgressFiles: 0,
    lastProgressTime: Date.now(),
    startTime: 0,
    cubePathDir: null,
  }));
}

/**
 * Creates a synthetic PACSQuery + PACSRetrieve for a single series.
 *
 * @param task - The pull task to fire (mutated in place: syntheticQueryId, retrieveId, startTime).
 * @param pacsserver - Resolved PACS server ID string.
 */
async function task_fire(task: SeriesPullTask, pacsserver: string): Promise<void> {
  const queryData: PACSQueryCreateData = {
    title: `pull_${task.seriesUID}`,
    query: JSON.stringify({
      SeriesInstanceUID: task.seriesUID,
      StudyInstanceUID: task.studyUID,
    }),
    execute: false,
  };

  const queryResult = await pacsQueries_create(pacsserver, queryData);
  if (!queryResult.ok) {
    task.status = 'error';
    return;
  }

  const syntheticQueryId = queryResult.value.id;
  const retrieveResult = await pacsRetrieve_create(syntheticQueryId);
  if (!retrieveResult.ok) {
    task.status = 'error';
    return;
  }

  task.syntheticQueryId = syntheticQueryId;
  task.retrieveId = (retrieveResult.value as PACSRetrieveRecord).id;
  task.startTime = Date.now();
}

/**
 * Constructs a LONK WebSocket URL from a download token response.
 *
 * @param tokenUrl - The download token resource URL (e.g. https://host/api/v1/downloadtokens/42/).
 * @param token - The actual download token string.
 * @returns WebSocket URL for the LONK endpoint.
 */
function lonkWsUrl_build(tokenUrl: string, token: string): string {
  return tokenUrl
    .replace(/^http(s?):\/\//, (_m: string, s: string) => `ws${s}://`)
    .replace(/v1\/downloadtokens\/\d+\//, `v1/pacs/ws/?token=${token}`);
}

/**
 * Pulls one or more `/net/pacs/queries/...` VFS paths into ChRIS storage.
 *
 * Blocking by default: shows per-series MultiBar progress via LONK WebSocket,
 * exits non-zero on partial failure.
 * With `--nowait`: fires retrieves and prints `<seriesUID> <retrieveId>` per line, then returns.
 *
 * @param args - Command arguments (VFS paths, optional flags).
 * @example
 * pull /net/pacs/queries/42_AccessionNumber:22548684
 * pull --nowait /net/pacs/queries/42_AccessionNumber:22548684/Study_1.2.3_US-Hips
 */
export async function builtin_pull(args: string[]): Promise<void> {
  if (args_checkHasHelpFlag(args, 'pull')) {
    help_show('pull');
    return;
  }

  const nowait = args.includes('--nowait');
  const paths = args.filter(a => !a.startsWith('--'));

  if (paths.length === 0) {
    console.error(chalk.red('pull: No paths specified. Usage: pull [--nowait] <vfs-path> [...]'));
    process.exitCode = 1;
    return;
  }

  const pacsIdentifier: string | null = await pacsServer_resolve();
  if (!pacsIdentifier) {
    console.error(chalk.red('pull: No PACS server available. Set context with: context set PACSserver <id>'));
    process.exitCode = 1;
    return;
  }
  // pacsserver ID needed for pacsQueries_create; pacsIdentifier used for LONK pacs_name
  const pacsserver: string = pacsIdentifier;

  // Resolve any non-VFS args (query expressions) to VFS paths first
  const resolvedPaths: string[] = [];
  for (const rawPath of paths) {
    const p: string = rawPath.startsWith('/') ? rawPath : await path_resolve(rawPath);
    if (p.startsWith('/net/pacs')) {
      resolvedPaths.push(p);
    } else if (queryExpr_parse(rawPath)) {
      spinner.start(`Querying PACS for ${p}...`, true);
      const qResult = await pacsQuery_createAndWait(
        p,
        `pull_${p}`,
        pacsserver as string,
        (msg: string) => spinner.updateMessage(msg),
      );
      spinner.stop();
      if (qResult) {
        console.log(chalk.gray(`  → ${qResult.vfsPath}`));
        resolvedPaths.push(qResult.vfsPath);
      } else {
        console.error(chalk.red(`pull: Query failed for: ${p}`));
      }
    } else {
      console.error(chalk.red(`pull: Not a PACS VFS path or valid query expression: ${rawPath}`));
    }
  }

  // Collect all series across all resolved paths
  const allTasks: SeriesPullTask[] = [];
  for (const p of resolvedPaths) {
    const tasks = await path_seriesCollect(p, pacsIdentifier);
    if (tasks.length === 0) {
      console.error(chalk.yellow(`pull: No series found under: ${p}`));
    }
    allTasks.push(...tasks);
  }

  if (allTasks.length === 0) {
    console.error(chalk.red('pull: No series to retrieve.'));
    process.exitCode = 1;
    return;
  }

  // --- LONK WebSocket: open and subscribe BEFORE firing retrieves ---
  // This eliminates the race condition where a fast/small series completes
  // before chell has a chance to subscribe, causing LONK to never notify us.
  const client: Client | null = await session.connection.client_get();
  if (!client) {
    console.error(chalk.red('pull: Not connected to ChRIS.'));
    process.exitCode = 1;
    return;
  }

  const downloadToken = await client.createDownloadToken();
  const tokenStr: string = String((downloadToken.data as unknown as Record<string, unknown>).token ?? '');
  const wsUrl: string = lonkWsUrl_build(downloadToken.url as string, tokenStr);

  const ws: WebSocket = new WebSocket(wsUrl);

  // Await WS open before proceeding
  await new Promise<void>((openResolve, openReject) => {
    ws.once('open', openResolve);
    ws.once('error', (err: Error) => openReject(err));
  });

  // Subscribe all series now, before retrieves are fired
  for (const t of allTasks) {
    ws.send(JSON.stringify({
      SeriesInstanceUID: t.seriesUID,
      pacs_name: t.pacsName,
      action: 'subscribe',
    }));
  }

  // Fire all retrieves in parallel
  await Promise.all(allTasks.map((t: SeriesPullTask) => task_fire(t, pacsserver as string)));

  const fired: SeriesPullTask[] = allTasks.filter((t: SeriesPullTask) => t.status !== 'error');
  const firingErrors: number = allTasks.length - fired.length;

  if (nowait) {
    ws.close();
    for (const t of allTasks) {
      if (t.retrieveId !== null) {
        console.log(`${t.seriesUID} ${t.retrieveId}`);
      } else {
        console.log(`${t.seriesUID} ERROR`);
      }
    }
    if (firingErrors > 0) process.exitCode = 1;
    return;
  }

  if (fired.length === 0) {
    ws.close();
    console.error(chalk.red('pull: All retrieve requests failed.'));
    process.exitCode = 1;
    return;
  }

  // MultiBar progress display
  const multiBar: cliProgress.MultiBar = new cliProgress.MultiBar(
    {
      format: ' {label}> [{bar}] {value}/{total}',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: false,
      noTTYOutput: true,
    },
    cliProgress.Presets.shades_classic,
  );

  const barMap: Map<SeriesPullTask, cliProgress.SingleBar> = new Map();
  for (const t of allTasks) {
    const bar: cliProgress.SingleBar = multiBar.create(Math.max(t.expectedFiles, 1), 0, { label: t.label });
    barMap.set(t, bar);
  }

  const taskByUID: Map<string, SeriesPullTask> = new Map(
    allTasks.map((t: SeriesPullTask): [string, SeriesPullTask] => [t.seriesUID, t]),
  );

  await new Promise<void>((resolve) => {
    let resolved: boolean = false;
    const done = (): void => {
      if (resolved) return;
      resolved = true;
      clearInterval(checker);
      try { ws.close(); } catch { /* ignore */ }
      resolve();
    };

    const checker = setInterval(() => {
      const now: number = Date.now();
      let allTerminal: boolean = true;

      for (const t of fired) {
        if (t.status === 'pulled' || t.status === 'error' || t.status === 'stalled' || t.status === 'timeout') {
          continue;
        }
        allTerminal = false;
        const bar: cliProgress.SingleBar | undefined = barMap.get(t);

        if (t.startTime > 0 && now - t.startTime > SERIES_TIMEOUT_MS) {
          t.status = 'timeout';
          bar?.update(t.actualFiles, { label: `${t.label} [TIMEOUT]` });
          continue;
        }

        if (t.actualFiles > 0 && now - t.lastProgressTime > STALL_TIMEOUT_MS) {
          t.status = 'stalled';
          bar?.update(t.actualFiles, { label: `${t.label} [STALLED]` });
          continue;
        }

        // No LONK activity at all — series may have completed before subscription
        // or pacs_name is mismatched; treat as done after a short window.
        if (t.startTime > 0 && t.actualFiles === 0 && now - t.startTime > NO_ACTIVITY_TIMEOUT_MS) {
          t.status = 'pulled';
          bar?.update(Math.max(t.expectedFiles, 1), { label: `${t.label} [DONE]` });
          continue;
        }
      }

      if (allTerminal) done();
    }, CHECKER_INTERVAL_MS);

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const outer: Record<string, unknown> = JSON.parse(data.toString()) as Record<string, unknown>;
        const seriesUID: string | undefined = outer.SeriesInstanceUID as string | undefined;
        const message: Record<string, unknown> | undefined = outer.message as Record<string, unknown> | undefined;

        if (!seriesUID || !message) return;

        const t: SeriesPullTask | undefined = taskByUID.get(seriesUID);
        if (!t) return;
        const bar: cliProgress.SingleBar | undefined = barMap.get(t);

        if ('ndicom' in message && typeof message.ndicom === 'number') {
          const n: number = message.ndicom;
          t.actualFiles = n;
          t.lastProgressFiles = n;
          t.lastProgressTime = Date.now();
          if (t.status === 'pending') t.status = 'pulling';
          const total: number = t.expectedFiles > 0 ? t.expectedFiles : Math.max(n, 1);
          bar?.setTotal(total);
          bar?.update(n);
        } else if ('done' in message && message.done === true) {
          t.status = 'pulled';
          const finalTotal: number = t.expectedFiles > 0 ? t.expectedFiles : t.actualFiles || 1;
          bar?.setTotal(finalTotal);
          bar?.update(finalTotal, { label: `${t.label} [DONE]` });
        } else if ('error' in message && typeof message.error === 'string') {
          t.status = 'error';
          bar?.update(t.actualFiles, { label: `${t.label} [ERROR]` });
        }
      } catch {
        // Malformed message — ignore
      }
    });

    ws.on('error', () => {
      for (const t of fired) {
        if (t.status === 'pending' || t.status === 'pulling') {
          t.status = 'error';
          barMap.get(t)?.update(t.actualFiles, { label: `${t.label} [WS ERROR]` });
        }
      }
      done();
    });

    ws.on('close', () => {
      done();
    });
  });

  multiBar.stop();

  // Summary
  const pulledTasks: SeriesPullTask[] = allTasks.filter((t: SeriesPullTask) => t.status === 'pulled');
  const pulled: number = pulledTasks.length;
  const totalCount: number = allTasks.length;
  const failures: SeriesPullTask[] = allTasks.filter((t: SeriesPullTask) => t.status !== 'pulled');

  if (failures.length === 0) {
    console.log(chalk.green(`\n✓ ${pulled}/${totalCount} series pulled successfully.`));
  } else {
    console.log(chalk.yellow(`\n⚠ ${pulled}/${totalCount} series complete.`));
    for (const f of failures) {
      console.log(chalk.red(`  ✗ ${f.label} [${f.status.toUpperCase()}]`));
    }
    process.exitCode = 1;
  }

  if (firingErrors > 0) {
    console.log(chalk.red(`  ${firingErrors} retrieve(s) failed to start.`));
    process.exitCode = 1;
  }

  // Report CUBE paths via cubepath; --retry handles pacsseries DB lag post-pull
  await builtin_cubepath([...resolvedPaths, '--retry']);

  console.log(chalk.gray('Detached — use `pacsretrieve report <queryId>` to verify.'));
}
