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
import {
  errorStack,
  chrisContext,
  chrisConnection,
  Context,
  pacsQuery_resultDecode,
  pacsQueries_create,
  pacsRetrieve_create,
  pacsServers_list,
  PACSQueryCreateData,
  PACSRetrieveRecord,
} from '@fnndsc/cumin';
import { args_checkHasHelpFlag, help_show } from '../help.js';
import { pacsQuery_createAndWait, queryExpr_parse } from '../net/query.js';
import { spinner } from '../../lib/spinner.js';
import { path_resolve } from '../utils.js';

const STALL_TIMEOUT_MS: number = 30_000;
const SERIES_TIMEOUT_MS: number = 5 * 60 * 1_000;
const CHECKER_INTERVAL_MS: number = 2_000;

type SeriesStatus = 'pending' | 'pulling' | 'pulled' | 'stalled' | 'timeout' | 'error';

// Node.js v22+ native WebSocket — declare minimal interface for type safety
interface NativeWebSocket {
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: string }) => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  send(data: string): void;
  close(): void;
}
declare const WebSocket: { new(url: string): NativeWebSocket };

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
  const queryLabel: string = queryFolder.replace(/_qid:\d+(?:_no-hits)?$/, '');

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

  // Fire all retrieves in parallel
  await Promise.all(allTasks.map(t => task_fire(t, pacsserver as string)));

  const fired = allTasks.filter(t => t.status !== 'error');
  const firingErrors = allTasks.length - fired.length;

  if (nowait) {
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
    console.error(chalk.red('pull: All retrieve requests failed.'));
    process.exitCode = 1;
    return;
  }

  // MultiBar progress display
  const multiBar = new cliProgress.MultiBar(
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

  const barMap = new Map<SeriesPullTask, cliProgress.SingleBar>();
  for (const t of allTasks) {
    const bar = multiBar.create(Math.max(t.expectedFiles, 1), 0, { label: t.label });
    barMap.set(t, bar);
  }

  // --- LONK WebSocket progress tracking ---
  const client = await chrisConnection.client_get();
  if (!client) {
    multiBar.stop();
    console.error(chalk.red('pull: Not connected to ChRIS.'));
    process.exitCode = 1;
    return;
  }

  const downloadToken = await client.createDownloadToken();
  const tokenStr = String((downloadToken.data as unknown as Record<string, unknown>).token ?? '');
  const wsUrl = lonkWsUrl_build(downloadToken.url as string, tokenStr);

  await new Promise<void>((resolve) => {
    const ws = new WebSocket(wsUrl);

    const taskByUID = new Map<string, SeriesPullTask>(
      fired.map(t => [t.seriesUID, t]),
    );

    let resolved = false;
    const done = (): void => {
      if (resolved) return;
      resolved = true;
      clearInterval(checker);
      try { ws.close(); } catch { /* ignore */ }
      resolve();
    };

    // Stall + timeout checker runs every CHECKER_INTERVAL_MS
    const checker = setInterval(() => {
      const now = Date.now();
      let allTerminal = true;

      for (const t of fired) {
        if (t.status === 'pulled' || t.status === 'error' || t.status === 'stalled' || t.status === 'timeout') {
          continue;
        }
        allTerminal = false;
        const bar = barMap.get(t);

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
      }

      if (allTerminal) done();
    }, CHECKER_INTERVAL_MS);

    ws.addEventListener('open', () => {
      for (const t of fired) {
        ws.send(JSON.stringify({
          SeriesInstanceUID: t.seriesUID,
          pacs_name: t.pacsName,
          action: 'subscribe',
        }));
      }
    });

    ws.addEventListener('message', (event: { data: string }) => {
      try {
        const outer = JSON.parse(event.data) as Record<string, unknown>;
        const seriesUID = outer.SeriesInstanceUID as string | undefined;
        const message = outer.message as Record<string, unknown> | undefined;

        if (!seriesUID || !message) return;

        const t = taskByUID.get(seriesUID);
        if (!t) return;
        const bar = barMap.get(t);

        if ('ndicom' in message && typeof message.ndicom === 'number') {
          // Progress update
          const n = message.ndicom;
          t.actualFiles = n;
          t.lastProgressFiles = n;
          t.lastProgressTime = Date.now();
          if (t.status === 'pending') t.status = 'pulling';
          const total = t.expectedFiles > 0 ? t.expectedFiles : Math.max(n, 1);
          bar?.setTotal(total);
          bar?.update(n);
        } else if ('done' in message && message.done === true) {
          // Done — series fully received
          t.status = 'pulled';
          const finalTotal = t.expectedFiles > 0 ? t.expectedFiles : t.actualFiles || 1;
          bar?.setTotal(finalTotal);
          bar?.update(finalTotal, { label: `${t.label} [DONE]` });
        } else if ('error' in message && typeof message.error === 'string') {
          t.status = 'error';
          bar?.update(t.actualFiles, { label: `${t.label} [ERROR]` });
        }
        // 'subscribed' acknowledgement — no action needed
      } catch {
        // Malformed message — ignore
      }
    });

    ws.addEventListener('error', () => {
      // WS connection failed — mark pending tasks as error and exit
      for (const t of fired) {
        if (t.status === 'pending' || t.status === 'pulling') {
          t.status = 'error';
          barMap.get(t)?.update(t.actualFiles, { label: `${t.label} [WS ERROR]` });
        }
      }
      done();
    });

    ws.addEventListener('close', () => {
      done();
    });
  });

  multiBar.stop();

  // Summary
  const pulled = allTasks.filter(t => t.status === 'pulled').length;
  const total = allTasks.length;
  const failures = allTasks.filter(t => t.status !== 'pulled');

  if (failures.length === 0) {
    console.log(chalk.green(`\n✓ ${pulled}/${total} series pulled successfully.`));
  } else {
    console.log(chalk.yellow(`\n⚠ ${pulled}/${total} series complete.`));
    for (const f of failures) {
      console.log(chalk.red(`  ✗ ${f.label} [${f.status.toUpperCase()}]`));
    }
    process.exitCode = 1;
  }

  if (firingErrors > 0) {
    console.log(chalk.red(`  ${firingErrors} retrieve(s) failed to start.`));
    process.exitCode = 1;
  }

  console.log(chalk.gray('Detached — use `pacsretrieve report <queryId>` to verify.'));
}
