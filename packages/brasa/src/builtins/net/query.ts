/**
 * @file Builtin query command.
 *
 * Creates a PACS query, polls until the result is populated, displays the found
 * studies/series, and prints the VFS path for downstream `pull` or `cd` use.
 *
 * Also exports `pacsQuery_createAndWait` for reuse by `builtin_pull`.
 *
 * @module
 */

import chalk from 'chalk';
import {
  errorStack,
  chrisContext,
  Context,
  pacsQuery_get,
  pacsQuery_resultDecode,
  pacsQueries_create,
  pacsServers_list,
  PACSQueryCreateData,
  PACSQueryDecodedResult,
  PACSQueryRecord,
  type CommandEnvelope,
  type StackMessage,
  envelope_ok,
  envelope_error,
  listCache_get,
  queryIndex_get,
} from '@fnndsc/cumin';
import { queryFolderName_build } from '@fnndsc/salsa';
import {
  PACS_QUERY_MODEL_KIND,
  type PacsPatient,
  type PacsProvenance,
  type PacsQueryModel,
  type PacsStudy,
} from '@fnndsc/menu';
import {
  PATIENT_KEY,
  QUERY_COHORT_MAX,
  QUERY_INLINE_FANOUT_MAX,
  fanout_permit,
  patients_read,
  queryTerms_expand,
  queryTerms_parse,
} from './query.fanout.js';
import { sink_get } from '../../core/sink.js';
import { pacsAnswer_toCsv } from './query.csv.js';
import { series_cubePathGet } from './pacsUtils.js';
import { screen } from '@fnndsc/chili/screen/screen.js';
import { spinner } from '../../lib/spinner.js';
import { args_checkHasHelpFlag, help_render } from '../help.js';

const QUERY_POLL_INTERVAL_MS: number = 2_000;
const QUERY_TIMEOUT_MS: number = 60_000;

/**
 * Result of a successful query-create-and-wait operation.
 *
 * @property queryId - ID of the created PACSQuery.
 * @property vfsPath - Full `/net/pacs/queries/<id>_<desc>` path.
 * @property decoded - Decoded query result payload.
 */
export interface QueryCreateResult {
  queryId: number;
  vfsPath: string;
  decoded: PACSQueryDecodedResult;
}

/**
 * Parses a comma-separated `Key:Value[,Key:Value]` expression into an object.
 * Falls back to JSON parse if the string starts with `{`.
 *
 * @param expr - Query expression string.
 * @returns Parsed key-value record, or null if invalid.
 */
export function queryExpr_parse(expr: string): Record<string, string> | null {
  if (expr.trimStart().startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(expr);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // fall through
    }
    return null;
  }

  const result: Record<string, string> = {};
  for (const part of expr.split(',')) {
    const colonIdx: number = part.indexOf(':');
    if (colonIdx < 1) return null;
    const key: string = part.slice(0, colonIdx).trim();
    const value: string = part.slice(colonIdx + 1).trim();
    if (!key || !value) return null;
    result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Builds the VFS path for a query via the provider's one naming authority,
 * so the path handed back after `query` is the path `ls` will show once the
 * query has results.
 *
 * @param queryId - The numeric query ID.
 * @param queryObj - The parsed query key-value pairs.
 * @param username - Optional username to embed in the folder name.
 * @returns Absolute VFS path string.
 */
export function queryVfsPath_build(queryId: number, queryObj: Record<string, string>, username?: string): string {
  return `/net/pacs/queries/${queryFolderName_build({ queryId, queryObj, username, hasResult: true })}`;
}

/**
 * Creates a PACS query and blocks until the result is populated or timeout.
 *
 * @param queryExpr - Comma-separated `Key:Value` string or JSON object string.
 * @param title - Title for the new PACSQuery record.
 * @param pacsserver - PACS server ID or identifier string.
 * @param onStatus - Optional callback called each poll tick with a status message.
 * @returns QueryCreateResult on success, or null on failure/timeout.
 */
export async function pacsQuery_createAndWait(
  queryExpr: string,
  title: string,
  pacsserver: string,
  onStatus?: (msg: string) => void,
): Promise<QueryCreateResult | null> {
  const queryObj: Record<string, string> | null = queryExpr_parse(queryExpr);
  if (!queryObj) {
    errorStack.stack_push('error', `query: Invalid expression: "${queryExpr}". Use Key:Value or JSON.`);
    return null;
  }

  const payload: PACSQueryCreateData = {
    title,
    query: JSON.stringify(queryObj),
  };

  const createResult = await pacsQueries_create(pacsserver, payload);
  if (!createResult.ok) {
    return null;
  }

  // A new query changes the /net/pacs/queries listing; drop any cached copy
  // so an immediate `ls` shows the query instead of a stale directory.
  listCache_get().cache_invalidate('/net/pacs/queries');

  const queryId: number = createResult.value.id;
  // CUBE does not always name the owner on the create response, and the
  // index is keyed by it — a query filed under nobody is a query the next
  // identical ask cannot find. The session's own identity is the fallback,
  // since it is who just asked.
  const ownerUsername: string | undefined =
    (typeof createResult.value.owner_username === 'string' ? createResult.value.owner_username : undefined)
    ?? (await askingIdentity_get()) ?? undefined;
  const vfsPath: string = queryVfsPath_build(queryId, queryObj, ownerUsername);
  const deadline: number = Date.now() + QUERY_TIMEOUT_MS;

  const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

  let succeededWithoutPayload: number = 0;

  while (Date.now() < deadline) {
    const statusResult = await pacsQuery_get(queryId);
    const status: string = statusResult.ok ? (statusResult.value.status ?? 'pending') : 'pending';
    onStatus?.(`Query ${queryId} — ${status}`);

    const decodeResult = await pacsQuery_resultDecode(queryId);
    if (decodeResult.ok && decodeResult.value.json !== undefined) {
      queryIndex_file(queryId, queryObj, await pacsIdentifier_resolve(pacsserver), ownerUsername, true);
      return { queryId, vfsPath, decoded: decodeResult.value };
    }
    if (!decodeResult.ok) {
      // A missing payload is the expected state while polling; drop the
      // error the probe pushed so the stack doesn't fill with one copy
      // per poll tick.
      errorStack.stack_pop();
    }

    // A succeeded query with no stored payload means the PACS matched
    // nothing; a couple of grace polls cover result-write lag.
    if (status === 'succeeded' && ++succeededWithoutPayload >= 2) {
      // Filed as a no-hit. A replay must know this question was asked and
      // found nothing, so it can decline to serve the emptiness back.
      queryIndex_file(queryId, queryObj, await pacsIdentifier_resolve(pacsserver), ownerUsername, false);
      return { queryId, vfsPath, decoded: { raw: '' } };
    }

    await sleep(QUERY_POLL_INTERVAL_MS);
  }

  errorStack.stack_push('error', `query: Timed out waiting for query ${queryId} result.`);
  return null;
}

/**
 * Files a finished query in the replay index.
 *
 * Every query mise runs indexes itself, so the next identical question is
 * answered without waiting for the background sweep to have walked this far
 * back. The server is recorded because the same criteria asked of a
 * different PACS is a different question.
 *
 * @param queryId - The stored query's id.
 * @param criteria - The criteria as asked.
 * @param server - The PACS identifier it was asked of.
 * @param owner - Who asked, when CUBE said.
 * @param hasResult - Whether it found anything.
 */
function queryIndex_file(
  queryId: number,
  criteria: Record<string, string>,
  server: string,
  owner: string | undefined,
  hasResult: boolean,
): void {
  queryIndex_get().entry_note({
    queryId,
    server,
    criteria,
    owner: owner ?? '',
    answeredAt: new Date().toISOString(),
    hasResult,
  });
}

/**
 * Renders decoded PACS query JSON into a human-readable study/series summary.
 *
 * @param decoded - Decoded query result from `pacsQuery_resultDecode`.
 * @returns Formatted multi-line string, or null if no displayable content.
 */
function queryResult_render(decoded: PACSQueryDecodedResult): string | null {
  const payload: unknown = decoded.json;
  if (!payload || typeof payload !== 'object') return null;

  const tagVal = (v: unknown): string => {
    if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
      return String((v as Record<string, unknown>).value ?? '');
    }
    return String(v ?? '');
  };

  const lines: string[] = [];
  const payloadArr: unknown[] = Array.isArray(payload) ? payload : [payload];

  let totalSeries: number = 0;

  payloadArr.forEach((studyRaw: unknown, sIdx: number) => {
    if (!studyRaw || typeof studyRaw !== 'object') return;
    const study: Record<string, unknown> = studyRaw as Record<string, unknown>;

    const studyDesc: string = tagVal(study.StudyDescription ?? '');
    const patientName: string = tagVal(study.PatientName ?? study.patient_name ?? '');
    const patientId: string = tagVal(study.PatientID ?? study.patient_id ?? '');
    const studyDate: string = tagVal(study.StudyDate ?? '');
    const modalities: string = tagVal(study.ModalitiesInStudy ?? '');
    const accession: string = tagVal(study.AccessionNumber ?? '');

    lines.push(chalk.bold.cyan(`  Study ${sIdx + 1}: ${studyDesc || '(no description)'}`));
    if (patientName) lines.push(chalk.gray(`    Patient:   ${patientName}${patientId ? ` (ID: ${patientId})` : ''}`));
    if (studyDate)   lines.push(chalk.gray(`    Date:      ${studyDate}`));
    if (modalities)  lines.push(chalk.gray(`    Modality:  ${modalities}`));
    if (accession)   lines.push(chalk.gray(`    Accession: ${accession}`));

    const seriesArr: unknown[] =
      Array.isArray(study.series)   ? study.series :
      Array.isArray(study.Series)   ? study.Series :
      Array.isArray(study.results)  ? study.results :
      [];

    if (seriesArr.length > 0) {
      lines.push('');
      seriesArr.forEach((seriesRaw: unknown, rIdx: number) => {
        if (!seriesRaw || typeof seriesRaw !== 'object') return;
        const series: Record<string, unknown> = seriesRaw as Record<string, unknown>;
        const desc: string = tagVal(series.SeriesDescription ?? '');
        const mod: string = tagVal(series.Modality ?? '');
        const count: string = tagVal(series.NumberOfSeriesRelatedInstances ?? '');
        const countStr: string = count ? chalk.gray(` (${count} files)`) : '';
        const modStr: string = mod ? chalk.yellow(` [${mod}]`) : '';
        lines.push(`    ${chalk.white(`Series ${rIdx + 1}:`)} ${desc || '(no description)'}${modStr}${countStr}`);
        totalSeries++;
      });
    }
    lines.push('');
  });

  if (lines.length === 0) return null;

  lines.unshift(chalk.gray(`  ${payloadArr.length} study/studies, ${totalSeries} series`));
  lines.unshift('');

  return lines.join('\n');
}

/**
 * Renders decoded PACS query JSON as a per-study table with one row per series.
 *
 * Columns: Study, #, Description, Modality, Files.
 *
 * @param decoded - Decoded query result from `pacsQuery_resultDecode`.
 * @param title - Optional title shown above the table.
 * @returns Formatted table string, or null if no displayable content.
 */
function queryResult_renderTable(decoded: PACSQueryDecodedResult, title?: string): string | null {
  const payload: unknown = decoded.json;
  if (!payload || typeof payload !== 'object') return null;

  const tagVal = (v: unknown): string => {
    if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
      return String((v as Record<string, unknown>).value ?? '');
    }
    return String(v ?? '');
  };

  type TableRow = Record<string, string>;
  const rows: TableRow[] = [];
  const payloadArr: unknown[] = Array.isArray(payload) ? payload : [payload];

  payloadArr.forEach((studyRaw: unknown, sIdx: number) => {
    if (!studyRaw || typeof studyRaw !== 'object') return;
    const study: Record<string, unknown> = studyRaw as Record<string, unknown>;
    const studyLabel: string = tagVal(study.StudyDescription ?? `Study ${sIdx + 1}`);
    const accession: string = tagVal(study.AccessionNumber ?? '');
    const studyDisplay: string = accession ? `${studyLabel} [${accession}]` : studyLabel;

    const seriesArr: unknown[] =
      Array.isArray(study.series)   ? study.series :
      Array.isArray(study.Series)   ? study.Series :
      Array.isArray(study.results)  ? study.results :
      [];

    seriesArr.forEach((seriesRaw: unknown, rIdx: number) => {
      if (!seriesRaw || typeof seriesRaw !== 'object') return;
      const series: Record<string, unknown> = seriesRaw as Record<string, unknown>;
      rows.push({
        Study:       studyDisplay,
        '#':         String(rIdx + 1),
        Description: tagVal(series.SeriesDescription ?? ''),
        Modality:    tagVal(series.Modality ?? ''),
        Files:       tagVal(series.NumberOfSeriesRelatedInstances ?? ''),
      });
    });
  });

  if (rows.length === 0) return null;

  return screen.table_output(rows, { title: { title: title ?? 'Query Results' } });
}

/**
 * Projects a decoded query result onto the wire's `pacs.query` model:
 * studies containing series, each series carrying its instance UID so a
 * surface can lower a selection straight to a pull.
 *
 * @param decoded - The decoded query payload.
 * @param facts - The query's identity facts.
 * @returns The typed model payload.
 */
export function pacsQueryModel_build(
  decoded: PACSQueryDecodedResult,
  facts: {
    queryId: number;
    vfsPath: string;
    pacsName: string;
    expression: string;
    /**
     * Where this answer came from. Said once here so chell's sentence and
     * argus's pill are the same fact rather than two guesses at it.
     */
    provenance?: PacsProvenance;
  },
): PacsQueryModel {
  const tagVal = (v: unknown): string => {
    if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
      return String((v as Record<string, unknown>).value ?? '');
    }
    return String(v ?? '');
  };
  const payload: unknown = decoded.json;
  const payloadArr: unknown[] = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const studies: PacsStudy[] = [];
  for (const studyRaw of payloadArr) {
    if (!studyRaw || typeof studyRaw !== 'object') continue;
    const study: Record<string, unknown> = studyRaw as Record<string, unknown>;
    const seriesArr: unknown[] =
      Array.isArray(study.series) ? study.series :
      Array.isArray(study.Series) ? study.Series :
      Array.isArray(study.results) ? study.results :
      [];
    const studyUID: string = tagVal(study.StudyInstanceUID ?? '');
    const studyDesc: string = tagVal(study.StudyDescription ?? '');
    // The provider's folder grammar, mirrored: a path built here is a path
    // the VFS resolves, which is what makes a series row pullable.
    const studyFolder: string = `Study_${studyUID}_${studyDesc.replace(/[\s/]/g, '_')}`;
    const series: PacsStudy['series'] = [];
    for (const seriesRaw of seriesArr) {
      if (!seriesRaw || typeof seriesRaw !== 'object') continue;
      const one: Record<string, unknown> = seriesRaw as Record<string, unknown>;
      const files: number = parseInt(tagVal(one.NumberOfSeriesRelatedInstances ?? ''), 10);
      const seriesUID: string = tagVal(one.SeriesInstanceUID ?? '');
      const seriesDesc: string = tagVal(one.SeriesDescription ?? '');
      const seriesFolder: string = `Series_${seriesUID}_${seriesDesc.replace(/[\s/]/g, '_')}`;
      series.push({
        seriesUID,
        description: seriesDesc,
        modality: tagVal(one.Modality ?? ''),
        ...(Number.isFinite(files) ? { fileCount: files } : {}),
        ...(studyUID && seriesUID
          ? { vfsPath: `${facts.vfsPath}/${studyFolder}/${seriesFolder}` }
          : {}),
      });
    }
    studies.push({
      ...(studyUID ? { studyUID } : {}),
      ...(studyUID ? { vfsPath: `${facts.vfsPath}/${studyFolder}` } : {}),
      description: studyDesc,
      patientName: tagVal(study.PatientName ?? study.patient_name ?? ''),
      patientId: tagVal(study.PatientID ?? study.patient_id ?? ''),
      date: tagVal(study.StudyDate ?? ''),
      modalities: tagVal(study.ModalitiesInStudy ?? ''),
      accession: tagVal(study.AccessionNumber ?? ''),
      series,
    });
  }
  return { ...facts, studies };
}

/** How many already-in-CUBE checks run at once. */
const PULLED_CHECK_CONCURRENCY: number = 4;

/**
 * Fills each series' `pulled` state by asking CUBE what it already holds.
 * Single-attempt lookups, a few at a time; an unreachable check leaves the
 * flag unset rather than guessing.
 *
 * @param model - The query model to annotate in place.
 */
async function modelPulledState_fill(model: PacsQueryModel): Promise<void> {
  const allSeries = model.studies.flatMap((study) => study.series);
  for (let start: number = 0; start < allSeries.length; start += PULLED_CHECK_CONCURRENCY) {
    const batch = allSeries.slice(start, start + PULLED_CHECK_CONCURRENCY);
    await Promise.all(batch.map(async (series): Promise<void> => {
      if (!series.seriesUID) return;
      const home = await series_cubePathGet(series.seriesUID, 1, 0);
      if (home !== null) {
        series.pulled = true;
        series.pulledFiles = home.fileCount;
      }
    }));
  }
}


/**
 * Who is asking, as the index keys it.
 *
 * `current_get(ChRISuser)` reads a per-session context snapshot, and a
 * surface attached to a running calypso does not necessarily have one —
 * which silently keyed every lookup under an empty owner and made the
 * whole stored back-catalogue unreachable from argus while chell found it
 * perfectly. `ChRISuser_get` reads the authenticated login instead, which
 * is the same thing the sweep files records under.
 *
 * @returns The CUBE username, or an empty string when nobody is logged in.
 */
async function askingIdentity_get(): Promise<string> {
  return (await chrisContext.ChRISuser_get()) ?? '';
}

/**
 * What each way of naming a server resolves to. Server identifiers do not
 * change under a session, and this is on the path of every query.
 */
const pacsIdentifiers: Map<string, string> = new Map();

/**
 * Resolves whatever names a PACS server into its canonical identifier.
 *
 * The context may hold a numeric id, a `--pacsserver` may be either, and
 * CUBE files a query under the identifier. The index is keyed on what CUBE
 * stores, so both the write and the lookup have to speak that.
 *
 * @param pacsserver - An id or an identifier.
 * @returns The identifier, or the input unchanged when it cannot be resolved.
 */
export async function pacsIdentifier_resolve(pacsserver: string): Promise<string> {
  const remembered: string | undefined = pacsIdentifiers.get(pacsserver);
  if (remembered !== undefined) return remembered;
  const servers = await pacsServers_list();
  // Best effort by design: this only decides what a lookup is filed under,
  // so an unreachable or unhelpful CUBE must never fail the query itself.
  if (!servers?.ok) return pacsserver;
  let resolved: string = pacsserver;
  for (const server of servers.value) {
    if (server.identifier === pacsserver) { resolved = pacsserver; break; }
    if (String(server.id) === pacsserver && server.identifier) { resolved = server.identifier; break; }
  }
  pacsIdentifiers.set(pacsserver, resolved);
  return resolved;
}

/**
 * Says how long ago something was answered, in the coarsest true unit.
 *
 * A replay states its age because mise refuses to decide staleness on the
 * operator's behalf: an accession names a study that will not change, an
 * MRN can gain one tomorrow, and no heuristic tells those apart reliably.
 *
 * @param at - An ISO timestamp.
 * @returns A phrase like `3 months ago`, or null when the stamp is unusable.
 */
export function age_describe(at: string): string | null {
  const then: number = Date.parse(at);
  if (Number.isNaN(then)) return null;
  const seconds: number = Math.max(0, Math.round((Date.now() - then) / 1000));
  const units: ReadonlyArray<{ limit: number; size: number; name: string }> = [
    { limit: 60, size: 1, name: 'second' },
    { limit: 3600, size: 60, name: 'minute' },
    { limit: 86400, size: 3600, name: 'hour' },
    { limit: 2592000, size: 86400, name: 'day' },
    { limit: 31536000, size: 2592000, name: 'month' },
    { limit: Infinity, size: 31536000, name: 'year' },
  ];
  for (const unit of units) {
    if (seconds >= unit.limit) continue;
    const count: number = Math.max(1, Math.floor(seconds / unit.size));
    return `${count} ${unit.name}${count === 1 ? '' : 's'} ago`;
  }
  return null;
}

/**
 * Serves a stored answer when this exact question already has one.
 *
 * The rules were settled in #379 and each earns its place:
 *
 * - the criteria, the server AND the asking identity must match, because
 *   another identity's answer is not an answer to this question;
 * - a query that found NOTHING is never replayed. A hit is evidence that
 *   persists — the study existed and still does — while an absence decays,
 *   and "no imaging found" is the answer a clinician acts on;
 * - the index is advisory, so a hit is confirmed by actually decoding the
 *   stored result. Anything that fails — the query deleted, the payload
 *   unreadable — drops the entry and falls through to a fresh query.
 *
 * @param criteria - The criteria as asked.
 * @param identifier - The PACS being asked.
 * @param owner - The identity asking.
 * @returns The stored answer and its age, or null to ask the PACS.
 */
async function replay_attempt(
  criteria: Record<string, string>,
  identifier: string,
  owner: string,
): Promise<{ result: QueryCreateResult; answeredAt: string } | null> {
  const entry = queryIndex_get().entry_find(criteria, identifier, owner);
  if (entry === null || !entry.hasResult) return null;

  const decoded = await pacsQuery_resultDecode(entry.queryId);
  if (!decoded.ok || decoded.value.json === undefined) {
    // The index promised something CUBE no longer has. Forget it and ask.
    errorStack.stack_pop();
    queryIndex_get().entry_drop(criteria, identifier, owner);
    return null;
  }
  return {
    result: {
      queryId: entry.queryId,
      vfsPath: queryVfsPath_build(entry.queryId, entry.criteria, entry.owner || undefined),
      decoded: decoded.value,
    },
    answeredAt: entry.answeredAt,
  };
}

/**
 * Reads a JSON expression as single-valued terms.
 *
 * The JSON form predates multi-value and stays what it was: one question,
 * spelled as an object.
 *
 * @param expr - The expression, starting with `{`.
 * @returns Terms with one value each, or null when the JSON is not an object.
 */
function termsFromJson_read(expr: string): Record<string, string[]> | null {
  const parsed: Record<string, string> | null = queryExpr_parse(expr);
  if (parsed === null) return null;
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]: [string, string]): [string, string[]] => [key, [value]]),
  );
}

/** How many patient queries are in flight at once. */
const QUERY_FANOUT_CONCURRENCY: number = 4;

/**
 * One question in a fan-out: the criteria to ask, and the patient it is
 * about when it is about one.
 *
 * @property criteria - The criteria for this single C-FIND.
 * @property patientId - The MRN this question asks after, when it names one.
 */
interface QueryAsk {
  criteria: Record<string, string>;
  patientId?: string;
  /** The server to ask, as CUBE names it in a create. */
  server: string;
  /**
   * That server's canonical identifier — what CUBE files the query under,
   * and therefore what the replay index is keyed by and what a row says it
   * came from.
   */
  identifier: string;
}

/** What one question came back with. */
interface QueryAnswer {
  ask: QueryAsk;
  result: QueryCreateResult | null;
  /** When the PACS answered, for a replayed row. */
  answeredAt: string | null;
  /** Why the question could not be asked, when it could not. */
  error?: string;
}

/**
 * Renders criteria back into the expression syntax they were parsed from,
 * so a single question inside a fan-out is asked exactly as one typed by
 * hand — the create path takes an expression, not a record.
 *
 * @param criteria - One question's criteria.
 * @returns The `Key:Value,Key:Value` form.
 */
function criteria_toExpression(criteria: Record<string, string>): string {
  return Object.entries(criteria)
    .map(([key, value]: [string, string]): string => `${key}:${value}`)
    .join(',');
}

/**
 * Asks one question, replaying it when the same question has been asked
 * before.
 *
 * @param ask - The question.
 * @param title - Title for the PACSQuery record this may create.
 * @param pacsserver - The server to ask.
 * @param identifier - That server as the replay index keys it.
 * @param owner - The identity asking.
 * @param fresh - True to skip the stored answer and trouble the PACS.
 * @returns What came back, including the reason when nothing did.
 */
async function ask_run(
  ask: QueryAsk,
  title: string,
  owner: string,
  fresh: boolean,
): Promise<QueryAnswer> {
  if (!fresh) {
    const replayed = await replay_attempt(ask.criteria, ask.identifier, owner);
    if (replayed !== null) {
      return { ask, result: replayed.result, answeredAt: replayed.answeredAt };
    }
  }
  const checkpoint: number = errorStack.checkpoint_mark();
  const expression: string = criteria_toExpression(ask.criteria);
  // Each question gets its own title. CUBE refuses a second PACSQuery with
  // a title it already holds for that server — measured live, where a
  // fan-out under one title had every question after the first come back
  // "You have already registered a PACS query with title=..." — so a
  // cohort sharing one title would report a room full of unasked patients.
  const result: QueryCreateResult | null = await pacsQuery_createAndWait(
    expression,
    `${title} · ${expression}`,
    ask.server,
  );
  if (result !== null) return { ask, result, answeredAt: null };
  // A question that could not be asked has told us nothing. Its reason is
  // carried onto the row rather than left on the stack, where a later
  // question's success would bury it.
  const reasons: StackMessage[] = errorStack.checkpoint_drain(checkpoint);
  const reason: string | undefined = reasons[reasons.length - 1]?.message;
  // Stripped where the reason becomes data: this message is read in a
  // table and on a graphical surface, and `[pacsServer_resolve ] |` is a
  // debugging artefact in both. Imported here rather than at the top so
  // this module keeps its narrow graph.
  const { error_stripDebugPrefix } = await import('../utils.js');
  return {
    ask,
    result: null,
    answeredAt: null,
    error: reason === undefined ? 'the query could not be completed' : error_stripDebugPrefix(reason),
  };
}

/**
 * Runs a fan-out, at most four questions in flight.
 *
 * Not operator-settable: nobody inside mise knows the right number for a
 * given hospital, and a flag that can hurt a shared clinical system will
 * eventually be set to fifty.
 *
 * @param asks - Every question to ask, each naming its own server.
 * @param title - Title for the PACSQuery records created.
 * @param owner - The identity asking.
 * @param fresh - True to skip stored answers.
 * @returns The answers, in the order the questions were given.
 */
async function fanout_run(
  asks: QueryAsk[],
  title: string,
  owner: string,
  fresh: boolean,
): Promise<QueryAnswer[]> {
  const answers: QueryAnswer[] = new Array<QueryAnswer>(asks.length);
  let done: number = 0;
  // What is being counted: patients when every question names one, plain
  // questions otherwise — a fan-out over servers or dates is not MRNs.
  const label: string = asks.every((ask: QueryAsk): boolean => ask.patientId !== undefined)
    ? 'MRNS QUERIED'
    : 'QUERIES';
  const progress_say = (phase: 'working' | 'complete'): void => {
    sink_get().progress_write({
      operation: 'task',
      kind: 'inspection',
      phase,
      label,
      current: done,
      total: asks.length,
      percent: asks.length > 0 ? Math.min(100, (done / asks.length) * 100) : undefined,
      status: phase === 'complete' ? 'done' : 'running',
    });
  };

  progress_say('working');
  let next: number = 0;
  const worker = async (): Promise<void> => {
    while (next < asks.length) {
      const index: number = next++;
      answers[index] = await ask_run(asks[index], title, owner, fresh);
      done++;
      progress_say('working');
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(QUERY_FANOUT_CONCURRENCY, asks.length) }, worker),
  );
  progress_say('complete');
  return answers;
}

/**
 * Unions a fan-out's answers into one model.
 *
 * The studies keep their own identities and paths, each already built
 * against the query that found it. The patient level records what was
 * ASKED — including the questions that found nothing and the ones that
 * could not be asked at all, which is the half of a cohort answer that
 * cannot be derived from studies nobody has.
 *
 * @param answers - What every question came back with.
 * @param facts - The command's identity facts.
 * @returns The union model.
 */
function fanoutModel_build(
  answers: QueryAnswer[],
  facts: { pacsName: string; expression: string },
): PacsQueryModel {
  // A row says which PACS answered only when more than one could have. On
  // a single-server query the column would repeat one value down the page
  // and tell an operator nothing.
  const manyServers: boolean = new Set(
    answers.map((answer: QueryAnswer): string => answer.ask.identifier),
  ).size > 1;
  const studies: PacsStudy[] = [];
  const patients: PacsPatient[] = [];
  let anchor: QueryCreateResult | null = null;
  let oldest: string | null = null;
  let allReplayed: boolean = true;

  for (const answer of answers) {
    const found: PacsStudy[] = answer.result === null ? [] : pacsQueryModel_build(answer.result.decoded, {
      queryId: answer.result.queryId,
      vfsPath: answer.result.vfsPath,
      pacsName: answer.ask.server,
      expression: criteria_toExpression(answer.ask.criteria),
    }).studies.map((study: PacsStudy): PacsStudy => (
      manyServers ? { ...study, server: answer.ask.identifier } : study
    ));
    studies.push(...found);
    if (answer.result !== null && (anchor === null || found.length > 0)) {
      if (anchor === null || anchor.decoded.json === undefined) anchor = answer.result;
    }

    const answeredAt: string = answer.answeredAt ?? new Date().toISOString();
    if (answer.answeredAt === null) allReplayed = false;
    if (answer.result !== null && (oldest === null || answeredAt < oldest)) oldest = answeredAt;

    if (answer.ask.patientId === undefined) continue;
    const seriesCount: number = found.reduce(
      (total: number, study: PacsStudy): number => total + study.series.length, 0,
    );
    patients.push({
      patientId: answer.ask.patientId,
      ...(manyServers ? { server: answer.ask.identifier } : {}),
      ...(found[0]?.patientName ? { patientName: found[0].patientName } : {}),
      status: answer.result === null ? 'unasked' : (found.length > 0 ? 'found' : 'none'),
      studyCount: found.length,
      seriesCount,
      ...(answer.result === null ? {} : { queryId: answer.result.queryId }),
      ...(answer.result === null ? {} : {
        provenance: { replayed: answer.answeredAt !== null, answeredAt },
      }),
      ...(answer.error === undefined ? {} : { error: answer.error }),
    });
  }

  return {
    queryId: anchor?.queryId ?? 0,
    vfsPath: anchor?.vfsPath ?? '',
    pacsName: facts.pacsName,
    expression: facts.expression,
    studies,
    // The set's provenance is its OLDEST row: the worst row is what decides
    // whether an audit table can be trusted, and a set is only "replayed"
    // when nothing in it troubled the PACS.
    ...(oldest === null ? {} : { provenance: { replayed: allReplayed, answeredAt: oldest } }),
    ...(patients.length > 0 ? { patients } : {}),
  };
}

/**
 * Renders a cohort as the audit table it is: one row per patient asked.
 *
 * A miss reads as a zero and a failure reads as a dash in an error hue,
 * because a server that timed out has told us nothing while a PACS that
 * answered with nothing has told us something, and a clinician acts on the
 * difference.
 *
 * @param patients - Every patient asked.
 * @returns The rendered table.
 */
function cohort_render(patients: ReadonlyArray<PacsPatient>): string {
  const server_of = (patient: PacsPatient): string => patient.server ?? '';
  const manyServers: boolean = new Set(patients.map(server_of)).size > 1;
  const serverWidth: number = 14;
  const lines: string[] = [''];
  const serverCap: string = manyServers ? chalk.bold.white('SERVER'.padEnd(serverWidth)) : '';
  lines.push(`  ${chalk.bold.white('MRN'.padEnd(18))}${serverCap}${chalk.bold.white('STUDIES'.padEnd(10))}${chalk.bold.white('SERIES'.padEnd(9))}${chalk.bold.white('ANSWERED')}`);
  lines.push(`  ${chalk.gray('─'.repeat(manyServers ? 74 : 60))}`);
  for (const patient of patients) {
    const answered: string | null = patient.provenance === undefined
      ? null
      : age_describe(patient.provenance.answeredAt);
    const counts: [string, string] = patient.status === 'unasked'
      ? ['—', '—']
      : [String(patient.studyCount), String(patient.seriesCount)];
    const hue = patient.status === 'unasked'
      ? chalk.red
      : (patient.status === 'none' ? chalk.gray : chalk.white);
    const note: string = patient.status === 'unasked'
      ? chalk.red(patient.error ?? 'unasked')
      : chalk.gray(answered ?? 'just now');
    const server: string = manyServers ? server_of(patient).padEnd(serverWidth) : '';
    lines.push(`  ${hue(patient.patientId.padEnd(18))}${server}${counts[0].padEnd(10)}${counts[1].padEnd(9)}${note}`);
  }
  const tally = (state: PacsPatient['status']): number =>
    patients.filter((patient: PacsPatient): boolean => patient.status === state).length;
  lines.push('');
  lines.push(`  ${chalk.green(`FOUND ${tally('found')}`)} ${chalk.gray('·')} ${chalk.gray(`NONE ${tally('none')}`)} ${chalk.gray('·')} ${chalk.red(`UNASKED ${tally('unasked')}`)}`);
  lines.push('');
  return lines.join('\n');
}



/**
 * Renders an answer as CSV, and writes it into ChRIS storage when asked.
 *
 * Two flags rather than one with an optional value: `--csv PatientID:1234`
 * could not tell a destination from a query expression, and guessing wrong
 * writes a file named after a patient.
 *
 * A local terminal needs no destination — `--csv > audit.csv` writes the
 * operator's own disk, because engine and operator share a filesystem. A
 * detached surface does not: the engine runs on the daemon's host, so a
 * redirect lands on somebody else's machine. `--csv-to` puts the table in
 * CFS instead, where a cohort's MRNs and study descriptions stay inside
 * ChRIS rather than on whatever laptop the operator is sitting at.
 *
 * @param model - The answer.
 * @param destination - A CFS path to write to, or null to render only.
 * @returns The CSV text and where it went, or a failure already explained.
 */
async function csv_deliver(
  model: PacsQueryModel,
  destination: string | null,
): Promise<{ ok: true; rendered: string } | { ok: false; message: string }> {
  const csv: string = pacsAnswer_toCsv(model);
  if (destination === null) return { ok: true, rendered: csv };

  const { path_resolve, error_stripDebugPrefix } = await import('../utils.js');
  const { files_create } = await import('@fnndsc/salsa');
  const target: string = await path_resolve(destination);
  const written: boolean = await files_create(csv, target);
  if (!written) {
    const problem: StackMessage | undefined = errorStack.stack_pop();
    // Stripped where it is read: a refusal an operator acts on should not
    // arrive wearing the stack's debugging prefix.
    const why: string = problem === undefined ? 'refused' : error_stripDebugPrefix(problem.message);
    return { ok: false, message: `query: could not write ${target}: ${why}` };
  }
  return { ok: true, rendered: `${chalk.green(`✓ wrote ${target}`)}\n` };
}

/**
 * Answers a cohort: many questions, one model, one table.
 *
 * @param asks - The questions.
 * @param facts - Title, server, identity and how the answer should read.
 * @returns One envelope carrying every answer.
 */
async function cohort_answer(
  asks: QueryAsk[],
  facts: {
    title: string;
    /** The server named on the model when one answered; the first otherwise. */
    pacsserver: string;
    owner: string;
    fresh: boolean;
    expression: string;
    /** Render the answer as CSV instead of as a table. */
    csv: boolean;
    /** A CFS path to write that CSV to, when one was named. */
    csvTo: string | null;
  },
): Promise<CommandEnvelope> {
  spinner.start(`Querying PACS for ${asks.length} questions...`, true);
  const answers: QueryAnswer[] = await fanout_run(asks, facts.title, facts.owner, facts.fresh);
  spinner.stop();

  const model: PacsQueryModel = fanoutModel_build(answers, {
    pacsName: facts.pacsserver,
    expression: facts.expression,
  });
  await modelPulledState_fill(model);

  const patients: ReadonlyArray<PacsPatient> = model.patients ?? [];
  const unasked: number = patients.filter(
    (patient: PacsPatient): boolean => patient.status === 'unasked',
  ).length;

  if (facts.csv || facts.csvTo !== null) {
    const delivered = await csv_deliver(model, facts.csvTo);
    if (!delivered.ok) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(delivered.message)}\n`);
    }
    return envelope_ok(delivered.rendered, { kind: PACS_QUERY_MODEL_KIND, data: model });
  }
  // A fan-out over something other than patients has no audit table to
  // show; its studies are the answer, and they are already in the model.
  const rendered: string = patients.length > 0
    ? cohort_render(patients)
    : `${chalk.green(`✓ ${asks.length} queries complete — ${model.studies.length} studies`)}\n`;

  // Every question failing is a failure of the command; some failing is an
  // answer with holes in it, which the table states and the operator reads.
  if (unasked > 0 && unasked === patients.length) {
    process.exitCode = 1;
    // The model still crosses. A surface showing which MRNs went unasked,
    // and why, is more use than an empty pane beside a red line.
    return {
      ...envelope_error(rendered, undefined, `${chalk.red(`query: none of the ${unasked} questions could be asked.`)}\n`),
      model: { kind: PACS_QUERY_MODEL_KIND, data: model },
    };
  }
  return envelope_ok(rendered, { kind: PACS_QUERY_MODEL_KIND, data: model });
}

/**
 * Creates a PACS query, waits for results, displays findings, and prints the VFS path.
 *
 * @param args - `<queryExpression> [--title <title>] [--pacsserver <id>] [--table] [--help]`
 * @example
 * query PatientID:1234
 * query 'PatientID:1234,StudyDate:20240101' --title 'Hip DDH Jan 2024'
 * query AccessionNumber:12345678 --table
 */
export async function builtin_query(args: string[]): Promise<CommandEnvelope> {
  if (args_checkHasHelpFlag(args, 'query')) {
    return envelope_ok(help_render('query'));
  }

  let title: string = `Query ${Date.now()}`;
  let pacsserverOverride: string | null = null;
  let tableMode: boolean = false;
  let fresh: boolean = false;
  let patientsArg: string | null = null;
  let csv: boolean = false;
  let csvTo: string | null = null;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--title' && i + 1 < args.length) {
      title = args[++i];
    } else if (args[i] === '--pacsserver' && i + 1 < args.length) {
      pacsserverOverride = args[++i];
    } else if (args[i] === '--table') {
      tableMode = true;
    } else if (args[i] === '--patients' && i + 1 < args.length) {
      patientsArg = args[++i];
    } else if (args[i] === '--csv') {
      csv = true;
    } else if (args[i] === '--csv-to' && i + 1 < args.length) {
      csvTo = args[++i];
    } else if (args[i] === '--fresh') {
      fresh = true;
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }

  if (positional.length === 0 && patientsArg === null) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('query: Missing query expression. Usage: query <Key:Value[,...]> [--patients <list|@file>] [--title <title>]')}\n`);
  }

  const queryExpr: string = positional.join(' ');

  // Validate expression early. A cohort may narrow with terms or with none
  // at all — `--patients @mrns.txt` is a complete question.
  const terms: Record<string, string[]> | null =
    queryExpr === '' ? {} : (queryExpr.trimStart().startsWith('{')
      ? termsFromJson_read(queryExpr)
      : queryTerms_parse(queryExpr));
  if (terms === null) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`query: Invalid expression: "${queryExpr}". Use Key:Value pairs (e.g. PatientID:1234) or JSON.`)}\n`);
  }

  // Resolve the PACS servers. Several is a QUERY across them; one is the
  // ordinary case. There is no sweep-everything: a fan-out is always
  // something the operator named, because thirteen registrations of
  // unknown liveness is thousands of C-FINDs mostly into the void.
  const named: string[] = (pacsserverOverride ?? '')
    .split(',')
    .map((entry: string): string => entry.trim())
    .filter((entry: string): boolean => entry !== '');
  let servers: string[] = named;
  if (servers.length === 0) {
    const inContext: string | null = await chrisContext.current_get(Context.PACSserver);
    if (inContext) {
      servers = [inContext];
    } else {
      const serversResult = await pacsServers_list();
      if (serversResult.ok && serversResult.value.length > 0) {
        servers = [String(serversResult.value[0].id)];
      } else {
        process.exitCode = 1;
        return envelope_error('', undefined, `${chalk.red('query: No PACS server available. Set one with: pacs connect <id>')}\n`);
      }
    }
  }
  const pacsserver: string = servers[0];

  // The index is keyed on what CUBE stores, which is the identifier.
  const identifiers: string[] = await Promise.all(
    servers.map((server: string): Promise<string> => pacsIdentifier_resolve(server)),
  );
  const identifier: string = identifiers[0];
  const owner: string = await askingIdentity_get();

  // What the operator asked for, as the questions it stands for. A PACS
  // will not match a list, so several patients is several C-FINDs.
  const asks: QueryAsk[] = [];
  if (patientsArg !== null) {
    const cohort = await patients_read(patientsArg);
    if (!cohort.ok) {
      const problem: StackMessage | undefined = errorStack.stack_pop();
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(problem?.message ?? 'query: --patients could not be read.')}\n`);
    }
    if (!fanout_permit(cohort.value.length, QUERY_COHORT_MAX)) {
      const problem: StackMessage | undefined = errorStack.stack_pop();
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(problem?.message ?? 'query: too many patients.')}\n`);
    }
    const base: Record<string, string> = Object.fromEntries(
      Object.entries(terms).map(([key, values]: [string, string[]]): [string, string] => [key, values[0]]),
    );
    if (!fanout_permit(cohort.value.length * servers.length, QUERY_COHORT_MAX)) {
      const problem: StackMessage | undefined = errorStack.stack_pop();
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(problem?.message ?? 'query: too many questions.')}\n`);
    }
    for (const mrn of cohort.value) {
      for (let index: number = 0; index < servers.length; index++) {
        asks.push({
          criteria: { ...base, [PATIENT_KEY]: mrn },
          patientId: mrn,
          server: servers[index],
          identifier: identifiers[index],
        });
      }
    }
  } else {
    const expanded: Array<Record<string, string>> = queryTerms_expand(terms);
    if (!fanout_permit(expanded.length * servers.length, QUERY_INLINE_FANOUT_MAX)) {
      const problem: StackMessage | undefined = errorStack.stack_pop();
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(problem?.message ?? 'query: too many queries.')}\n`);
    }
    const asksPerServer: number = expanded.length * servers.length;
    for (const one of expanded) {
      for (let index: number = 0; index < servers.length; index++) {
        asks.push({
          criteria: one,
          // A single question put to a single server is not a cohort: it
          // needs no patient level, and inventing one would put an audit
          // table where a study list belongs.
          ...(one[PATIENT_KEY] === undefined || asksPerServer === 1
            ? {}
            : { patientId: one[PATIENT_KEY] }),
          server: servers[index],
          identifier: identifiers[index],
        });
      }
    }
  }

  if (asks.length > 1) {
    return await cohort_answer(asks, {
      title, pacsserver, owner, fresh, csv, csvTo,
      expression: patientsArg === null ? queryExpr : `${queryExpr} --patients ${patientsArg}`.trim(),
    });
  }

  const criteria: Record<string, string> = asks[0]?.criteria ?? {};
  // One question, spelled as the create path wants it — which is not
  // necessarily what was typed: `--patients 1234` names a patient without
  // an expression to carry it.
  const askExpr: string = criteria_toExpression(criteria);

  let result: QueryCreateResult | null = null;
  let answeredAt: string | null = null;

  if (!fresh) {
    const replayed = await replay_attempt(criteria, identifier, owner);
    if (replayed !== null) {
      result = replayed.result;
      answeredAt = replayed.answeredAt;
    }
  }

  if (result === null) {
    spinner.start(`Querying PACS for ${askExpr}...`, true);
    result = await pacsQuery_createAndWait(
      askExpr,
      title,
      pacsserver,
      (msg: string) => spinner.updateMessage(msg),
    );
    spinner.stop();
  }

  if (!result) {
    let errOut: string = '';
    const errs = errorStack.stack_getAll?.() ?? [];
    if (errs.length) {
      // Carry the stack directly: in -c/-f mode nothing else will.
      errs.forEach((err: unknown) => {
        const msg: string = typeof err === 'string' ? err : ((err as { message?: string }).message ?? String(err));
        errOut += `${chalk.red(msg)}\n`;
      });
    } else {
      errOut += `${chalk.red('query: Failed — check connection and PACS server context.')}\n`;
    }
    process.exitCode = 1;
    return envelope_error('', undefined, errOut);
  }

  const renderedResult: string | null = tableMode
    ? queryResult_renderTable(result.decoded, title !== `Query ${Date.now()}` ? title : undefined)
    : queryResult_render(result.decoded);


  const model: PacsQueryModel = pacsQueryModel_build(result.decoded, {
    queryId: result.queryId,
    vfsPath: result.vfsPath,
    pacsName: pacsserver,
    expression: askExpr,
    provenance: {
      replayed: answeredAt !== null,
      answeredAt: answeredAt ?? new Date().toISOString(),
    },
  });
  // Mark what CUBE already holds: a surface then offers gather instead of
  // pull for series that are already home. One bounded sweep, no retries.
  await modelPulledState_fill(model);

  if (csv || csvTo !== null) {
    const delivered = await csv_deliver(model, csvTo);
    if (!delivered.ok) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(delivered.message)}\n`);
    }
    return envelope_ok(delivered.rendered, { kind: PACS_QUERY_MODEL_KIND, data: model });
  }

  if (!renderedResult) {
    // Nothing matched: browsing or pulling the empty query would be
    // meaningless, so no hints. The empty model still crosses, so a
    // graphical surface can say "no studies" in its own voice.
    return envelope_ok(
      `${chalk.yellow(`⚠ Query ${result.queryId} complete — no studies found.`)}\n`,
      { kind: PACS_QUERY_MODEL_KIND, data: model },
    );
  }

  // Rendered FROM the model's provenance, not from a second copy of the
  // same fact: one timestamp, one claim, however many surfaces say it.
  const replayed: PacsProvenance | undefined =
    model.provenance?.replayed === true ? model.provenance : undefined;
  const age: string | null = replayed === undefined ? null : age_describe(replayed.answeredAt);
  let rendered: string = replayed === undefined
    ? `${chalk.green(`✓ Query ${result.queryId} complete`)}\n`
    : `${chalk.green(`✓ Query ${result.queryId} — answered ${age ?? 'earlier'}`)}\n`;
  rendered += `${renderedResult}\n`;
  rendered += `${chalk.bold(`  VFS path: ${chalk.cyan(result.vfsPath)}`)}\n`;
  rendered += `${chalk.gray(`  cd ${result.vfsPath}`)}\n`;
  rendered += `${chalk.gray(`  pull ${result.vfsPath}`)}\n`;
  if (replayed !== undefined) {
    // Said, never decided: mise states the age and leaves the judgement
    // with the operator, who knows whether this question can gain an
    // answer between then and now.
    rendered += `${chalk.gray(`  query ${askExpr} --fresh   # ask the PACS again`)}\n`;
  }
  return envelope_ok(rendered, { kind: PACS_QUERY_MODEL_KIND, data: model });
}
