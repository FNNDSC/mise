/**
 * @file The request ledger: every call the kernel makes to CUBE, counted.
 *
 * A navigation that felt slow turned out to be fourteen requests where
 * four would do, and nothing in the session could say so — the count was
 * found with a preload hack on a private daemon. The ledger makes the
 * wire a readout: how many requests since the session (or the last
 * reset), by endpoint family, with the last ones timed. `netstat` reads
 * it; smoke asserts budgets against it; an operator on a slow day asks
 * it before guessing.
 *
 * It listens on Node's own diagnostics channels — the http client (what
 * axios rides) and undici (what fetch rides) — so nothing is patched and
 * every caller is seen.
 */
import { subscribe } from 'node:diagnostics_channel';

/** One request as the ledger saw it. */
export interface LedgerEntry {
  /** Milliseconds since the ledger started. */
  at: number;
  method: string;
  /** The endpoint family: `filebrowser/search`, `filebrowser/:id/children`, `plugins`, … */
  family: string;
  /** The path with its query, as sent (capped). */
  path: string;
  /** The response status; 0 when the request failed before one. */
  status: number;
  /** How long it took, request to response headers. */
  ms: number;
}

/** A family's tally. */
export interface LedgerFamily {
  family: string;
  count: number;
  /** Milliseconds spent, summed. */
  ms: number;
}

/** What `netstat` reads out. */
export interface LedgerSnapshot {
  /** When the count began: the session, or the last reset (ISO 8601). */
  since: string;
  /** Requests since then. */
  total: number;
  /** Milliseconds spent on them, summed. */
  ms: number;
  /** By family, most requests first. */
  families: LedgerFamily[];
  /** The last requests, oldest first. */
  last: LedgerEntry[];
}

/** How many entries the ledger keeps. */
export const LEDGER_KEPT: number = 200;
/** A path longer than this is cut, with an ellipsis. */
const PATH_KEPT: number = 160;

let started: boolean = false;
let origin: number = Date.now();
let since: string = new Date(origin).toISOString();
let total: number = 0;
let msTotal: number = 0;
const families: Map<string, LedgerFamily> = new Map();
const entries: LedgerEntry[] = [];
const open: WeakMap<object, { t0: number; method: string; path: string }> = new WeakMap();

/**
 * Names a request's endpoint family: the path below `/api/v1/`, ids
 * replaced by `:id`, the query dropped, trailing slash dropped.
 *
 * @param path - The request path, query and all.
 * @returns The family, or `root` for the API root.
 */
export function requestFamily_of(path: string): string {
  const bare: string = path.split('?')[0] ?? '';
  const below: string = bare.replace(/^.*?\/api\/v1\/?/, '').replace(/\/+$/, '');
  if (below === '') return 'root';
  return below.split('/').map((segment: string): string => (/^\d+$/.test(segment) ? ':id' : segment)).join('/');
}

const path_cap = (path: string): string => (path.length > PATH_KEPT ? `${path.slice(0, PATH_KEPT - 1)}…` : path);

function entry_record(method: string, path: string, status: number, t0: number): void {
  const ms: number = Math.round(performance.now() - t0);
  const family: string = requestFamily_of(path);
  total += 1;
  msTotal += ms;
  const tally: LedgerFamily = families.get(family) ?? { family, count: 0, ms: 0 };
  tally.count += 1;
  tally.ms += ms;
  families.set(family, tally);
  entries.push({ at: Date.now() - origin, method, family, path: path_cap(path), status, ms });
  if (entries.length > LEDGER_KEPT) entries.splice(0, entries.length - LEDGER_KEPT);
}

/**
 * Notes a request as it starts.
 *
 * @param request - The request object the channel carried (the key).
 * @param method - Its method.
 * @param path - Its path.
 */
export function ledger_requestStart(request: object, method: string, path: string): void {
  open.set(request, { t0: performance.now(), method, path });
}

/**
 * Notes a request as it ends, however it ended.
 *
 * @param request - The request object the channel carried.
 * @param status - The response status, or 0 for a failure.
 */
export function ledger_requestEnd(request: object, status: number): void {
  const begun = open.get(request);
  if (begun === undefined) return;
  open.delete(request);
  entry_record(begun.method, begun.path, status, begun.t0);
}

/**
 * Starts listening. Idempotent: the connection calls it as it is made,
 * and a second call changes nothing.
 */
export function requestLedger_start(): void {
  if (started) return;
  started = true;
  const method_of = (request: { method?: unknown }): string => (typeof request.method === 'string' ? request.method : 'GET');
  const path_of = (request: { path?: unknown }): string => (typeof request.path === 'string' ? request.path : '');
  subscribe('http.client.request.start', (message: unknown): void => {
    const { request } = message as { request?: { method?: unknown; path?: unknown } };
    if (request !== undefined && request !== null) ledger_requestStart(request, method_of(request), path_of(request));
  });
  subscribe('http.client.response.finish', (message: unknown): void => {
    const { request, response } = message as { request?: object; response?: { statusCode?: unknown } };
    if (request !== undefined && request !== null) ledger_requestEnd(request, typeof response?.statusCode === 'number' ? response.statusCode : 0);
  });
  subscribe('http.client.request.error', (message: unknown): void => {
    const { request } = message as { request?: object };
    if (request !== undefined && request !== null) ledger_requestEnd(request, 0);
  });
  subscribe('undici:request:create', (message: unknown): void => {
    const { request } = message as { request?: { method?: unknown; path?: unknown } };
    if (request !== undefined && request !== null) ledger_requestStart(request, method_of(request), path_of(request));
  });
  subscribe('undici:request:headers', (message: unknown): void => {
    const { request, response } = message as { request?: object; response?: { statusCode?: unknown } };
    if (request !== undefined && request !== null) ledger_requestEnd(request, typeof response?.statusCode === 'number' ? response.statusCode : 0);
  });
  subscribe('undici:request:error', (message: unknown): void => {
    const { request } = message as { request?: object };
    if (request !== undefined && request !== null) ledger_requestEnd(request, 0);
  });
}

/**
 * Forgets the count: the next snapshot counts from now. The last entries
 * are kept so a reset mid-navigation still shows what just happened.
 */
export function requestLedger_reset(): void {
  origin = Date.now();
  since = new Date(origin).toISOString();
  total = 0;
  msTotal = 0;
  families.clear();
  entries.length = 0;
}

/**
 * Reads the ledger.
 *
 * @param options - `last`: how many recent entries to carry (default 20).
 * @returns The snapshot, families most-requested first.
 */
export function requestLedger_snapshot(options: { last?: number } = {}): LedgerSnapshot {
  const last: number = Math.max(0, Math.min(LEDGER_KEPT, options.last ?? 20));
  return {
    since,
    total,
    ms: msTotal,
    families: [...families.values()].sort((a: LedgerFamily, b: LedgerFamily): number => b.count - a.count || a.family.localeCompare(b.family)),
    last: entries.slice(-last),
  };
}
