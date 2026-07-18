/**
 * @file Builtin pull command.
 *
 * Blocking PACS series retrieve with parallel execution and per-series structured progress.
 * Accepts one or more `/net/pacs/queries/...` VFS paths (query, study, or series level)
 * and materialises the matching DICOM series into ChRIS storage.
 *
 * Progress is driven by LONK WebSocket push notifications (api/v1/pacs/ws/).
 * Use `--retry N` to automatically re-fire retrieves for series that received no LONK activity.
 *
 * @module
 */

import chalk from 'chalk';
import WebSocket from 'ws';
import {
  pacsQueries_create,
  pacsRetrieve_create,
  PACSQueryCreateData,
  PACSRetrieveRecord,
  Client,
  type CommandEnvelope,
  envelope_ok,
  envelope_error,
} from '@fnndsc/cumin';
import { feed_create, type FeedCreationResult } from '@fnndsc/salsa';
import { session } from '../../session/index.js';
import { args_checkHasHelpFlag, help_render } from '../help.js';
import { pacsQuery_createAndWait, queryExpr_parse } from '../net/query.js';
import { spinner } from '../../lib/spinner.js';
import { path_resolve } from '../utils.js';
import {
  ChRISPACSClient,
  PACSSeriesInfo,
  pacs_seriesCollect,
  pacsServer_resolve,
  series_cubePathGet,
} from '../net/pacsUtils.js';
import { builtin_cubepath } from '../net/cubepath.js';
import { pullArgs_parse, type PullArgs } from './pull.args.js';
import { sink_get, sink_dataLine, sink_errLine } from '../../core/sink.js';
import type { ProgressStatus } from '../../core/progress.js';
import { newFeed_cacheAdd } from '../feedCreation.js';

const STALL_TIMEOUT_MS: number = 30_000;
const NO_ACTIVITY_TIMEOUT_MS: number = 15_000;
const SERIES_TIMEOUT_MS: number = 5 * 60 * 1_000;
const CHECKER_INTERVAL_MS: number = 2_000;

type SeriesStatus = 'pending' | 'pulling' | 'pulled' | 'stalled' | 'timeout' | 'error';

function progressStatus_fromSeries(status: SeriesStatus, lonkConfirmed: boolean): ProgressStatus {
  if (status === 'pulled') return lonkConfirmed ? 'done' : 'unconfirmed';
  if (status === 'pending' || status === 'pulling') return 'running';
  return status;
}

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
 * @property lonkConfirmed - True only if LONK sent an explicit `done` message for this series
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
  lonkConfirmed: boolean;
  cubePathDir: string | null;
}

interface PullPathResolution {
  paths: string[];
  complete: boolean;
}

function pullProgress_emit(task: SeriesPullTask, status?: ProgressStatus, phase: 'watching' | 'retrying' = 'watching'): void {
  const current: number = task.actualFiles;
  const total: number = task.expectedFiles > 0 ? Math.max(task.expectedFiles, current, 1) : Math.max(current, 1);
  sink_get().progress_write({
    operation: 'pull',
    kind: 'retrieve',
    phase,
    itemId: task.seriesUID,
    label: task.label,
    current,
    total,
    percent: total > 0 ? Math.min(100, (current / total) * 100) : undefined,
    unit: 'files',
    status: status ?? progressStatus_fromSeries(task.status, task.lonkConfirmed),
  });
}

function pullProgress_complete(allTasks: SeriesPullTask[], failed: boolean): void {
  const done: number = allTasks.filter((t: SeriesPullTask) => t.status === 'pulled').length;
  sink_get().progress_write({
    operation: 'pull',
    kind: 'retrieve',
    phase: failed ? 'failed' : 'complete',
    label: failed ? 'Pull incomplete' : 'Pull complete',
    current: done,
    total: allTasks.length,
    percent: allTasks.length > 0 ? (done / allTasks.length) * 100 : 100,
    unit: 'series',
    status: failed ? 'error' : 'done',
  });
}

/**
 * Minimal ChRIS API client slice for creating download tokens.
 */
interface ChRISTokenClient {
  createDownloadToken(): Promise<{ data: unknown; url: unknown }>;
}

/**
 * Walks a VFS path and returns SeriesPullTask array, delegating collection to pacsUtils.
 *
 * @param pathStr - Absolute VFS path to a query, study, or series directory.
 * @param fallbackPacsName - PACS identifier used when RetrieveAETitle is absent.
 * @returns Array of SeriesPullTask ready for firing.
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
    lonkConfirmed: false,
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
    // CUBE rejects duplicate query titles per user, which used to make a
    // re-pull of the same series fail; a timestamp keeps titles unique.
    title: `pull_${task.seriesUID}_${Date.now().toString(36)}`,
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

  const syntheticQueryId: number = queryResult.value.id;
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
 * @param tokenUrl - The download token resource URL.
 * @param token - The actual download token string.
 * @returns WebSocket URL for the LONK endpoint.
 */
function lonkWsUrl_build(tokenUrl: string, token: string): string {
  return tokenUrl
    .replace(/^http(s?):\/\//, (_m: string, s: string) => `ws${s}://`)
    .replace(/v1\/downloadtokens\/\d+\//, `v1/pacs/ws/?token=${token}`);
}

/**
 * Opens a LONK WebSocket, fires retrieves for the given tasks, and blocks until all
 * tasks reach a terminal state. Mutates each task's status, actualFiles, and lonkConfirmed.
 *
 * @param tasks - Tasks to subscribe, fire, and watch.
 * @param pacsserver - Resolved PACS server identifier.
 * @param client - Authenticated ChRIS API client.
 * @returns Number of tasks that failed to fire their retrieve.
 */
async function tasks_pullWatch(
  tasks: SeriesPullTask[],
  pacsserver: string,
  client: Client,
): Promise<number> {
  const tokenClient: ChRISTokenClient = client as unknown as ChRISTokenClient;
  const downloadToken = await tokenClient.createDownloadToken();
  const tokenStr: string = String((downloadToken.data as unknown as Record<string, unknown>).token ?? '');
  const wsUrl: string = lonkWsUrl_build(downloadToken.url as string, tokenStr);

  const ws: WebSocket = new WebSocket(wsUrl);

  await new Promise<void>((openResolve: () => void, openReject: (err: Error) => void) => {
    ws.once('open', openResolve);
    ws.once('error', (err: Error) => openReject(err));
  });

  for (const t of tasks) {
    ws.send(JSON.stringify({
      SeriesInstanceUID: t.seriesUID,
      pacs_name: t.pacsName,
      action: 'subscribe',
    }));
  }

  await Promise.all(tasks.map((t: SeriesPullTask): Promise<void> => task_fire(t, pacsserver)));

  const fired: SeriesPullTask[] = tasks.filter((t: SeriesPullTask) => t.status !== 'error');
  const firingErrors: number = tasks.length - fired.length;

  if (fired.length === 0) {
    for (const t of tasks) {
      if (t.status === 'error') pullProgress_emit(t, 'error');
    }
    ws.close();
    return firingErrors;
  }

  for (const t of tasks) {
    pullProgress_emit(t, t.status === 'error' ? 'error' : 'running');
  }

  const taskByUID: Map<string, SeriesPullTask> = new Map(
    tasks.map((t: SeriesPullTask): [string, SeriesPullTask] => [t.seriesUID, t]),
  );

  await new Promise<void>((resolve: () => void) => {
    let resolved: boolean = false;
    const done = (): void => {
      if (resolved) return;
      resolved = true;
      clearInterval(checker);
      try { ws.close(); } catch { /* ignore */ }
      resolve();
    };

    const checker: NodeJS.Timeout = setInterval(() => {
      const now: number = Date.now();
      let allTerminal: boolean = true;

      for (const t of fired) {
        if (t.status === 'pulled' || t.status === 'error' || t.status === 'stalled' || t.status === 'timeout') {
          continue;
        }
        allTerminal = false;

        if (t.startTime > 0 && now - t.startTime > SERIES_TIMEOUT_MS) {
          t.status = 'timeout';
          pullProgress_emit(t, 'timeout');
          continue;
        }

        if (t.actualFiles > 0 && now - t.lastProgressTime > STALL_TIMEOUT_MS) {
          t.status = 'stalled';
          pullProgress_emit(t, 'stalled');
          continue;
        }

        if (t.startTime > 0 && t.actualFiles === 0 && now - t.startTime > NO_ACTIVITY_TIMEOUT_MS) {
          t.status = 'pulled';
          t.lonkConfirmed = false;
          pullProgress_emit(t, 'unconfirmed');
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

        if ('ndicom' in message && typeof message.ndicom === 'number') {
          const n: number = message.ndicom;
          t.actualFiles = n;
          t.lastProgressFiles = n;
          t.lastProgressTime = Date.now();
          if (t.status === 'pending') t.status = 'pulling';
          pullProgress_emit(t, 'running');
        } else if ('done' in message && message.done === true) {
          t.status = 'pulled';
          t.lonkConfirmed = true;
          if (t.actualFiles < t.expectedFiles) t.actualFiles = t.expectedFiles;
          pullProgress_emit(t, 'done');
        } else if ('error' in message && typeof message.error === 'string') {
          t.status = 'error';
          pullProgress_emit(t, 'error');
        }
      } catch {
        // Malformed message — ignore
      }
    });

    ws.on('error', () => {
      for (const t of fired) {
        if (t.status === 'pending' || t.status === 'pulling') {
          t.status = 'error';
          pullProgress_emit(t, 'error');
        }
      }
      done();
    });

    ws.on('close', () => { done(); });
  });

  return firingErrors;
}

/**
 * Resolves raw path/query arguments to concrete `/net/pacs` VFS paths,
 * running PACS queries for query expressions.
 *
 * @param paths - Raw path or query-expression operands.
 * @param pacsserver - The resolved PACS server identifier.
 * @returns Resolved VFS paths and whether every operand resolved.
 */
async function paths_resolveToVfs(
  paths: string[],
  pacsserver: string,
): Promise<PullPathResolution> {
  const resolvedPaths: string[] = [];
  let complete: boolean = true;
  for (const rawPath of paths) {
    const p: string = rawPath.startsWith('/') ? rawPath : await path_resolve(rawPath);
    if (p.startsWith('/net/pacs')) {
      resolvedPaths.push(p);
    } else if (queryExpr_parse(rawPath)) {
      // Query with the RAW expression: path resolution prefixes the CWD,
      // which would corrupt the first DICOM key (e.g. '/AccessionNumber').
      spinner.start(`Querying PACS for ${rawPath}...`, true);
      const qResult: Awaited<ReturnType<typeof pacsQuery_createAndWait>> = await pacsQuery_createAndWait(
        rawPath,
        `pull_${rawPath}`,
        pacsserver,
        (msg: string) => spinner.updateMessage(msg),
      );
      spinner.stop();
      if (qResult) {
        sink_dataLine(chalk.gray(`  → ${qResult.vfsPath}`));
        resolvedPaths.push(qResult.vfsPath);
      } else {
        sink_errLine(chalk.red(`pull: Query failed for: ${rawPath}`));
        complete = false;
      }
    } else {
      sink_errLine(chalk.red(`pull: Not a PACS VFS path or valid query expression: ${rawPath}`));
      complete = false;
    }
  }
  return { paths: resolvedPaths, complete };
}

/**
 * Re-fires retrieves for series that pulled without LONK confirmation, up to
 * `retryMax` additional attempts, then permanently fails any still unconfirmed.
 *
 * @param allTasks - All pull tasks.
 * @param retryMax - Maximum retry attempts.
 * @param pacsserver - The PACS server identifier.
 * @param client - The connected ChRIS client.
 * @returns The number of additional retrieve-firing errors incurred.
 */
async function pullRetryLoop(
  allTasks: SeriesPullTask[],
  retryMax: number,
  pacsserver: string,
  client: Client,
): Promise<number> {
  let extraFiringErrors: number = 0;
  let retryCandidates: SeriesPullTask[] = allTasks.filter(
    (t: SeriesPullTask) => t.status === 'pulled' && !t.lonkConfirmed,
  );
  const pacsClient: ChRISPACSClient = client as unknown as ChRISPACSClient;

  for (let attempt: number = 1; attempt <= retryMax && retryCandidates.length > 0; attempt++) {
    await Promise.all(retryCandidates.map(async (t: SeriesPullTask): Promise<void> => {
      const result: Awaited<ReturnType<typeof series_cubePathGet>> = await series_cubePathGet(t.seriesUID, pacsClient, 1, 0);
      if (result) {
        t.lonkConfirmed = true;
        t.cubePathDir = result.folderPath;
      }
    }));

    retryCandidates = retryCandidates.filter((t: SeriesPullTask) => !t.lonkConfirmed);
    if (retryCandidates.length === 0) break;

    sink_dataLine(chalk.yellow(
      `\nRetry ${attempt}/${retryMax} for ${retryCandidates.length} unconfirmed series...`,
    ));

    for (const t of retryCandidates) {
      t.status = 'pending';
      t.actualFiles = 0;
      t.lastProgressFiles = 0;
      t.lastProgressTime = Date.now();
      t.startTime = 0;
      t.lonkConfirmed = false;
      t.syntheticQueryId = null;
      t.retrieveId = null;
      pullProgress_emit(t, 'running', 'retrying');
    }

    extraFiringErrors += await tasks_pullWatch(retryCandidates, pacsserver, client);

    retryCandidates = retryCandidates.filter(
      (t: SeriesPullTask) => t.status === 'pulled' && !t.lonkConfirmed,
    );
  }

  for (const t of retryCandidates) {
    t.status = 'error';
    pullProgress_emit(t, 'error');
  }
  return extraFiringErrors;
}

/**
 * Prints the pull summary and sets a non-zero exit code on any failure.
 *
 * @param allTasks - All pull tasks.
 * @param totalFiringErrors - Count of retrieve-firing errors across all attempts.
 */
function pullSummary_print(allTasks: SeriesPullTask[], totalFiringErrors: number): void {
  const pulled: number = allTasks.filter((t: SeriesPullTask) => t.status === 'pulled').length;
  const totalCount: number = allTasks.length;
  const failures: SeriesPullTask[] = allTasks.filter((t: SeriesPullTask) => t.status !== 'pulled');

  if (failures.length === 0) {
    sink_dataLine(chalk.green(`\n✓ ${pulled}/${totalCount} series pulled successfully.`));
  } else {
    sink_dataLine(chalk.yellow(`\n⚠ ${pulled}/${totalCount} series complete.`));
    for (const f of failures) {
      sink_dataLine(chalk.red(`  ✗ ${f.label} [${f.status.toUpperCase()}]`));
    }
    process.exitCode = 1;
  }

  if (totalFiringErrors > 0) {
    sink_dataLine(chalk.red(`  ${totalFiringErrors} retrieve(s) failed to start.`));
    process.exitCode = 1;
  }

  pullProgress_complete(allTasks, failures.length > 0 || totalFiringErrors > 0);
}

/**
 * Resolves the exact CUBE directories materialised by a completed pull.
 *
 * @param allTasks - Successfully pulled series tasks.
 * @param client - Authenticated ChRIS API client.
 * @returns De-duplicated CUBE directories, or null if any series is unresolved.
 */
async function feedInputDirs_resolve(
  allTasks: SeriesPullTask[],
  client: Client,
): Promise<string[] | null> {
  const pacsClient: ChRISPACSClient = client as unknown as ChRISPACSClient;
  const resolved: Array<{ task: SeriesPullTask; folderPath: string | null }> = await Promise.all(
    allTasks.map(async (task: SeriesPullTask) => {
      if (task.cubePathDir !== null) return { task, folderPath: task.cubePathDir };
      const cubePath = await series_cubePathGet(task.seriesUID, pacsClient, 4, 2_000);
      return { task, folderPath: cubePath?.folderPath ?? null };
    }),
  );

  const missing = resolved.find(({ folderPath }) => folderPath === null);
  if (missing) {
    sink_errLine(chalk.red(
      `pull: Could not resolve CUBE storage for series ${missing.task.seriesUID}; new feed not created.`,
    ));
    return null;
  }

  return [...new Set(resolved.map(({ folderPath }) => folderPath as string))];
}

/**
 * Creates a feed whose pl-dircopy root contains exactly the pulled series.
 *
 * @param title - Requested feed title.
 * @param allTasks - Successfully pulled series tasks.
 * @param client - Authenticated ChRIS API client.
 * @returns True when a valid feed and root instance were created.
 */
async function pulledFeed_create(
  title: string,
  allTasks: SeriesPullTask[],
  client: Client,
): Promise<boolean> {
  const dirs: string[] | null = await feedInputDirs_resolve(allTasks, client);
  if (dirs === null) return false;

  const feed: FeedCreationResult | null = await feed_create(dirs, { title });
  const feedID: number = Number(feed?.id);
  const rootInstanceID: number = Number(feed?.pluginInstance?.data?.id);
  const owner: string = typeof feed?.owner_username === 'string'
    ? feed.owner_username.trim()
    : '';
  if (!feed || !Number.isInteger(feedID) || feedID <= 0 ||
      !Number.isInteger(rootInstanceID) || rootInstanceID <= 0 || owner.length === 0) {
    sink_errLine(chalk.red(`pull: Failed to create feed '${title}'.`));
    return false;
  }

  newFeed_cacheAdd({
    feedID,
    title,
    ownerUsername: owner,
    rootInstanceID,
  });

  sink_dataLine(chalk.green(`Feed created: ${feedID}`));
  sink_dataLine(chalk.green(`Root job: pl-dircopy (ID: ${rootInstanceID})`));
  sink_dataLine(`Input: ${allTasks.length} PACS series`);
  sink_dataLine(chalk.cyan(
    `Feed path: /home/${owner}/feeds/feed_${feedID}/pl-dircopy_${rootInstanceID}/data/`,
  ));
  return true;
}


/**
 * Pulls one or more `/net/pacs/queries/...` VFS paths into ChRIS storage.
 *
 * Blocking by default: emits per-series structured progress via LONK WebSocket,
 * exits non-zero on partial failure.
 * With `--nowait`: fires retrieves and prints `<seriesUID> <retrieveId>` per line, then returns.
 * With `--retry N`: re-fires retrieves for [NO LONK] series up to N additional times.
 * With `--new-feed TITLE`: creates one feed from the exact successfully retrieved set.
 *
 * @param args - Command arguments (VFS paths, optional flags).
 * @example
 * pull /net/pacs/queries/42_AccessionNumber:12345678
 * pull --retry 3 /net/pacs/queries/42_AccessionNumber:12345678/Study_1.2.3_US-Hips
 */
export async function builtin_pull(args: string[]): Promise<CommandEnvelope> {
  if (args_checkHasHelpFlag(args, 'pull')) {
    return envelope_ok(help_render('pull'));
  }

  const { nowait, retryMax, newFeedTitle, parseError, paths }: PullArgs = pullArgs_parse(args);

  if (parseError !== null) {
    sink_errLine(chalk.red(`pull: ${parseError}.`));
    process.exitCode = 1;
    return envelope_error('');
  }

  if (nowait && newFeedTitle !== null) {
    sink_errLine(chalk.red('pull: --new-feed cannot be combined with --nowait.'));
    process.exitCode = 1;
    return envelope_error('');
  }

  if (paths.length === 0) {
    sink_errLine(chalk.red(
      'pull: No paths specified. Usage: pull [--nowait] [--retry N] [--new-feed <title>] <vfs-path> [...]',
    ));
    process.exitCode = 1;
    return envelope_error('');
  }

  const pacsIdentifier: string | null = await pacsServer_resolve();
  if (!pacsIdentifier) {
    sink_errLine(chalk.red('pull: No PACS server available. Set one with: pacs connect <id>'));
    process.exitCode = 1;
    return envelope_error('');
  }
  const pacsserver: string = pacsIdentifier;

  const pathResolution: PullPathResolution = await paths_resolveToVfs(paths, pacsserver);
  const resolvedPaths: string[] = pathResolution.paths;
  let selectionComplete: boolean = pathResolution.complete;

  const allTasks: SeriesPullTask[] = [];
  for (const p of resolvedPaths) {
    const tasks: SeriesPullTask[] = await path_seriesCollect(p, pacsIdentifier);
    if (tasks.length === 0) {
      sink_errLine(chalk.yellow(`pull: No series found under: ${p}`));
      selectionComplete = false;
    }
    allTasks.push(...tasks);
  }

  if (allTasks.length === 0) {
    sink_errLine(chalk.red('pull: No series to retrieve.'));
    process.exitCode = 1;
    return envelope_error('');
  }

  const client: Client | null = await session.connection.client_get();
  if (!client) {
    sink_errLine(chalk.red('pull: Not connected to ChRIS.'));
    process.exitCode = 1;
    return envelope_error('');
  }

  // --nowait: fire retrieves and exit without watching
  if (nowait) {
    for (const t of allTasks) {
      await task_fire(t, pacsserver);
      if (t.retrieveId !== null) {
        sink_dataLine(`${t.seriesUID} ${t.retrieveId}`);
      } else {
        sink_dataLine(`${t.seriesUID} ERROR`);
        process.exitCode = 1;
      }
    }
    return envelope_ok('');
  }

  let totalFiringErrors: number = await tasks_pullWatch(allTasks, pacsserver, client);
  totalFiringErrors += await pullRetryLoop(allTasks, retryMax, pacsserver, client);

  pullSummary_print(allTasks, totalFiringErrors);

  // Report CUBE paths via cubepath; --retry handles pacsseries DB lag post-pull
  const cubeEnvelope: CommandEnvelope = await builtin_cubepath([...resolvedPaths, '--retry']);
  if (cubeEnvelope.rendered.length > 0) sink_get().data_write(cubeEnvelope.rendered);
  if (cubeEnvelope.renderedErr !== undefined && cubeEnvelope.renderedErr.length > 0) sink_get().err_write(cubeEnvelope.renderedErr);

  if (newFeedTitle !== null) {
    if (!selectionComplete) {
      sink_errLine(chalk.red(
        'pull: New feed not created because the requested selection was incomplete.',
      ));
      process.exitCode = 1;
      return envelope_error('');
    }
    const incomplete: boolean = totalFiringErrors > 0 || allTasks.some(
      (task: SeriesPullTask) => task.status !== 'pulled',
    );
    if (incomplete) {
      sink_errLine(chalk.red('pull: New feed not created because retrieval was incomplete.'));
      process.exitCode = 1;
      return envelope_error('');
    }
    if (!await pulledFeed_create(newFeedTitle, allTasks, client)) {
      process.exitCode = 1;
      return envelope_error('');
    }
  }

  if (newFeedTitle === null) {
    sink_dataLine(chalk.gray('Detached — use `pacsretrieve report <queryId>` to verify.'));
  }
  return envelope_ok('');
}
