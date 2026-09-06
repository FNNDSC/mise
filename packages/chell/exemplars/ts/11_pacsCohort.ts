/**
 * @file Exemplar 11 — a cohort answers for every patient asked, including
 * the ones with nothing.
 *
 * A PACS will not match a list: DICOM defines *List of UID Matching* only
 * for attributes whose VR is `UI`, and `PatientID` is `LO`. So asking after
 * N patients is N C-FINDs, and the interesting half of the answer is the
 * half no PACS returns — which of the MRNs asked have no imaging at all.
 *
 * Five properties, and the fourth is the one that needs a live PACS rather
 * than a mock, because a mock can only agree with whatever the code does:
 *
 * 1. A cohort answers per patient: one row for every MRN asked.
 * 2. The misses are present. This counts ROWS, not hits — an audit's
 *    question is usually about the patients a hit-list would hide.
 * 3. Replay applies per patient: the second ask of the same cohort is
 *    served from stored answers, while a row that found NOTHING is asked
 *    again rather than having its emptiness served back.
 * 4. A failure is not a miss. A server that cannot answer leaves its row
 *    `unasked`, distinguishable from `none` by reading the model alone.
 * 5. The CSV round-trips: `--csv-to` writes a file into CFS whose rows
 *    match the cohort, and a study description carrying a comma survives.
 *
 * The cohort needs no new fixture: the designated test accession names a
 * study, that study names a patient, and that patient is the MRN known to
 * have imaging. The other MRNs cannot exist.
 *
 * Every PACSQuery this run creates is deleted again, and the CSV it writes
 * is removed, so the CUBE ends as it began.
 *
 *   node exemplars/ts/dist/11_pacsCohort.js
 *
 * @module
 */
import type { CommandEnvelope } from '@fnndsc/cumin';
import { command_dispatchEnvelope, engine_create } from '@fnndsc/brasa';
import { pacsQueryModelSchema, type PacsPatient, type PacsQueryModel } from '@fnndsc/menu';
import {
  env_load, pacsFixture_require, config_isolate, cube_connect, check, section,
  summary_exit, restToken_get, pacsQuery_deleteById, runId_make, CleanupPlan, CubeEnv,
} from './lib/harness.js';

/** MRNs of this shape cannot be real, and a PACS matches them literally. */
const ABSENT_A: string = 'ZZ9-NO-SUCH-MRN';
const ABSENT_B: string = 'ZZ9-NOR-THIS-ONE';

/** A server name CUBE does not register, for the failure case. */
const ABSENT_SERVER: string = 'NO_SUCH_PACS';

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

/** One patient row of a model, by MRN. */
function patient_of(model: PacsQueryModel, mrn: string): PacsPatient | undefined {
  return (model.patients ?? []).find((patient: PacsPatient): boolean => patient.patientId === mrn);
}

/** Registers every query a cohort created for deletion. */
function cohortCleanup_register(
  env: CubeEnv,
  cleanup: CleanupPlan,
  model: PacsQueryModel,
  registered: Set<number>,
): void {
  for (const patient of model.patients ?? []) {
    const queryId: number | undefined = patient.queryId;
    // A replayed row names the query that answered it the first time, so
    // the same id arrives again; deleting it twice would report a failure
    // for work that succeeded.
    if (queryId === undefined || registered.has(queryId)) continue;
    registered.add(queryId);
    cleanup.register(`deleted PACSQuery ${queryId}`, async (): Promise<boolean> => {
      const token: string = await restToken_get(env.url, env.user, env.password);
      return pacsQuery_deleteById(env.url, token, queryId);
    });
  }
}

async function main(): Promise<void> {
  const env: CubeEnv = env_load();
  const accession: string = pacsFixture_require(env);
  config_isolate();

  section('authenticate');
  const token: string = await cube_connect(env);
  check('received an auth token', token.length > 0);
  // `--csv-to` writes through the VFS, which the engine registers.
  await engine_create();

  const cleanup: CleanupPlan = new CleanupPlan();
  /** Query ids already scheduled for deletion. */
  const registered: Set<number> = new Set<number>();

  section('find the MRN the fixture study belongs to');
  const seed = await query_run([`AccessionNumber:${accession}`, '--title', `exemplar 11 seed ${runId_make()}`]);
  check('the fixture accession answered', seed.model !== null && seed.model.studies.length > 0);
  if (seed.model === null || seed.model.studies.length === 0) summary_exit();
  cohortCleanup_register(env, cleanup, seed.model, registered);
  if (seed.model.queryId !== 0) {
    const seedId: number = seed.model.queryId;
    if (!registered.has(seedId)) {
      registered.add(seedId);
      cleanup.register(`deleted PACSQuery ${seedId}`, async (): Promise<boolean> => {
        const restToken: string = await restToken_get(env.url, env.user, env.password);
        return pacsQuery_deleteById(env.url, restToken, seedId);
      });
    }
  }
  const known: string = seed.model.studies[0].patientId;
  check('and it names the patient it belongs to', known.length > 0);
  console.log(`    (cohort: ${known}, ${ABSENT_A}, ${ABSENT_B})`);

  section('a cohort answers for every patient asked');
  const cohortArgs: string[] = ['--patients', `${known},${ABSENT_A},${ABSENT_B}`];
  const first = await query_run([...cohortArgs, '--title', `exemplar 11 cohort ${runId_make()}`]);
  check('the cohort answered', first.model !== null);
  if (first.model === null) summary_exit();
  cohortCleanup_register(env, cleanup, first.model, registered);
  const rows: ReadonlyArray<PacsPatient> = first.model.patients ?? [];
  // Rows, not hits: an MRN with no imaging is the answer an audit wants,
  // and a table of hits is exactly where it would be lost.
  check('every MRN asked has a row, hits and misses alike', rows.length === 3);
  check('the patient with imaging reads found', patient_of(first.model, known)?.status === 'found');
  check('the patients without it read none, not error',
    patient_of(first.model, ABSENT_A)?.status === 'none'
    && patient_of(first.model, ABSENT_B)?.status === 'none');
  check('a miss carries zero studies rather than nothing at all',
    patient_of(first.model, ABSENT_A)?.studyCount === 0);

  section('replay applies per patient, and an absence is asked again');
  const second = await query_run([...cohortArgs, '--title', `exemplar 11 cohort again ${runId_make()}`]);
  check('the second ask answered', second.model !== null);
  if (second.model === null) summary_exit();
  cohortCleanup_register(env, cleanup, second.model, registered);
  check('the patient with imaging was served from the stored answer',
    patient_of(second.model, known)?.provenance?.replayed === true);
  check('and it is the same stored query, not a second one',
    patient_of(second.model, known)?.queryId === patient_of(first.model, known)?.queryId);
  // An absence decays; a hit does not. "No imaging found" is the answer a
  // clinician acts on, so it is never served back from a shelf.
  check('a row that found nothing was asked again rather than replayed',
    patient_of(second.model, ABSENT_A)?.provenance?.replayed === false
    && patient_of(second.model, ABSENT_A)?.queryId !== patient_of(first.model, ABSENT_A)?.queryId);

  section('a failure is not a miss');
  // Asked of two patients, so this is a fan-out: a single question that
  // cannot be asked is an error envelope with a reason, which is the right
  // answer for one question and no place to put a row.
  const failed = await query_run([
    '--patients', `${known},${ABSENT_A}`, '--pacsserver', ABSENT_SERVER,
    '--title', `exemplar 11 unreachable ${runId_make()}`,
  ]);
  check('the ask answered with a model rather than nothing', failed.model !== null);
  if (failed.model !== null) {
    cohortCleanup_register(env, cleanup, failed.model, registered);
    const row: PacsPatient | undefined = patient_of(failed.model, known);
    check('the unreachable server left the row unasked, never zero',
      row?.status === 'unasked' && row?.studyCount === 0);
    check('and it says why, in a sentence an operator can act on',
      (row?.error ?? '').length > 0 && !(row?.error ?? '').startsWith('['));
  }

  section('the CSV round-trips through ChRIS storage');
  // Spelled in full: this run isolates its config, so there is no saved
  // context for `~` to expand against — which is a property of the
  // exemplar, not of the flag.
  const home: string = `/home/${env.user}`;
  const csvPath: string = `${home}/audits/exemplar-11-${runId_make()}.csv`;
  await command_dispatchEnvelope('mkdir', [`${home}/audits`]);
  const written = await query_run([...cohortArgs, '--csv-to', csvPath, '--title', `exemplar 11 csv ${runId_make()}`]);
  check('the CSV write reported success', written.envelope.rendered.includes('wrote'));
  if (written.model !== null) cohortCleanup_register(env, cleanup, written.model, registered);
  const read: CommandEnvelope = await command_dispatchEnvelope('cat', [csvPath]);
  const lines: string[] = read.rendered.trimEnd().split('\n').filter((line: string): boolean => line !== '');
  check('the file reads back with a header and a row per study or miss',
    lines.length >= 3 && lines[0].startsWith('"MRN"'));
  check('every row carries the same ten columns, whatever the text inside them',
    lines.length > 0 && lines.every((line: string): boolean => line.split('","').length === 10));
  check('the misses are in the file, not only the hits',
    lines.some((line: string): boolean => line.includes(ABSENT_A))
    && lines.some((line: string): boolean => line.includes(ABSENT_B)));
  cleanup.register(`removed ${csvPath}`, async (): Promise<boolean> => {
    const removed: CommandEnvelope = await command_dispatchEnvelope('rm', [csvPath]);
    return removed.status === 'ok';
  });

  section('cleanup');
  await cleanup.run();

  summary_exit();
}

void main();
