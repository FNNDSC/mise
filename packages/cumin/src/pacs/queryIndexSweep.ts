/**
 * @file Filling the PACS query index from CUBE.
 *
 * CUBE cannot be asked which stored query had given criteria, so the
 * collection is walked and what it holds is remembered. Two ways in:
 *
 * - `queryIndex_note` files one record, called whenever mise runs a query,
 *   so the common case never waits for a sweep at all;
 * - `queryIndex_sweep` walks the back catalogue behind the prompt, newest
 *   first, resuming from the index's floor so it never re-walks what it
 *   already holds.
 *
 * The sweep is deliberately a background step. Every row of every page
 * drags its compressed result along, so this is the expensive path — worth
 * paying once, off the boot gate, never in front of an operator's query.
 *
 * @module
 */
import { errorStack } from "../error/errorStack.js";
import { Result, Ok, Err } from "../utils/result.js";
import {
  queryIndex_get,
  queryCriteria_parse,
  type QueryIndex,
  type QueryIndexEntry,
} from "../cache/queryIndex.js";
import { pacsQueries_list, type PACSQueryListOptions } from "./chrisPACS.js";
import { listCache_get } from "../cache/listCache.js";
import type { FilteredResourceData } from "../resources/chrisResources.js";

/**
 * How many records a sweep asks for at a time.
 *
 * Not a cap on what is indexed — the sweep pages until the collection is
 * exhausted. Every row carries its compressed result whether or not this
 * wants it, so the page is kept modest to bound each request rather than
 * the walk.
 */
export const QUERY_SWEEP_PAGE: number = 100;

/**
 * A safety stop on the number of pages one sweep will walk.
 *
 * The walk is bounded by the collection, not by this; the bound exists so
 * that a CUBE which never reports a short page cannot spin forever behind
 * the prompt. Reaching it is reported, never silent — a truncated index
 * that says nothing is the defect this whole slice exists to remove.
 */
export const QUERY_SWEEP_PAGE_MAX: number = 200;

/**
 * The listing the index feeds.
 *
 * A sweep that learns of queries the cached listing never had must drop
 * that listing, or the operator keeps seeing the old truncated one until
 * its TTL happens to expire — which is the same invisible-tail defect from
 * a different direction.
 */
export const QUERY_LOG_PATH: string = "/net/pacs/queries";

/** What a sweep did, for the boot readout that reports it. */
export interface QuerySweepResult {
  /** Records newly filed. */
  indexed: number;
  /** True when the sweep resumed from a restored index rather than rebuilding. */
  resumed: boolean;
  /** Pages fetched. */
  pages: number;
  /** True when the page bound stopped the walk before the collection did. */
  bounded: boolean;
}

/**
 * Turns one CUBE query record into an index entry.
 *
 * @param row - A row of the `pacs/queries` collection.
 * @returns The entry, or null when the row carries no usable criteria.
 */
export function queryRow_toEntry(row: Record<string, unknown>): QueryIndexEntry | null {
  const criteria: Record<string, string> | null = queryCriteria_parse(row.query);
  if (criteria === null || Object.keys(criteria).length === 0) return null;
  const queryId: number = Number(row.id);
  if (!Number.isFinite(queryId)) return null;
  const answeredAt: string = typeof row.creation_date === "string"
    ? row.creation_date
    : new Date().toISOString();
  const result: unknown = row.result;
  return {
    queryId,
    server: typeof row.pacs_identifier === "string" ? row.pacs_identifier : "",
    criteria,
    owner: typeof row.owner_username === "string" ? row.owner_username : "",
    answeredAt,
    hasResult: typeof result === "string" && result.trim().length > 0,
  };
}

/**
 * Files one query record, so the next identical question finds it.
 *
 * Called on every query mise runs. The index is then correct for anything
 * this session did without the sweep having reached that far.
 *
 * @param row - The query record as CUBE returned it.
 */
export function queryIndex_note(row: Record<string, unknown>): void {
  const entry: QueryIndexEntry | null = queryRow_toEntry(row);
  if (entry === null) return;
  queryIndex_get().entry_note(entry);
}

/**
 * Walks the query collection into the index.
 *
 * Newest first, resuming from the index's floor, until the collection is
 * exhausted. Filters server-side by owner and status where those are given,
 * since a query someone else asked, or one that failed, can never answer
 * this identity's question.
 *
 * @param options - Server-side narrowing, typically owner and status.
 * @returns What the sweep filed, or Err with the reason on the stack.
 */
export async function queryIndex_sweep(
  options: PACSQueryListOptions = {},
): Promise<Result<QuerySweepResult>> {
  const index: QueryIndex = queryIndex_get();
  // A restored index has already walked everything down to its floor, so
  // the only records it can be missing are the ones that arrived since.
  // Asking for those alone turns a rebuild into a top-up — which is the
  // whole reason the index is persisted rather than swept every boot.
  const newest: string | null = index.newest_get();
  const resume: PACSQueryListOptions = newest === null ? {} : { min_creation_date: newest };
  let offset: number = 0;
  let pages: number = 0;
  let indexed: number = 0;
  let oldest: string | null = null;

  while (pages < QUERY_SWEEP_PAGE_MAX) {
    const page: Result<FilteredResourceData | null> = await pacsQueries_list({
      ...resume,
      ...options,
      limit: QUERY_SWEEP_PAGE,
      offset,
    });
    if (!page.ok) {
      errorStack.stack_push("error", "PACS query sweep: could not read the query collection");
      return Err();
    }
    const rows: Record<string, unknown>[] = page.value?.tableData ?? [];
    pages += 1;
    for (const row of rows) {
      const entry: QueryIndexEntry | null = queryRow_toEntry(row);
      if (entry === null) continue;
      index.entry_note(entry);
      indexed += 1;
      if (oldest === null || Date.parse(entry.answeredAt) < Date.parse(oldest)) {
        oldest = entry.answeredAt;
      }
    }
    // A short page is the collection's own end marker.
    if (rows.length < QUERY_SWEEP_PAGE) {
      if (oldest !== null) index.floor_set(oldest);
      if (indexed > 0) listCache_get().cache_invalidate(QUERY_LOG_PATH);
      return Ok({ indexed, pages, bounded: false, resumed: newest !== null });
    }
    offset += rows.length;
  }

  if (oldest !== null) index.floor_set(oldest);
  if (indexed > 0) listCache_get().cache_invalidate(QUERY_LOG_PATH);
  return Ok({ indexed, pages, bounded: true, resumed: newest !== null });
}
