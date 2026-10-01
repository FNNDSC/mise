/**
 * @file One pipeline resolution per specifier per session.
 *
 * A pipeline diagram cost CUBE a name search, then the same pipeline listed
 * again by id (chrisapi's `getPipeline` is a list-by-id), then its pipings
 * and defaults — and the browser's PREVIEW projection asks for a diagram
 * per pipeline card on every visit to /bin. A registered pipeline's record
 * (id, name) is immutable, as its topology is, so a resolution is kept for
 * the life of the connection's client, and the chrisapi item the search
 * served is kept beside it: the pipings hang off that item, and nothing
 * need list the pipeline a second time to reach them. A miss is never
 * kept, so a pipeline registered after the memo was filled still resolves.
 */
import type { PipelineRecord } from './chrisPipeline.js';

/** What a session remembers of its pipelines, per client. */
interface PipelineMemo {
  /** Resolutions by the specifier that was asked (a name or an id string). */
  records: Map<string, PipelineRecord>;
  /** The chrisapi pipeline items a search or a get served, by pipeline id. */
  resources: Map<number, object>;
}

/** Memos by client: a new connection starts empty. */
const memos: WeakMap<object, PipelineMemo> = new WeakMap();

/**
 * The memo of one client, made on first use.
 *
 * @param client - The connection's chrisapi client.
 * @returns That client's memo.
 */
function memo_for(client: object): PipelineMemo {
  const kept: PipelineMemo | undefined = memos.get(client);
  if (kept !== undefined) return kept;
  const made: PipelineMemo = { records: new Map(), resources: new Map() };
  memos.set(client, made);
  return made;
}

/**
 * Recalls a resolution.
 *
 * @param client - The connection's chrisapi client.
 * @param specifier - The name or id string that was asked.
 * @returns The record, or null when this session never resolved it.
 */
export function pipelineRecord_recall(client: object, specifier: string): PipelineRecord | null {
  return memo_for(client).records.get(specifier) ?? null;
}

/**
 * Keeps a resolution under the specifier asked and under the record's own
 * name and id, so any of the three answers next time.
 *
 * @param client - The connection's chrisapi client.
 * @param specifier - The name or id string that was asked.
 * @param record - The record it resolved to.
 */
export function pipelineRecord_keep(client: object, specifier: string, record: PipelineRecord): void {
  const memo: PipelineMemo = memo_for(client);
  memo.records.set(specifier, record);
  memo.records.set(record.name, record);
  memo.records.set(String(record.id), record);
}

/**
 * Recalls the chrisapi item of a pipeline.
 *
 * @param client - The connection's chrisapi client.
 * @param pipelineID - The pipeline's id.
 * @returns The item, or null when none was served this session.
 */
export function pipelineResource_recall(client: object, pipelineID: number): object | null {
  return memo_for(client).resources.get(pipelineID) ?? null;
}

/**
 * Keeps the chrisapi item a search or a get served.
 *
 * @param client - The connection's chrisapi client.
 * @param pipelineID - The pipeline's id.
 * @param resource - The chrisapi pipeline item.
 */
export function pipelineResource_keep(client: object, pipelineID: number, resource: object): void {
  memo_for(client).resources.set(pipelineID, resource);
}

/**
 * Forgets one pipeline: its item and every specifier that resolved to it.
 * Called when an item kept turns out not to answer (the pipeline was
 * removed under the session), so the next ask resolves afresh.
 *
 * @param client - The connection's chrisapi client.
 * @param pipelineID - The pipeline's id.
 */
export function pipeline_forget(client: object, pipelineID: number): void {
  const memo: PipelineMemo = memo_for(client);
  memo.resources.delete(pipelineID);
  for (const [specifier, record] of memo.records) {
    if (record.id === pipelineID) memo.records.delete(specifier);
  }
}

/**
 * How many resolutions a client's memo holds (for tests and readouts).
 *
 * @param client - The connection's chrisapi client.
 * @returns The count of specifiers kept.
 */
export function pipelineMemo_count(client: object): number {
  return memos.get(client)?.records.size ?? 0;
}
