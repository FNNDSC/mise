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
  chrisContext,
  Context,
  pacsQuery_resultDecode,
  pacsQueries_create,
  pacsRetrieve_create,
  pacsServers_list,
  PACSQueryCreateData,
  PACSRetrieveRecord,
} from '@fnndsc/cumin';
import { session } from '../../session/index.js';
import { args_checkHasHelpFlag, help_show } from '../help.js';
import { pacsQuery_createAndWait, queryExpr_parse } from '../net/query.js';
import { spinner } from '../../lib/spinner.js';
import { path_resolve } from '../utils.js';

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
 * Minimal slice of the ChRIS API client used to resolve the CUBE folder path for a pulled series.
 */
interface ChRISPACSSeriesClient {
  getPACSSeriesList(
    params: { SeriesInstanceUID: string; limit: number },
    timeout?: number,
  ): Promise<{
    getItems(): Array<unknown>;
  }>;
}

/**
 * Safely unwraps a DICOM tag value (may be `{value: ...}` wrapper or plain string/number).
 *
 * @param val - Raw tag value from decoded query JSON.
 * @returns String representation of the value.
 */
function pacs_tagValueExtract(val: unknown): string {
  if (val && typeof val === 'object') {
    const r = val as Record<string, unknown>;
    if ('value' in r) return String(r.value ?? '');
    if ('Value' in r && Array.isArray(r.Value) && r.Value.length > 0) return String(r.Value[0] ?? '');
  }
  return String(val ?? '');
}

/**
 * Extracts the human-readable label portion of a VFS folder name.
 *
 * @param folder - Folder name, e.g. `Study_1.2.3_US-Hips` or `Series_1.2.3_XR`.
 * @param prefix - Prefix to strip first, e.g. `Study` or `Series`.
 * @returns Everything after `<prefix>_<uid>_`.
 */
function folderLabel_get(folder: string, prefix: string): string {
  const withoutPrefix = folder.replace(new RegExp(`^${prefix}_`), '');
  const idx = withoutPrefix.indexOf('_');
  return idx >= 0 ? withoutPrefix.slice(idx + 1) : withoutPrefix;
}

/**
 * Extracts the UID portion of a VFS folder name.
 *
 * @param folder - Folder name, e.g. `Study_1.2.3_US-Hips`.
 * @param prefix - Prefix to strip, e.g. `Study` or `Series`.
 * @returns The UID segment (first `_`-delimited token after the prefix).
 */
function folderUID_get(folder: string, prefix: string): string {
  const withoutPrefix = folder.replace(new RegExp(`^${prefix}_`), '');
  return withoutPrefix.split('_')[0];
}

/**
 * Walks a `/net/pacs/queries/...` VFS path and collects series pull tasks.
 *
 * Supports query-level, study-level, and series-level paths.
 *
 * @param pathStr - Absolute VFS path to a query, study, or series directory.
 * @param fallbackPacsName - PACS identifier to use if RetrieveAETitle absent in study JSON.
 * @returns Array of SeriesPullTask (without syntheticQueryId/retrieveId — filled later).
 */
async function path_seriesCollect(pathStr: string, fallbackPacsName: string): Promise<SeriesPullTask[]> {
  const effective = pathStr.startsWith('/') ? pathStr : '/' + pathStr;
  const parts = effective.split('/').filter(Boolean);

  if (
    parts.length < 4 ||
    parts[0] !== 'net' ||
    parts[1] !== 'pacs' ||
    parts[2] !== 'queries'
  ) {
    errorStack.stack_push('error', `pull: Not a PACS query path: ${pathStr}`);
    return [];
  }

  const queryFolder: string = parts[3];
  const qidMatch: RegExpExecArray | null = /_qid:(\d+)/.exec(queryFolder);
  const queryId: number = qidMatch ? Number(qidMatch[1]) : NaN;
  if (Number.isNaN(queryId)) {
    errorStack.stack_push('error', `pull: Cannot parse query ID from: ${queryFolder}`);
    return [];
  }
  const queryLabel: string = queryFolder.replace(/_qid:\d+.*$/, '');

  const decodedResult = await pacsQuery_resultDecode(queryId);
  if (!decodedResult.ok || !decodedResult.value.json) {
    errorStack.stack_push('error', `pull: Failed to decode results for query ${queryId}`);
    return [];
  }

  const raw = decodedResult.value.json;
  let studiesSource: unknown;
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    studiesSource =
      'studies' in r ? r.studies :
      'Studies' in r ? r.Studies :
      'results' in r ? r.results :
      raw;
  } else {
    studiesSource = raw;
  }
  const studies = (Array.isArray(studiesSource) ? studiesSource : [studiesSource]) as Record<string, unknown>[];

  const targetStudyUID: string | null = parts.length >= 5
    ? folderUID_get(parts[4], 'Study')
    : null;
  const targetSeriesUID: string | null = parts.length >= 6
    ? folderUID_get(parts[5], 'Series')
    : null;

  const tasks: SeriesPullTask[] = [];

  for (const studyObj of studies) {
    if (!studyObj || typeof studyObj !== 'object') continue;

    const studyUID = pacs_tagValueExtract(studyObj.StudyInstanceUID ?? studyObj.uid);
    if (targetStudyUID && studyUID !== targetStudyUID) continue;

    const studyLabel = pacs_tagValueExtract(studyObj.StudyDescription ?? 'Study').replace(/[\s/]/g, '_');

    // pacs_name for LONK = RetrieveAETitle from the DICOM C-FIND response
    const retrieveAETitle = pacs_tagValueExtract(studyObj.RetrieveAETitle ?? '');
    const pacsName = retrieveAETitle || fallbackPacsName;

    const seriesArr = (
      Array.isArray(studyObj.series) ? studyObj.series :
      Array.isArray(studyObj.Series) ? studyObj.Series :
      Array.isArray(studyObj.results) ? studyObj.results :
      []
    ) as Record<string, unknown>[];

    for (const seriesObj of seriesArr) {
      if (!seriesObj || typeof seriesObj !== 'object') continue;

      const seriesUID = pacs_tagValueExtract(seriesObj.SeriesInstanceUID ?? seriesObj.uid);
      if (!seriesUID) continue;
      if (targetSeriesUID && seriesUID !== targetSeriesUID) continue;

      const seriesLabel = pacs_tagValueExtract(seriesObj.SeriesDescription ?? 'Series').replace(/[\s/]/g, '_');
      const expectedFiles = Number(pacs_tagValueExtract(seriesObj.NumberOfSeriesRelatedInstances ?? '0')) || 0;

      tasks.push({
        label: `${queryLabel}|${studyLabel}|${seriesLabel}`,
        seriesUID,
        studyUID,
        pacsName,
        expectedFiles,
        syntheticQueryId: null,
        retrieveId: null,
        status: 'pending',
        actualFiles: 0,
        lastProgressFiles: 0,
        lastProgressTime: Date.now(),
        startTime: 0,
        cubePathDir: null,
      });
    }
  }

  return tasks;
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

  // Resolve PACS server
  let pacsserver: string | null = await chrisContext.current_get(Context.PACSserver);
  if (!pacsserver) {
    const serversResult = await pacsServers_list();
    if (serversResult.ok && serversResult.value.length > 0) {
      pacsserver = String(serversResult.value[0].id);
    } else {
      console.error(chalk.red('pull: No PACS server available. Set context with: context set PACSserver <id>'));
      process.exitCode = 1;
      return;
    }
  }

  // Resolve PACS server identifier for LONK pacs_name fallback
  let pacsIdentifier: string = pacsserver;
  if (/^\d+$/.test(pacsserver)) {
    const allServers = await pacsServers_list();
    if (allServers.ok) {
      const srv = allServers.value.find(s => s.id === Number(pacsserver));
      if (srv?.identifier) pacsIdentifier = srv.identifier;
    }
  }

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
  const client = await session.connection.client_get();
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

  // Resolve CUBE filesystem paths for all successfully pulled series.
  // Retries handle the timing gap between LONK 'done' and the pacsseries DB record appearing.
  const pulledTasks: SeriesPullTask[] = allTasks.filter((t: SeriesPullTask) => t.status === 'pulled');
  if (pulledTasks.length > 0) {
    const pacsClient: ChRISPACSSeriesClient = client as unknown as ChRISPACSSeriesClient;
    const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
    await Promise.all(pulledTasks.map(async (t: SeriesPullTask): Promise<void> => {
      const maxAttempts: number = 4;
      const retryDelayMs: number = 2_000;
      for (let attempt: number = 0; attempt < maxAttempts; attempt++) {
        try {
          if (attempt > 0) await sleep(retryDelayMs);
          const seriesList = await pacsClient.getPACSSeriesList({ SeriesInstanceUID: t.seriesUID, limit: 1 });
          const items: Array<unknown> = seriesList.getItems();
          if (items.length > 0) {
            const series = items[0] as { data?: { folder_path?: string } };
            const folderPath: string | undefined = series?.data?.folder_path;
            if (folderPath) {
              t.cubePathDir = folderPath;
              break;
            }
          }
        } catch {
          // retry
        }
      }
    }));
  }

  // Summary
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

  // Print CUBE paths for each pulled series
  for (const t of pulledTasks) {
    const seriesLabel: string = t.label.split('|').pop() ?? t.label;
    const arrow: string = chalk.cyan('[->]');
    if (t.cubePathDir) {
      console.log(`  ${chalk.white(seriesLabel)} ${arrow} ${chalk.cyan(t.cubePathDir)}`);
    } else {
      console.log(`  ${chalk.white(seriesLabel)} ${arrow} ${chalk.gray('(path unavailable)')}`);
    }
  }

  if (firingErrors > 0) {
    console.log(chalk.red(`  ${firingErrors} retrieve(s) failed to start.`));
    process.exitCode = 1;
  }

  console.log(chalk.gray('Detached — use `pacsretrieve report <queryId>` to verify.'));
}
