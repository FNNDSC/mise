/**
 * @file Pure helpers for the `proc` builtin.
 *
 * Status derivation/coloring, field selection, search filtering, CSV rendering,
 * and feed-id parsing — all dependency-free (chalk only) for unit testing.
 *
 * @module
 */
import chalk from 'chalk';
import type { ProcFeed } from '@fnndsc/cumin';

/**
 * Flat record representing one feed entry for resource-group-style listing.
 * All ProcFeed counter fields exposed as first-class columns.
 */
export interface ProcJobEntry {
  id: number;
  title: string;
  status: string;
  finishedJobs: number;
  erroredJobs: number;
  startedJobs: number;
  scheduledJobs: number;
  cancelledJobs: number;
  createdJobs: number;
  creationDate: string;
  instances: number | string;
  [key: string]: unknown;
}

/** All job fields available for `proc jobs` listing. */
export const ALL_JOB_FIELDS: ReadonlyArray<string> = [
  'id', 'title', 'status',
  'finishedJobs', 'erroredJobs', 'startedJobs',
  'scheduledJobs', 'cancelledJobs', 'createdJobs',
  'creationDate', 'instances',
];

/** Default columns shown for `proc jobs` listing. */
export const DEFAULT_JOB_FIELDS: ReadonlyArray<string> = [
  'id', 'title', 'status', 'finishedJobs', 'erroredJobs',
];

/**
 * Derives an aggregate status label for a feed from its job counters.
 *
 * @param feed - The feed whose counters are inspected.
 * @returns A status label (e.g. `running`, `finishedWithError`).
 */
export function feedStatus_derive(feed: ProcFeed): string {
  if (feed.erroredJobs > 0) return 'finishedWithError';
  if (feed.startedJobs + feed.scheduledJobs + feed.createdJobs > 0) return 'running';
  if (feed.cancelledJobs > 0 && feed.finishedJobs === 0) return 'cancelled';
  if (feed.finishedJobs > 0) return 'finishedSuccessfully';
  return 'empty';
}

/**
 * Colorizes a status label for terminal display.
 *
 * @param status - The status label.
 * @returns The colorized status string.
 */
export function statusColor(status: string): string {
  if (status === 'finishedSuccessfully') return chalk.green(status);
  if (status === 'finishedWithError')    return chalk.red(status);
  if (status === 'running')              return chalk.yellow(status);
  if (status === 'cancelled')            return chalk.dim(status);
  return chalk.gray(status);
}

/**
 * Resolves the selected fields for a listing from a `--fields` argument,
 * falling back to the default set.
 *
 * @param fieldsArg - Comma-separated field names (may be empty).
 * @returns The selected field names.
 */
export function jobFields_select(fieldsArg: string): string[] {
  return fieldsArg
    ? fieldsArg.split(',').map((f: string) => f.trim()).filter(Boolean)
    : [...DEFAULT_JOB_FIELDS];
}

/**
 * Filters job entries by a case-insensitive title substring.
 *
 * @param entries - The entries to filter.
 * @param search - The search substring (empty returns all).
 * @returns The matching entries.
 */
export function procEntries_filterBySearch(entries: ProcJobEntry[], search: string): ProcJobEntry[] {
  if (!search) return entries;
  const lower: string = search.toLowerCase();
  return entries.filter((e: ProcJobEntry) => e.title.toLowerCase().includes(lower));
}

/**
 * Renders job entries as CSV with quoted fields.
 *
 * @param rows - The entries to render.
 * @param fields - The columns to include, in order.
 * @returns The CSV string (header row plus data rows).
 */
export function procCsv_render(rows: ProcJobEntry[], fields: string[]): string {
  const header: string = fields.map((f: string) => `"${f}"`).join(',');
  const body: string = rows.map((e: ProcJobEntry) =>
    fields.map((f: string) => `"${String(e[f] ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  return [header, body].join('\n');
}

/**
 * Parses a feed identifier of the form `123` or `feed_123`.
 *
 * @param arg - The feed argument.
 * @returns The numeric feed ID, or null if malformed.
 */
export function feedId_parse(arg: string): number | null {
  const match: RegExpMatchArray | null = arg.match(/^(?:feed_)?(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}
