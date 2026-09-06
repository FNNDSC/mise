/**
 * @file Exemplar 09 — a replayed PACS query equals a fresh one, and an
 * absence is never replayed.
 *
 * The claim this proves: CUBE has been storing every PACS answer all along,
 * so a question asked before can be answered without troubling the PACS —
 * and the answer it gives back is the same answer, not a plausible one.
 *
 * Four properties, and the third is the one worth a live test rather than
 * a mock:
 *
 * 1. `--fresh` reaches the PACS and says the answer is live.
 * 2. The same question, asked again, is served from the stored result: the
 *    same query id, the same studies, the same series, the same file
 *    counts, and provenance saying so. A closed query names a study that
 *    exists, so any difference at all is a decoding bug.
 * 3. A query that found NOTHING is asked again rather than replayed. A hit
 *    is evidence that persists; an absence decays, and "no imaging found"
 *    is the answer a clinician acts on.
 * 4. The index survives being written and read back, so the sweep that
 *    builds it is a once-ever cost rather than a per-boot one.
 *
 * Driven through `command_dispatchEnvelope`, which is the same entry chell
 * uses, so what is proven here is what an operator gets.
 *
 * Every PACSQuery this run creates is deleted again, so the CUBE ends as it
 * began.
 *
 *   node exemplars/ts/dist/09_pacsReplay.js
 *
 * @module
 */

import {
  queryIndex_get,
  queryIndexCheckpoint_restore,
  queryIndexCheckpoint_save,
  type CommandEnvelope,
  type QueryIndexEntry,
} from '@fnndsc/cumin';
import { command_dispatchEnvelope } from '@fnndsc/brasa';
import { pacsQueryModelSchema, type PacsQueryModel } from '@fnndsc/menu';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  env_load, pacsFixture_require, config_isolate, cube_connect, check, section,
  summary_exit, restToken_get, pacsQuery_deleteById, CleanupPlan, CubeEnv,
} from './lib/harness.js';

/**
 * A patient id no PACS will match.
 *
 * NOT a zeroed accession, which is what this first reached for: a PACS
 * answered `AccessionNumber:00000000` with a hundred and seventy-one
 * series, because an all-zero value reads as unspecified rather than as a
 * value that matches nothing. A patient id of this shape cannot be a real
 * MRN and is matched literally.
 */
const ABSENT_PATIENT: string = 'ZZ9-NO-SUCH-MRN';

/**
 * Runs a `pacs query` line through the kernel and reads back its model.
 *
 * @param args - Arguments after `pacs query`.
 * @returns The envelope and its parsed model, when it carried one.
 */
async function query_run(args: string[]): Promise<{
  envelope: CommandEnvelope;
  model: PacsQueryModel | null;
}> {
  const envelope: CommandEnvelope = await command_dispatchEnvelope('pacs', ['query', ...args]);
  const raw: unknown = envelope.model?.data;
  if (raw === undefined) return { envelope, model: null };
  const parsed = pacsQueryModelSchema.safeParse(raw);
  return { envelope, model: parsed.success ? parsed.data : null };
}

/** A model's shape, flattened, so two answers can be compared exactly. */
function answer_fingerprint(model: PacsQueryModel): string {
  return model.studies
    .map((study): string => [
      study.studyUID ?? '',
      study.description,
      study.date,
      study.series
        .map((series): string => `${series.seriesUID}:${series.description}:${series.fileCount ?? -1}`)
        .sort()
        .join('|'),
    ].join('/'))
    .sort()
    .join('\n');
}

/**
 * Registers deletion of a PACSQuery on the cleanup plan.
 *
 * @param env - The CUBE environment.
 * @param cleanup - The cleanup plan.
 * @param queryId - The query to delete during cleanup.
 */
function queryCleanup_register(env: CubeEnv, cleanup: CleanupPlan, queryId: number): void {
  cleanup.register(`deleted PACSQuery ${queryId}`, async (): Promise<boolean> => {
    const token: string = await restToken_get(env.url, env.user, env.password);
    return pacsQuery_deleteById(env.url, token, queryId);
  });
}

async function main(): Promise<void> {
  const env: CubeEnv = env_load();
  const accession: string = pacsFixture_require(env);
  config_isolate();

  section('authenticate');
  const token: string = await cube_connect(env);
  check('received an auth token', token.length > 0);

  const cleanup: CleanupPlan = new CleanupPlan();
  const expression: string = `AccessionNumber:${accession}`;

  section('a fresh query reaches the PACS');
  const fresh = await query_run([expression, '--fresh', '--title', 'exemplar 09 fresh']);
  check('the fresh query answered', fresh.model !== null);
  if (fresh.model === null) summary_exit();
  queryCleanup_register(env, cleanup, fresh.model.queryId);
  check('it found the fixture accession', fresh.model.studies.length > 0);
  check('its provenance says it was not replayed', fresh.model.provenance?.replayed === false);

  section('the same question is served from the stored answer');
  const replayed = await query_run([expression]);
  check('the replay answered', replayed.model !== null);
  if (replayed.model === null) summary_exit();
  check('its provenance says it was replayed', replayed.model.provenance?.replayed === true);
  check('it names the query the fresh ask created', replayed.model.queryId === fresh.model.queryId);
  check('it states when the PACS answered', (replayed.model.provenance?.answeredAt ?? '').length > 0);
  // A closed query is a fact about a study that exists. Any difference
  // between the two answers is a decoding bug, not a change in the world.
  check(
    'the replayed answer is identical: same studies, series and file counts',
    answer_fingerprint(replayed.model) === answer_fingerprint(fresh.model),
  );
  check(
    'and it did not create a second query record',
    replayed.model.queryId === fresh.model.queryId,
  );

  section('an absence is asked again, never replayed');
  const absent: string = `PatientID:${ABSENT_PATIENT}`;
  const missFirst = await query_run([absent, '--title', 'exemplar 09 miss a']);
  check('the first ask found nothing', missFirst.model !== null && missFirst.model.studies.length === 0);
  if (missFirst.model !== null) queryCleanup_register(env, cleanup, missFirst.model.queryId);
  const missSecond = await query_run([absent, '--title', 'exemplar 09 miss b']);
  check('the second ask found nothing', missSecond.model !== null && missSecond.model.studies.length === 0);
  if (missSecond.model !== null) queryCleanup_register(env, cleanup, missSecond.model.queryId);
  check(
    'it reached the PACS again rather than serving the emptiness back',
    missFirst.model !== null && missSecond.model !== null &&
    missFirst.model.queryId !== missSecond.model.queryId,
  );

  section('the index survives being put down and picked up');
  const root: string = await mkdtemp(join(tmpdir(), 'exemplar-query-index-'));
  try {
    const identity: string = 'exemplar-09';
    const before: number = queryIndex_get().size_get();
    const filed: QueryIndexEntry | undefined = queryIndex_get()
      .entries_all()
      .find((entry: QueryIndexEntry): boolean => entry.queryId === fresh.model?.queryId);
    console.log(`    (filed under owner '${filed?.owner ?? '?'}' on server '${filed?.server ?? '?'}')`);
    await queryIndexCheckpoint_save(identity, root);
    queryIndex_get().reset();
    check('the index is empty once reset', queryIndex_get().size_get() === 0);
    const restored = await queryIndexCheckpoint_restore(identity, root);
    check('the checkpoint restored', restored.restored && restored.count === before);
    // Looked up by the key the entry actually carries, rather than by one
    // this exemplar assumes: the owner CUBE reports and the identifier a
    // server resolves to are environment facts, and asserting them here
    // would test the fixture rather than the round trip.
    check('the fresh query survived as a record', filed !== undefined);
    if (filed !== undefined) {
      const found: QueryIndexEntry | null = queryIndex_get()
        .entry_find(filed.criteria, filed.server, filed.owner);
      check('and is findable again by its own key', found?.queryId === fresh.model.queryId);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  section('cleanup');
  await cleanup.run();

  summary_exit();
}

void main();
