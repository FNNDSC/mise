/**
 * @file Persistence tests for the query index: permissions, a round trip
 * that keeps the sweep's floor, identity and schema rejection, and the
 * throttled writer.
 *
 * The index is expensive to build — a walk of a collection whose every row
 * drags a compressed result — so losing it costs an operator a rebuild.
 * These pin that it comes back, and that a file which cannot be trusted is
 * declined quietly rather than half-restored.
 */
import { mkdtemp, readFile, stat, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { queryIndex_get, type QueryIndexEntry } from '../src/cache/queryIndex';
import {
  queryIndexCheckpointPath_get,
  queryIndexCheckpoint_restore,
  queryIndexCheckpoint_save,
  queryIndexCheckpoint_watch,
  type QueryIndexRestoreResult,
} from '../src/cache/queryIndexCheckpoint';

const identity: string = 'user@https://cube.example.org/api/v1/';
let root: string;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => { setTimeout(resolve, ms); });
}

/** A query record as the index files it. */
function entry_make(overrides: Partial<QueryIndexEntry> = {}): QueryIndexEntry {
  return {
    queryId: 1,
    server: 'PACSDCM',
    criteria: { PatientID: '4432456' },
    owner: 'user',
    answeredAt: '2026-09-05T10:00:00.000Z',
    hasResult: true,
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chell-query-index-'));
  queryIndex_get().reset();
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('keys the file by identity without spelling the identity out', () => {
  const path: string = queryIndexCheckpointPath_get(identity, root);
  expect(path).toContain('pacs-queries-');
  expect(path).not.toContain('cube.example.org');
  expect(queryIndexCheckpointPath_get('someone-else@elsewhere/', root)).not.toBe(path);
});

it('saves a mode-0600 file and restores the records and the floor', async () => {
  const index = queryIndex_get();
  index.entry_note(entry_make({ queryId: 7 }));
  index.entry_note(entry_make({ queryId: 8, criteria: { AccessionNumber: '22119730' } }));
  index.floor_set('2026-01-01T00:00:00.000Z');
  await queryIndexCheckpoint_save(identity, root);

  const path: string = queryIndexCheckpointPath_get(identity, root);
  expect((await stat(path)).mode & 0o777).toBe(0o600);

  index.reset();
  const restored: QueryIndexRestoreResult = await queryIndexCheckpoint_restore(identity, root);
  expect(restored.restored).toBe(true);
  expect(restored.count).toBe(2);
  expect(index.size_get()).toBe(2);
  expect(index.floor_get()).toBe('2026-01-01T00:00:00.000Z');
  expect(index.entry_find({ PatientID: '4432456' }, 'PACSDCM', 'user')?.queryId).toBe(7);
});

it('keeps a query that found nothing across the round trip', async () => {
  queryIndex_get().entry_note(entry_make({ queryId: 9, hasResult: false }));
  await queryIndexCheckpoint_save(identity, root);
  queryIndex_get().reset();
  await queryIndexCheckpoint_restore(identity, root);
  expect(queryIndex_get().entry_find({ PatientID: '4432456' }, 'PACSDCM', 'user')?.hasResult).toBe(false);
});

it('says so, rather than throwing, when there is no checkpoint', async () => {
  const restored: QueryIndexRestoreResult = await queryIndexCheckpoint_restore(identity, root);
  expect(restored.restored).toBe(false);
  expect(restored.reason).toBe('no query index');
});

it("declines another identity's checkpoint", async () => {
  queryIndex_get().entry_note(entry_make());
  await queryIndexCheckpoint_save(identity, root);
  const restored: QueryIndexRestoreResult = await queryIndexCheckpoint_restore('someone@else/', root);
  expect(restored.restored).toBe(false);
});

it('declines a file it cannot trust rather than restoring half of it', async () => {
  const path: string = queryIndexCheckpointPath_get(identity, root);
  await writeFile(path, JSON.stringify({
    schemaVersion: 1,
    identity,
    writtenAt: new Date().toISOString(),
    floor: null,
    entries: [{ key: 'k', queryId: 'not a number', server: 'P', criteria: {}, owner: '', answeredAt: 'x', hasResult: true }],
  }));
  const restored: QueryIndexRestoreResult = await queryIndexCheckpoint_restore(identity, root);
  expect(restored.restored).toBe(false);
  expect(restored.reason).toBe('incompatible query index');
  expect(queryIndex_get().size_get()).toBe(0);
});

it('declines a checkpoint written by a different schema', async () => {
  const path: string = queryIndexCheckpointPath_get(identity, root);
  await writeFile(path, JSON.stringify({
    schemaVersion: 99, identity, writtenAt: new Date().toISOString(), floor: null, entries: [],
  }));
  expect((await queryIndexCheckpoint_restore(identity, root)).restored).toBe(false);
});

it('declines unparseable JSON without throwing', async () => {
  await writeFile(queryIndexCheckpointPath_get(identity, root), 'not json at all');
  const restored: QueryIndexRestoreResult = await queryIndexCheckpoint_restore(identity, root);
  expect(restored.restored).toBe(false);
  expect(restored.reason).not.toBe('no query index');
});

it('writes once for a burst of queries, and never drops the last', async () => {
  const stop: () => void = queryIndexCheckpoint_watch(identity, root, 20, 20);
  try {
    for (let i = 1; i <= 5; i++) {
      queryIndex_get().entry_note(entry_make({ queryId: i, criteria: { PatientID: String(i) } }));
    }
    await sleep(120);
    const written: string = await readFile(queryIndexCheckpointPath_get(identity, root), 'utf8');
    const parsed = JSON.parse(written) as { entries: unknown[] };
    expect(parsed.entries).toHaveLength(5);
  } finally {
    stop();
  }
});

it('stops writing once the watch is released', async () => {
  const stop: () => void = queryIndexCheckpoint_watch(identity, root, 20, 20);
  queryIndex_get().entry_note(entry_make({ queryId: 1 }));
  await sleep(120);
  stop();
  queryIndex_get().entry_note(entry_make({ queryId: 2, criteria: { PatientID: 'later' } }));
  await sleep(120);
  const written: string = await readFile(queryIndexCheckpointPath_get(identity, root), 'utf8');
  const parsed = JSON.parse(written) as { entries: unknown[] };
  expect(parsed.entries).toHaveLength(1);
});
