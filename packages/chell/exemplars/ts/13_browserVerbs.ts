/**
 * @file Exemplar 13 — the verbs a browser's rows lower to, proven against
 * the kernel rather than against a surface that loops.
 *
 * Every control the file browser gained in the `a control lives where it
 * acts` epic lowers to a session command: DELETE to `rm -i`, MOVE and COPY
 * to a one-operand `mv` and `cp` whose missing destination is a question,
 * a selection's verbs to ONE command over many operands. That is the claim
 * this run tests — at the kernel, where the surface's looping cannot hide a
 * verb that only appears to work.
 *
 * Six properties:
 *
 * 1. A missing operand ASKS, and the question carries the source's own
 *    folder as its anchor and the source's name as what it offers, so
 *    answering is a rename rather than a path typed from scratch.
 * 2. The answer is what happens next: the file is at the new path and not
 *    at the old one.
 * 3. Abandoning moves nothing, and the command says what it did not do.
 * 4. `rm -i` asks before removing, and answering no leaves the file where
 *    it was.
 * 5. A bulk act is ONE command: `rm -I a b c` asks once and removes three;
 *    `mv -t a b c` asks for a DIRECTORY and lands three in it.
 * 6. A write onto a path the store already holds is refused BY NAME rather
 *    than attempted — a write there leaves a row CUBE cannot serve, and one
 *    such row makes every listing of that folder fail
 *    (docs/CUBE-gaps.adoc).
 *
 * Every file and folder this run makes is removed again.
 *
 *   node exemplars/ts/dist/13_browserVerbs.js
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
import {
  env_load, config_isolate, cube_connect, check, section,
  summary_exit, runId_make, CleanupPlan, CubeEnv,
} from './lib/harness.js';

/** What a scripted surface was asked, and what it answered. */
interface Asked {
  request: PromptRequest | null;
  answer: string | null;
}

/**
 * Replaces the surface with one that answers the way an operator would.
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

/** Counts how many questions a surface is put, answering each the same way. */
function surface_count(answer: string): { asked: number; last: PromptRequest | null } {
  const seen: { asked: number; last: PromptRequest | null } = { asked: 0, last: null };
  const real: Surface = surface_get();
  surface_set({
    ...real,
    prompt: async (request: PromptRequest): Promise<string> => {
      seen.asked += 1;
      seen.last = request;
      return answer;
    },
  });
  return seen;
}

/**
 * Whether a listing holds a name.
 *
 * @param folder - The folder to list.
 * @param name - The entry's name.
 * @returns True when the listing names it.
 */
async function listing_holds(folder: string, name: string): Promise<boolean> {
  const listed: CommandEnvelope = await command_dispatchEnvelope('ls', [folder]);
  return listed.rendered.includes(name);
}

async function main(): Promise<void> {
  const env: CubeEnv = env_load();
  config_isolate();

  section('authenticate');
  const token: string = await cube_connect(env);
  check('received an auth token', token.length > 0);
  await engine_create();

  const cleanup: CleanupPlan = new CleanupPlan();
  const home: string = `/home/${env.user}`;
  const folder: string = `${home}/exemplar-13-${runId_make()}`;
  const target: string = `${folder}/moved`;

  section('a folder to work in');
  await command_dispatchEnvelope('mkdir', [folder]);
  await command_dispatchEnvelope('mkdir', [target]);
  cleanup.register(`removed ${folder}`, async (): Promise<boolean> => {
    const removed: CommandEnvelope = await command_dispatchEnvelope('rm', ['-r', folder]);
    return removed.status === 'ok';
  });
  await command_dispatchEnvelope('touch', [`${folder}/one.txt`]);
  check('a file to move exists', await listing_holds(folder, 'one.txt'));

  section('a missing operand asks, and says where to look');
  const answered: Asked = surface_script(`${folder}/renamed.txt`);
  const moved: CommandEnvelope = await command_dispatchEnvelope('mv', [`${folder}/one.txt`]);
  check('the command asked rather than printing a usage line', answered.request !== null);
  const request: PromptRequest | null = answered.request;
  check('the question wants a location', request?.wants === 'path');
  check('it opens where the file already lives', request?.path?.anchor === folder);
  check('and its committing control reads MOVE HERE', request?.commit === 'MOVE HERE');

  section('the answer is what happens next');
  check('the move reported success', moved.status === 'ok');
  check('the file is at the new name', await listing_holds(folder, 'renamed.txt'));
  check('and not at the old one', !(await listing_holds(folder, 'one.txt')));

  section('abandoning moves nothing');
  const abandoned: Asked = surface_script(null);
  const gave: CommandEnvelope = await command_dispatchEnvelope('mv', [`${folder}/renamed.txt`]);
  check('the question was put', abandoned.request !== null);
  check('the command said what it did not do',
    (gave.renderedErr ?? '').includes('nothing moved'));
  check('and the file is still where it was', await listing_holds(folder, 'renamed.txt'));

  section('rm -i asks, and no leaves the file');
  const refused: { asked: number; last: PromptRequest | null } = surface_count('n');
  await command_dispatchEnvelope('rm', ['-i', `${folder}/renamed.txt`]);
  check('the removal asked first', refused.asked === 1);
  check('and answering no left the file', await listing_holds(folder, 'renamed.txt'));

  section('a bulk removal is one command that asks once');
  await command_dispatchEnvelope('touch', [`${folder}/a.txt`]);
  await command_dispatchEnvelope('touch', [`${folder}/b.txt`]);
  const once: { asked: number; last: PromptRequest | null } = surface_count('y');
  const bulk: CommandEnvelope = await command_dispatchEnvelope('rm', [
    '-I', `${folder}/renamed.txt`, `${folder}/a.txt`, `${folder}/b.txt`,
  ]);
  check('three removals asked ONE question', once.asked === 1);
  check('and the question named how many', (once.last?.message ?? '').includes('3 items'));
  check('the command reported removing them', bulk.status === 'ok');
  check('and the folder no longer holds any of them',
    !(await listing_holds(folder, 'a.txt')) && !(await listing_holds(folder, 'b.txt')));

  section('a bulk move is one command that asks for a directory');
  await command_dispatchEnvelope('touch', [`${folder}/x.txt`]);
  await command_dispatchEnvelope('touch', [`${folder}/y.txt`]);
  const bulkAsk: Asked = surface_script(target);
  const landed: CommandEnvelope = await command_dispatchEnvelope('mv', [
    '-t', `${folder}/x.txt`, `${folder}/y.txt`,
  ]);
  check('the move asked where', bulkAsk.request !== null);
  check('and wanted a directory, since several things go to one place',
    bulkAsk.request?.path?.wantsDirectory === true);
  check('the move reported success', landed.status === 'ok');
  check('both files are in the answered directory',
    (await listing_holds(target, 'x.txt')) && (await listing_holds(target, 'y.txt')));
  check('and neither is where it was',
    !(await listing_holds(folder, 'x.txt')) && !(await listing_holds(folder, 'y.txt')));

  section('a write onto an occupied path is refused by name');
  await command_dispatchEnvelope('touch', [`${folder}/keep.txt`]);
  await command_dispatchEnvelope('touch', [`${folder}/other.txt`]);
  const onto: CommandEnvelope = await command_dispatchEnvelope('mv', [
    `${folder}/other.txt`, `${folder}/keep.txt`,
  ]);
  check('the move was refused', onto.status !== 'ok');
  check('and said why, by name',
    (onto.renderedErr ?? '').includes('Destination exists'));
  check('both files are still there',
    (await listing_holds(folder, 'keep.txt')) && (await listing_holds(folder, 'other.txt')));
  // The listing still answering IS the property: a write onto an occupied
  // path used to leave a row that made every later listing of this folder
  // fail, which is invisible until the next person opens it.
  const survived: CommandEnvelope = await command_dispatchEnvelope('ls', [folder]);
  check('and the folder still lists, which is what the refusal protects',
    survived.status === 'ok' && survived.rendered.includes('keep.txt'));

  section('cleanup');
  await cleanup.run();

  summary_exit();
}

void main();
