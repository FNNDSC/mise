/**
 * @file Builtin pull command.
 *
 * Blocking PACS series retrieve with parallel execution and per-series MultiBar progress.
 * Accepts one or more `/net/pacs/queries/...` VFS paths (query, study, or series level)
 * and materialises the matching DICOM series into ChRIS storage.
 *
 * @module
 */

import chalk from 'chalk';
import cliProgress from 'cli-progress';
import {
  errorStack,
  chrisContext,
  Context,
  pacsQuery_resultDecode,
  pacsQueries_create,
  pacsRetrieve_create,
  pacsServers_list,
  pacsRetrieve_statusForQuery,
  PACSQueryCreateData,
  PACSRetrieveRecord,
} from '@fnndsc/cumin';
import { args_checkHasHelpFlag, help_show } from '../help.js';
import { pacsQuery_createAndWait, queryExpr_parse } from '../net/query.js';
import { spinner } from '../../lib/spinner.js';
import { path_resolve } from '../utils.js';

const POLL_INTERVAL_MS = 2_000;
const STALL_TIMEOUT_MS = 30_000;
const SERIES_TIMEOUT_MS = 5 * 60 * 1_000;

type SeriesStatus = 'pending' | 'pulling' | 'pulled' | 'stalled' | 'timeout' | 'error';

/**
 * Runtime state for a single series being pulled.
 *
 * @property label - Display label: `queryDesc|studyDesc|seriesDesc`
 * @property seriesUID - DICOM SeriesInstanceUID
 * @property studyUID - DICOM StudyInstanceUID
 * @property expectedFiles - File count from original query decode
 * @property syntheticQueryId - ID of the per-series synthetic PACSQuery
 * @property retrieveId - ID of the PACSRetrieve created for syntheticQueryId
 * @property status - Current lifecycle status
 * @property actualFiles - Most recent file count from ChRIS storage
 * @property lastProgressFiles - `actualFiles` at last progress-update tick (stall detection)
 * @property lastProgressTime - Timestamp of last progress-update tick
 * @property startTime - Timestamp when retrieve was fired
 */
interface SeriesPullTask {
  label: string;
  seriesUID: string;
  studyUID: string;
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
 * @returns Array of SeriesPullTask (without syntheticQueryId/retrieveId — filled later).
 */
async function path_seriesCollect(pathStr: string): Promise<SeriesPullTask[]> {
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

  const queryFolder = parts[3];
  const queryId = Number(queryFolder.split('_')[0]);
  if (Number.isNaN(queryId)) {
    errorStack.stack_push('error', `pull: Cannot parse query ID from: ${queryFolder}`);
    return [];
  }
  const queryLabel = queryFolder.slice(queryFolder.indexOf('_') + 1);

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
 * Polls the retrieve status for a task and updates actualFiles.
 *
 * @param task - Task to poll (mutated in place).
 */
async function task_poll(task: SeriesPullTask): Promise<void> {
  if (task.syntheticQueryId === null) return;

  const statusResult = await pacsRetrieve_statusForQuery(task.syntheticQueryId);
  if (!statusResult.ok) return; // synthetic query result not yet populated — keep current count

  for (const study of statusResult.value.studies) {
    for (const series of study.series) {
      if (series.seriesInstanceUID === task.seriesUID) {
        task.actualFiles = series.actualFiles;
        if (task.expectedFiles === 0 && series.expectedFiles > 0) {
          task.expectedFiles = series.expectedFiles;
        }
      }
    }
  }
}

/**
 * Pulls one or more `/net/pacs/queries/...` VFS paths into ChRIS storage.
 *
 * Blocking by default: shows per-series MultiBar progress, exits non-zero on partial failure.
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

  // Resolve any non-VFS args (query expressions) to VFS paths first
  const resolvedPaths: string[] = [];
  for (const rawPath of paths) {
    // Resolve relative paths against CWD first
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
    const tasks = await path_seriesCollect(p);
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

  const pollLoop = async (): Promise<void> => {
    const pending = allTasks.filter(t =>
      t.status !== 'pulled' && t.status !== 'timeout' && t.status !== 'stalled',
    );

    if (pending.length === 0) return;

    await Promise.all(pending.map(t => task_poll(t)));

    const now = Date.now();

    for (const t of pending) {
      const bar = barMap.get(t);
      if (!bar) continue;

      // Stall detection
      if (t.actualFiles > t.lastProgressFiles) {
        t.lastProgressFiles = t.actualFiles;
        t.lastProgressTime = now;
      } else if (t.actualFiles > 0 && now - t.lastProgressTime > STALL_TIMEOUT_MS) {
        t.status = 'stalled';
        bar.update(t.actualFiles, { label: `${t.label} [STALLED]` });
        continue;
      }

      // Timeout detection
      if (t.startTime > 0 && now - t.startTime > SERIES_TIMEOUT_MS) {
        t.status = 'timeout';
        bar.update(t.actualFiles, { label: `${t.label} [TIMEOUT]` });
        continue;
      }

      // Completion check
      if (t.expectedFiles > 0 && t.actualFiles >= t.expectedFiles) {
        t.status = 'pulled';
        bar.update(t.expectedFiles, { label: `${t.label} [DONE]` });
        continue;
      }

      if (t.actualFiles > 0) t.status = 'pulling';
      bar.update(t.actualFiles, {
        label: t.label,
      });
    }
  };

  const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

  // Polling loop
  while (true) {
    await pollLoop();

    const remaining = allTasks.filter(
      t => t.status !== 'pulled' && t.status !== 'timeout' && t.status !== 'stalled' && t.status !== 'error',
    );

    if (remaining.length === 0) break;
    await sleep(POLL_INTERVAL_MS);
  }

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
