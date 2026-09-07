/**
 * @file Exemplar 12 — a command that needs a value asks for it, and the
 * answer is what happens next.
 *
 * A surface could always be told things; it could never be ASKED. The wire
 * carried a question and argus refused every one, so anything needing a
 * value the operator had not already typed could not be built. This drives
 * the whole path through `command_dispatchEnvelope` — the same entry chell
 * uses — with a scripted surface standing in for whoever answers.
 *
 * Four properties:
 *
 * 1. A value-taking flag given no value ASKS, and the question says what it
 *    wants: a location, where browsing starts, a name to offer, and the
 *    word its committing control should read.
 * 2. The answer is what happens next: the file lands where the answer said.
 * 3. Abandoning is an answer too. Nothing is written, and the command says
 *    what it did not do rather than failing silently or hanging.
 * 4. The anchor is somewhere a file can land. A session sitting in a
 *    provider path is browsing, not standing where a file goes, so the ask
 *    falls back to home rather than offering a destination that would be
 *    refused the moment it was committed.
 *
 * The fixture accession names a study, that study names a patient, and that
 * patient is the MRN this exports. Every PACSQuery the run creates is
 * deleted and every file it writes is removed.
 *
 *   node exemplars/ts/dist/12_ask.js
 *
 * @module
 */
import type { CommandEnvelope } from '@fnndsc/cumin';
import {
  command_dispatchEnvelope,
  engine_create,
  surface_get,
  surface_set,
  type PromptRequest,
  type Surface,
} from '@fnndsc/brasa';
import { pacsQueryModelSchema, type PacsQueryModel } from '@fnndsc/menu';
import {
  env_load, pacsFixture_require, config_isolate, cube_connect, check, section,
  summary_exit, restToken_get, pacsQuery_deleteById, runId_make, CleanupPlan, CubeEnv,
} from './lib/harness.js';

/** What a scripted surface saw, and what it answered. */
interface Asked {
  request: PromptRequest | null;
  answer: string | null;
}

/**
 * Replaces the surface with one that answers a question the way an operator
 * would, and remembers what it was asked.
 *
 * @param answer - The answer to give, or null to abandon the question.
 * @returns The record the run reads afterwards.
 */
function surface_script(answer: string | null): Asked {
  const seen: Asked = { request: null, answer };
  const real: Surface = surface_get();
  surface_set({
    ...real,
    prompt: async (request: PromptRequest): Promise<string> => {
      seen.request = request;
      if (answer === null) throw new Error('the operator abandoned the question');
      return answer;
    },
  });
  return seen;
}

/**
 * Runs a `pacs query` line through the kernel.
 *
 * @param args - Arguments after `pacs query`.
 * @returns The envelope, and its model when it carried one.
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

async function main(): Promise<void> {
  const env: CubeEnv = env_load();
  const accession: string = pacsFixture_require(env);
  config_isolate();

  section('authenticate');
  const token: string = await cube_connect(env);
  check('received an auth token', token.length > 0);
  await engine_create();

  const cleanup: CleanupPlan = new CleanupPlan();
  const registered: Set<number> = new Set<number>();
  const query_register = (model: PacsQueryModel | null): void => {
    const id: number | undefined = model?.queryId;
    if (id === undefined || id === 0 || registered.has(id)) return;
    registered.add(id);
    cleanup.register(`deleted PACSQuery ${id}`, async (): Promise<boolean> => {
      const restToken: string = await restToken_get(env.url, env.user, env.password);
      return pacsQuery_deleteById(env.url, restToken, id);
    });
  };

  section('find the MRN the fixture study belongs to');
  const seed = await query_run([`AccessionNumber:${accession}`, '--title', `exemplar 12 seed ${runId_make()}`]);
  check('the fixture accession answered', seed.model !== null && seed.model.studies.length > 0);
  if (seed.model === null || seed.model.studies.length === 0) summary_exit();
  query_register(seed.model);
  const mrn: string = seed.model.studies[0].patientId;
  check('and it names the patient it belongs to', mrn.length > 0);

  const home: string = `/home/${env.user}`;
  const folder: string = `${home}/exemplar-12-${runId_make()}`;

  section('a flag given no value asks, and says what it wants');
  const answered: Asked = surface_script(`${folder}/asked.csv`);
  const asked = await query_run([`PatientID:${mrn}`, '--csv-to', '--title', `exemplar 12 ask ${runId_make()}`]);
  query_register(asked.model);
  check('the command asked rather than doing nothing', answered.request !== null);
  const request: PromptRequest | null = answered.request;
  check('the question says it wants a location', request?.wants === 'path');
  check('it says where browsing starts', (request?.path?.anchor ?? '').startsWith('/'));
  check('it offers a name, so answering is a rename', /\.csv$/.test(request?.path?.suggest ?? ''));
  check('and it says what the committing control should read', request?.commit === 'EXPORT HERE');

  section('the answer is what happens next');
  check('the command reported writing where the answer said',
    asked.envelope.rendered.includes(`${folder}/asked.csv`));
  const read: CommandEnvelope = await command_dispatchEnvelope('cat', [`${folder}/asked.csv`]);
  const lines: string[] = read.rendered.trimEnd().split('\n').filter((line: string): boolean => line !== '');
  check('and the file is there, with a header and at least one row',
    lines.length >= 2 && lines[0].startsWith('"MRN"'));
  cleanup.register(`removed ${folder}`, async (): Promise<boolean> => {
    const removed: CommandEnvelope = await command_dispatchEnvelope('rm', ['-r', folder]);
    return removed.status === 'ok';
  });

  section('abandoning is an answer too');
  const abandoned: Asked = surface_script(null);
  const gave = await query_run([`PatientID:${mrn}`, '--csv-to', '--title', `exemplar 12 abandon ${runId_make()}`]);
  query_register(gave.model);
  check('the question was put', abandoned.request !== null);
  check('nothing was written, and the command said so',
    (gave.envelope.renderedErr ?? '').includes('nothing written'));
  check('the answer itself still stands', gave.model !== null && gave.model.studies.length > 0);

  section('the anchor is somewhere a file can land');
  await command_dispatchEnvelope('cd', ['/bin']);
  const fromProvider: Asked = surface_script(`${folder}/from-bin.csv`);
  const asked2 = await query_run([`PatientID:${mrn}`, '--csv-to', '--title', `exemplar 12 anchor ${runId_make()}`]);
  query_register(asked2.model);
  await command_dispatchEnvelope('cd', [home]);
  // A session browsing `/bin` is not standing where a file goes.
  check('a provider cwd is not offered as a destination',
    fromProvider.request?.path?.anchor === '~');

  section('cleanup');
  await cleanup.run();

  summary_exit();
}

void main();
