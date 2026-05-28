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
} from '@fnndsc/cumin';
import { screen } from '@fnndsc/chili/screen/screen.js';
import { spinner } from '../../lib/spinner.js';
import { args_checkHasHelpFlag, help_show } from '../help.js';

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
    const colonIdx = part.indexOf(':');
    if (colonIdx < 1) return null;
    const key = part.slice(0, colonIdx).trim();
    const value = part.slice(colonIdx + 1).trim();
    if (!key || !value) return null;
    result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Builds the VFS path for a query, matching the PacsVfsProvider folder-naming logic.
 *
 * @param queryId - The numeric query ID.
 * @param queryObj - The parsed query key-value pairs.
 * @param username - Optional username to embed in the folder name.
 * @returns Absolute VFS path string.
 */
export function queryVfsPath_build(queryId: number, queryObj: Record<string, string>, username?: string): string {
  const parts: string[] = Object.entries(queryObj)
    .filter(([, v]) => v.trim().length > 0)
    .map(([k, v]) => `${k}:${v}`);
  const desc: string = parts.join('_') || 'query';
  const userSuffix: string = username ? `_${username}` : '';
  return `/net/pacs/queries/${desc}_qid:${queryId}${userSuffix}`;
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
  const queryObj = queryExpr_parse(queryExpr);
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

  const queryId = createResult.value.id;
  const ownerUsername: string | undefined =
    typeof createResult.value.owner_username === 'string' ? createResult.value.owner_username : undefined;
  const vfsPath = queryVfsPath_build(queryId, queryObj, ownerUsername);
  const deadline = Date.now() + QUERY_TIMEOUT_MS;

  const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

  while (Date.now() < deadline) {
    // Show live status in spinner message
    const statusResult = await pacsQuery_get(queryId);
    const status = statusResult.ok ? (statusResult.value.status ?? 'pending') : 'pending';
    onStatus?.(`Query ${queryId} — ${status}`);

    const decodeResult = await pacsQuery_resultDecode(queryId);
    if (decodeResult.ok && decodeResult.value.json !== undefined) {
      return { queryId, vfsPath, decoded: decodeResult.value };
    }

    await sleep(QUERY_POLL_INTERVAL_MS);
  }

  errorStack.stack_push('error', `query: Timed out waiting for query ${queryId} result.`);
  return null;
}

/**
 * Renders decoded PACS query JSON into a human-readable study/series summary.
 *
 * @param decoded - Decoded query result from `pacsQuery_resultDecode`.
 * @returns Formatted multi-line string, or null if no displayable content.
 */
function queryResult_render(decoded: PACSQueryDecodedResult): string | null {
  const payload = decoded.json;
  if (!payload || typeof payload !== 'object') return null;

  const tagVal = (v: unknown): string => {
    if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
      return String((v as Record<string, unknown>).value ?? '');
    }
    return String(v ?? '');
  };

  const lines: string[] = [];
  const payloadArr: unknown[] = Array.isArray(payload) ? payload : [payload];

  let totalSeries = 0;

  payloadArr.forEach((studyRaw: unknown, sIdx: number) => {
    if (!studyRaw || typeof studyRaw !== 'object') return;
    const study = studyRaw as Record<string, unknown>;

    const studyDesc = tagVal(study.StudyDescription ?? '');
    const patientName = tagVal(study.PatientName ?? study.patient_name ?? '');
    const patientId = tagVal(study.PatientID ?? study.patient_id ?? '');
    const studyDate = tagVal(study.StudyDate ?? '');
    const modalities = tagVal(study.ModalitiesInStudy ?? '');
    const accession = tagVal(study.AccessionNumber ?? '');

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
        const series = seriesRaw as Record<string, unknown>;
        const desc = tagVal(series.SeriesDescription ?? '');
        const mod = tagVal(series.Modality ?? '');
        const count = tagVal(series.NumberOfSeriesRelatedInstances ?? '');
        const countStr = count ? chalk.gray(` (${count} files)`) : '';
        const modStr = mod ? chalk.yellow(` [${mod}]`) : '';
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
  const payload = decoded.json;
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
    const study = studyRaw as Record<string, unknown>;
    const studyLabel = tagVal(study.StudyDescription ?? `Study ${sIdx + 1}`);
    const accession = tagVal(study.AccessionNumber ?? '');
    const studyDisplay = accession ? `${studyLabel} [${accession}]` : studyLabel;

    const seriesArr: unknown[] =
      Array.isArray(study.series)   ? study.series :
      Array.isArray(study.Series)   ? study.Series :
      Array.isArray(study.results)  ? study.results :
      [];

    seriesArr.forEach((seriesRaw: unknown, rIdx: number) => {
      if (!seriesRaw || typeof seriesRaw !== 'object') return;
      const series = seriesRaw as Record<string, unknown>;
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
 * Creates a PACS query, waits for results, displays findings, and prints the VFS path.
 *
 * @param args - `<queryExpression> [--title <title>] [--pacsserver <id>] [--table] [--help]`
 * @example
 * query PatientID:1234
 * query 'PatientID:1234,StudyDate:20240101' --title 'Hip DDH Jan 2024'
 * query AccessionNumber:25162540 --table
 */
export async function builtin_query(args: string[]): Promise<void> {
  if (args_checkHasHelpFlag(args, 'query')) {
    help_show('query');
    return;
  }

  // Parse flags
  let title: string = `Query ${Date.now()}`;
  let pacsserverOverride: string | null = null;
  let tableMode = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--title' && i + 1 < args.length) {
      title = args[++i];
    } else if (args[i] === '--pacsserver' && i + 1 < args.length) {
      pacsserverOverride = args[++i];
    } else if (args[i] === '--table') {
      tableMode = true;
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }

  if (positional.length === 0) {
    console.error(chalk.red('query: Missing query expression. Usage: query <Key:Value[,...]> [--title <title>]'));
    process.exitCode = 1;
    return;
  }

  const queryExpr = positional.join(' ');

  // Validate expression early
  if (!queryExpr_parse(queryExpr)) {
    console.error(chalk.red(`query: Invalid expression: "${queryExpr}". Use Key:Value pairs (e.g. PatientID:1234) or JSON.`));
    process.exitCode = 1;
    return;
  }

  // Resolve PACS server
  let pacsserver: string | null = pacsserverOverride ?? await chrisContext.current_get(Context.PACSserver);
  if (!pacsserver) {
    const serversResult = await pacsServers_list();
    if (serversResult.ok && serversResult.value.length > 0) {
      pacsserver = String(serversResult.value[0].id);
    } else {
      console.error(chalk.red('query: No PACS server available. Set context with: context set PACSserver <id>'));
      process.exitCode = 1;
      return;
    }
  }

  spinner.start(`Querying PACS for ${queryExpr}...`, true);

  const result = await pacsQuery_createAndWait(
    queryExpr,
    title,
    pacsserver,
    (msg: string) => spinner.updateMessage(msg),
  );

  spinner.stop();

  if (!result) {
    const errs = errorStack.stack_getAll?.() ?? [];
    if (!errs.length) {
      console.error(chalk.red('query: Failed — check connection and PACS server context.'));
    }
    process.exitCode = 1;
    return;
  }

  const rendered = tableMode
    ? queryResult_renderTable(result.decoded, title !== `Query ${Date.now()}` ? title : undefined)
    : queryResult_render(result.decoded);

  if (rendered) {
    console.log(chalk.green(`✓ Query ${result.queryId} complete`));
    console.log(rendered);
  } else {
    console.log(chalk.yellow(`⚠ Query ${result.queryId} complete — no studies found.`));
  }

  console.log(chalk.bold(`  VFS path: ${chalk.cyan(result.vfsPath)}`));
  console.log(chalk.gray(`  cd ${result.vfsPath}`));
  console.log(chalk.gray(`  pull ${result.vfsPath}`));
}
