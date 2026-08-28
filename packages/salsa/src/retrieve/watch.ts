/**
 * @file PACS retrieve engine: fire, watch, confirm.
 *
 * The single implementation of "make DICOM series land in CUBE and know when
 * they have": synthetic query+retrieve firing with bounded concurrency and
 * per-step retry, a LONK WebSocket watch with stall/timeout/no-activity
 * detection, storage-side confirmation across registration lag, and an
 * optional refire loop for unconfirmed series. Both consumers (the `pull`
 * builtin in brasa and the PACS VFS provider's `cp`) previously solved this
 * independently — LONK push versus 5-second polling — with different
 * semantics; this module is the convergence (docs/code-audit-2026-08.adoc,
 * decisions section).
 *
 * The engine is presentation-free: progress is reported through the
 * {@link RetrieveWatchEvents} callbacks and consumers render it however their
 * surface renders (structured sink progress, plain console lines).
 *
 * @module
 */
import WebSocket from 'ws';
import {
  pacsQueries_create,
  pacsRetrieve_create,
  seriesStorage_resolve,
  retry_untilValue,
  downloadToken_create,
  type DownloadToken,
  type PACSQueryCreateData,
  type PACSRetrieveRecord,
  type SeriesStorageState,
  type Result,
  type Client,
} from '@fnndsc/cumin';

/**
 * Lifecycle states of one series retrieve.
 *
 * `unconfirmed` is the state of a series the client stopped watching before it
 * could see the end. It is not a failure: the PACS keeps pushing and CUBE keeps
 * registering after a watch ends, so the retrieve is very likely still running
 * or already done. Reporting such a series as `error` claims knowledge the
 * client does not have, and a caller that treats it as failure will tell an
 * operator that nothing arrived while the files land behind them.
 */
export type RetrieveStatus =
  | 'pending' | 'pulling' | 'pulled' | 'stalled' | 'timeout' | 'error' | 'unfired' | 'unconfirmed';

/** Progress classification reported to event consumers. */
export type RetrieveProgressStatus = 'running' | 'done' | 'unconfirmed' | 'error' | 'stalled' | 'timeout';

/** Concurrent retrieve creations; more overloads CUBE and loses retrieves. */
const FIRE_CONCURRENCY: number = 4;
/** Retry attempts for one retrieve creation, with backoff between them. */
const FIRE_ATTEMPTS: number = 3;
const FIRE_BACKOFF_MS: readonly number[] = [250, 500];
/**
 * Reconnection attempts for a dropped LONK socket.
 *
 * A long retrieve gives a socket more chances to die, which is why a large
 * study failed where a small one did not. The retrieves are unaffected by the
 * loss, so reconnecting resumes reporting rather than repeating work.
 */
const WATCH_RECONNECT_ATTEMPTS: number = 3;

const STALL_TIMEOUT_MS: number = 30_000;
const NO_ACTIVITY_TIMEOUT_MS: number = 15_000;
const SERIES_TIMEOUT_MS: number = 5 * 60 * 1_000;
const CHECKER_INTERVAL_MS: number = 2_000;

/**
 * Runtime state for a single series being retrieved.
 *
 * @property label - Display label for progress and summaries.
 * @property seriesUID - DICOM SeriesInstanceUID.
 * @property studyUID - DICOM StudyInstanceUID.
 * @property pacsName - PACS identifier (`pacs_name` for LONK subscriptions).
 * @property expectedFiles - File count from the originating query decode.
 * @property syntheticQueryId - ID of the per-series synthetic PACSQuery.
 * @property retrieveId - ID of the PACSRetrieve created for it.
 * @property status - Current lifecycle status.
 * @property actualFiles - Most recent file count from LONK progress updates.
 * @property lastProgressFiles - `actualFiles` at the last progress tick (stall detection).
 * @property lastProgressTime - Timestamp of the last progress tick.
 * @property startTime - Timestamp when the retrieve was fired.
 * @property lonkConfirmed - True only after an explicit LONK `done` or a storage confirmation.
 * @property cubePathDir - CUBE folder the series landed in (resolved post-pull).
 */
export interface RetrieveTask {
  label: string;
  seriesUID: string;
  studyUID: string;
  pacsName: string;
  expectedFiles: number;
  syntheticQueryId: number | null;
  retrieveId: number | null;
  status: RetrieveStatus;
  actualFiles: number;
  lastProgressFiles: number;
  lastProgressTime: number;
  startTime: number;
  lonkConfirmed: boolean;
  cubePathDir: string | null;
}

/**
 * Consumer callbacks for engine progress.
 *
 * @property task - One series changed state or progressed.
 * @property retryRound - A refire round for unconfirmed series is starting.
 */
export interface RetrieveWatchEvents {
  task?: (task: RetrieveTask, status: RetrieveProgressStatus, phase: 'watching' | 'retrying') => void;
  retryRound?: (attempt: number, retryMax: number, count: number) => void;
  /**
   * The watch socket dropped and is being reopened. Reported because a silent
   * reconnection during a long pull looks identical to a stall.
   */
  reconnect?: (attempt: number, maxAttempts: number, watching: number) => void;
}


/**
 * Builds a fresh retrieve task from series identity facts.
 *
 * @param info - Label, UIDs, PACS name, and expected file count.
 * @returns A pending task ready for {@link retrieve_fireAndWatch}.
 */
export function retrieveTask_make(info: {
  label: string;
  seriesUID: string;
  studyUID: string;
  pacsName: string;
  expectedFiles: number;
}): RetrieveTask {
  return {
    ...info,
    syntheticQueryId: null,
    retrieveId: null,
    status: 'pending',
    actualFiles: 0,
    lastProgressFiles: 0,
    lastProgressTime: Date.now(),
    startTime: 0,
    lonkConfirmed: false,
    cubePathDir: null,
  };
}

/**
 * Classifies a task's state for progress reporting.
 *
 * @param task - The task to classify.
 * @returns The progress status consumers render.
 */
export function retrieveProgress_classify(task: RetrieveTask): RetrieveProgressStatus {
  if (task.status === 'pulled') return task.lonkConfirmed ? 'done' : 'unconfirmed';
  if (task.status === 'pending' || task.status === 'pulling') return 'running';
  if (task.status === 'unfired') return 'error';
  return task.status;
}

/**
 * Marks tasks whose series are already fully registered in CUBE as pulled,
 * so firing skips them. This is what makes a retrieve idempotent: re-running
 * the same request after a partial failure fetches only the missing series.
 *
 * @param tasks - All tasks; complete ones are mutated to pulled.
 * @returns How many tasks were marked complete and skipped.
 */
export async function retrieveTasks_skipComplete(tasks: RetrieveTask[]): Promise<number> {
  let skipped: number = 0;
  await Promise.all(tasks.map(async (task: RetrieveTask): Promise<void> => {
    const stateResult: Result<SeriesStorageState> = await seriesStorage_resolve(task.seriesUID);
    if (!stateResult.ok) return;
    const state: SeriesStorageState = stateResult.value;
    if (task.expectedFiles > 0 && state.fileCount >= task.expectedFiles && state.folderPath !== null) {
      task.status = 'pulled';
      task.lonkConfirmed = true;
      task.actualFiles = state.fileCount;
      task.cubePathDir = state.folderPath;
      skipped++;
    }
  }));
  return skipped;
}

/**
 * Creates a synthetic PACSQuery + PACSRetrieve for a single series, with
 * bounded retry: creation failures during a server brown-out are permanent
 * data loss for the run (nothing ever retrieves), so each series gets a few
 * attempts before it is declared unfired.
 *
 * @param task - The task to fire (mutated: syntheticQueryId, retrieveId, startTime, status).
 * @param pacsserver - Resolved PACS server ID string.
 */
async function task_fire(task: RetrieveTask, pacsserver: string): Promise<void> {
  const fired: { queryId: number; retrieveId: number } | null = await retry_untilValue(
    FIRE_ATTEMPTS,
    FIRE_BACKOFF_MS,
    async (): Promise<{ queryId: number; retrieveId: number } | null> => {
      const queryData: PACSQueryCreateData = {
        // CUBE rejects duplicate query titles per user; a timestamp keeps
        // re-pull titles unique.
        title: `pull_${task.seriesUID}_${Date.now().toString(36)}`,
        query: JSON.stringify({
          SeriesInstanceUID: task.seriesUID,
          StudyInstanceUID: task.studyUID,
        }),
        execute: false,
      };
      const queryResult = await pacsQueries_create(pacsserver, queryData);
      if (!queryResult.ok) return null;
      const retrieveResult = await pacsRetrieve_create(queryResult.value.id);
      if (!retrieveResult.ok) return null;
      return { queryId: queryResult.value.id, retrieveId: (retrieveResult.value as PACSRetrieveRecord).id };
    },
  );

  if (fired === null) {
    task.status = 'unfired';
    return;
  }
  task.syntheticQueryId = fired.queryId;
  task.retrieveId = fired.retrieveId;
  task.startTime = Date.now();
}

/**
 * Fires retrieves with bounded concurrency, so a large study does not
 * stampede CUBE with parallel creations (the overload that loses retrieves
 * in the first place).
 *
 * @param tasks - Tasks to fire.
 * @param pacsserver - Resolved PACS server identifier.
 */
async function tasks_fireBounded(tasks: RetrieveTask[], pacsserver: string): Promise<void> {
  let next: number = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task: RetrieveTask = tasks[next++];
      await task_fire(task, pacsserver);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FIRE_CONCURRENCY, tasks.length) }, () => worker()));
}

/**
 * Fires retrieves for tasks (bounded, retried) without watching: the
 * fire-and-exit path (`pull --nowait`). Tasks that could not fire are left
 * in the `unfired` state.
 *
 * @param tasks - Tasks to fire.
 * @param pacsserver - Resolved PACS server identifier.
 */
export async function retrieveTasks_fire(tasks: RetrieveTask[], pacsserver: string): Promise<void> {
  await tasks_fireBounded(tasks, pacsserver);
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
 * Opens a LONK WebSocket, fires retrieves for the tasks, and blocks until
 * every task reaches a terminal state. Mutates each task's status,
 * actualFiles, and lonkConfirmed; reports progress through the events.
 *
 * @param tasks - Tasks to subscribe, fire, and watch.
 * @param pacsserver - Resolved PACS server identifier.
 * @param client - Authenticated ChRIS API client (for the LONK token).
 * @param events - Progress callbacks.
 * @param phase - Phase tag passed through to task events.
 * @returns Number of tasks whose retrieve could not be fired.
 */
export async function retrieve_fireAndWatch(
  tasks: RetrieveTask[],
  pacsserver: string,
  client: Client,
  events: RetrieveWatchEvents = {},
  phase: 'watching' | 'retrying' = 'watching',
): Promise<number> {
  const emit = (task: RetrieveTask, status?: RetrieveProgressStatus): void => {
    events.task?.(task, status ?? retrieveProgress_classify(task), phase);
  };

  const downloadToken: DownloadToken = await downloadToken_create(client);
  const lonkUrl: string = lonkWsUrl_build(downloadToken.url, downloadToken.token);

  /**
   * Opens a LONK socket and subscribes it to the series given.
   *
   * A reconnect subscribes only what is still in flight: the retrieves are
   * already running on the server, so re-firing them would duplicate work that
   * was never lost.
   */
  const socket_open = async (subscribe: RetrieveTask[]): Promise<WebSocket> => {
    const socket: WebSocket = new WebSocket(lonkUrl);
    await new Promise<void>((openResolve: () => void, openReject: (err: Error) => void) => {
      socket.once('open', openResolve);
      socket.once('error', (err: Error) => openReject(err));
    });
    for (const t of subscribe) {
      socket.send(JSON.stringify({ SeriesInstanceUID: t.seriesUID, pacs_name: t.pacsName, action: 'subscribe' }));
    }
    return socket;
  };

  let ws: WebSocket = await socket_open(tasks);

  await tasks_fireBounded(tasks, pacsserver);

  const fired: RetrieveTask[] = tasks.filter((t: RetrieveTask) => t.status !== 'unfired');
  const firingErrors: number = tasks.length - fired.length;

  if (fired.length === 0) {
    for (const t of tasks) {
      if (t.status === 'unfired') emit(t, 'error');
    }
    ws.close();
    return firingErrors;
  }

  for (const t of tasks) {
    emit(t, t.status === 'unfired' ? 'error' : 'running');
  }

  const taskByUID: Map<string, RetrieveTask> = new Map(
    tasks.map((t: RetrieveTask): [string, RetrieveTask] => [t.seriesUID, t]),
  );

  await new Promise<void>((resolve: () => void) => {
    let resolved: boolean = false;
    let reconnectsLeft: number = WATCH_RECONNECT_ATTEMPTS;
    const done = (): void => {
      if (resolved) return;
      resolved = true;
      clearInterval(checker);
      try { ws.close(); } catch { /* best-effort socket cleanup */ }
      resolve();
    };

    /** The series this watch is still waiting on. */
    const inFlight = (): RetrieveTask[] =>
      fired.filter((t: RetrieveTask) => t.status === 'pending' || t.status === 'pulling');

    /**
     * Replaces a dead socket, or gives up and records what is unknown.
     *
     * A LONK socket carries no state a client cannot rebuild: the retrieves run
     * on the server regardless, and a fresh subscription resumes reporting on
     * them. Only when reconnection is exhausted does the watch admit it stopped
     * looking — and even then it says so rather than calling the retrieves
     * failed.
     */
    const socket_replace = (): void => {
      if (resolved) return;
      const remaining: RetrieveTask[] = inFlight();
      if (remaining.length === 0) {
        done();
        return;
      }
      if (reconnectsLeft <= 0) {
        for (const t of remaining) {
          t.status = 'unconfirmed';
          emit(t, 'unconfirmed');
        }
        done();
        return;
      }
      reconnectsLeft -= 1;
      events.reconnect?.(WATCH_RECONNECT_ATTEMPTS - reconnectsLeft, WATCH_RECONNECT_ATTEMPTS, remaining.length);
      void socket_open(remaining)
        .then((replacement: WebSocket): void => {
          if (resolved) {
            try { replacement.close(); } catch { /* the watch already ended */ }
            return;
          }
          ws = replacement;
          socket_listen();
        })
        .catch((): void => socket_replace());
    };

    const checker: NodeJS.Timeout = setInterval(() => {
      const now: number = Date.now();
      let allTerminal: boolean = true;

      for (const t of fired) {
        if (t.status === 'pulled' || t.status === 'error' || t.status === 'unfired' || t.status === 'stalled' || t.status === 'timeout' || t.status === 'unconfirmed') {
          continue;
        }
        allTerminal = false;

        if (t.startTime > 0 && now - t.startTime > SERIES_TIMEOUT_MS) {
          t.status = 'timeout';
          emit(t, 'timeout');
          continue;
        }

        if (t.actualFiles > 0 && now - t.lastProgressTime > STALL_TIMEOUT_MS) {
          t.status = 'stalled';
          emit(t, 'stalled');
          continue;
        }

        if (t.startTime > 0 && t.actualFiles === 0 && now - t.startTime > NO_ACTIVITY_TIMEOUT_MS) {
          t.status = 'pulled';
          t.lonkConfirmed = false;
          emit(t, 'unconfirmed');
          continue;
        }
      }

      if (allTerminal) done();
    }, CHECKER_INTERVAL_MS);

    /** Attaches this watch's handlers to whichever socket is current. */
    const socket_listen = (): void => {
    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const outer: Record<string, unknown> = JSON.parse(data.toString()) as Record<string, unknown>;
        const seriesUID: string | undefined = outer.SeriesInstanceUID as string | undefined;
        const message: Record<string, unknown> | undefined = outer.message as Record<string, unknown> | undefined;
        if (!seriesUID || !message) return;

        const t: RetrieveTask | undefined = taskByUID.get(seriesUID);
        if (!t) return;

        if ('ndicom' in message && typeof message.ndicom === 'number') {
          const n: number = message.ndicom;
          t.actualFiles = n;
          t.lastProgressFiles = n;
          t.lastProgressTime = Date.now();
          if (t.status === 'pending') t.status = 'pulling';
          emit(t, 'running');
        } else if ('done' in message && message.done === true) {
          t.status = 'pulled';
          t.lonkConfirmed = true;
          if (t.actualFiles < t.expectedFiles) t.actualFiles = t.expectedFiles;
          emit(t, 'done');
        } else if ('error' in message && typeof message.error === 'string') {
          t.status = 'error';
          emit(t, 'error');
        }
      } catch {
        // Deliberate absorption: a malformed LONK frame carries no correlation
        // to fail; the checker's stall/timeout guards still bound the watch.
      }
    });

    // A dead socket is a lost view, not a lost retrieve: reconnect and keep
    // watching. Only when that fails repeatedly does the watch stop, and even
    // then it records what it no longer knows rather than declaring failure.
    ws.on('error', () => { socket_replace(); });
    ws.on('close', () => { socket_replace(); });
    };

    socket_listen();
  });

  return firingErrors;
}

/**
 * Confirms unconfirmed series against CUBE storage and refires the rest, up
 * to `retryMax` rounds; series still unconfirmed afterwards are marked
 * errored. This closes the gap between a lost LONK confirmation (cosmetic)
 * and a retrieve that genuinely never delivered (real loss).
 *
 * @param allTasks - All tasks from the initial watch.
 * @param retryMax - Maximum refire rounds.
 * @param pacsserver - The PACS server identifier.
 * @param client - The connected ChRIS client.
 * @param events - Progress callbacks.
 * @returns The number of additional firing errors incurred.
 */
export async function retrieve_confirmLoop(
  allTasks: RetrieveTask[],
  retryMax: number,
  pacsserver: string,
  client: Client,
  events: RetrieveWatchEvents = {},
): Promise<number> {
  let extraFiringErrors: number = 0;
  // A series the watch lost sight of is a candidate for exactly the same
  // treatment as one whose confirmation went missing: ask CUBE. Both are
  // "we did not see the end", and CUBE is the only thing that knows.
  let retryCandidates: RetrieveTask[] = allTasks.filter(
    (t: RetrieveTask) => (t.status === 'pulled' && !t.lonkConfirmed) || t.status === 'unconfirmed',
  );

  for (let attempt: number = 1; attempt <= retryMax && retryCandidates.length > 0; attempt++) {
    await Promise.all(retryCandidates.map(async (t: RetrieveTask): Promise<void> => {
      const stateResult: Result<SeriesStorageState> = await seriesStorage_resolve(t.seriesUID);
      if (stateResult.ok && stateResult.value.folderPath !== null) {
        t.lonkConfirmed = true;
        t.cubePathDir = stateResult.value.folderPath;
        // A series found in CUBE arrived, whatever the watch managed to see.
        t.status = 'pulled';
        t.actualFiles = stateResult.value.fileCount;
        events.task?.(t, 'done', 'retrying');
      }
    }));

    retryCandidates = retryCandidates.filter((t: RetrieveTask) => !t.lonkConfirmed);
    if (retryCandidates.length === 0) break;

    events.retryRound?.(attempt, retryMax, retryCandidates.length);

    for (const t of retryCandidates) {
      t.status = 'pending';
      t.actualFiles = 0;
      t.lastProgressFiles = 0;
      t.lastProgressTime = Date.now();
      t.startTime = 0;
      t.lonkConfirmed = false;
      t.syntheticQueryId = null;
      t.retrieveId = null;
      events.task?.(t, 'running', 'retrying');
    }

    extraFiringErrors += await retrieve_fireAndWatch(retryCandidates, pacsserver, client, events, 'retrying');

    retryCandidates = retryCandidates.filter(
      (t: RetrieveTask) => t.status === 'pulled' && !t.lonkConfirmed,
    );
  }

  for (const t of retryCandidates) {
    t.status = 'error';
    events.task?.(t, 'error', 'retrying');
  }
  return extraFiringErrors;
}
