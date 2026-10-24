/**
 * @file What the ChRIS backend answers in `${name}`, and the kinds of row its
 * listings number.
 *
 * `${gather}` is the cohort, read live: the one name the backend keeps for
 * itself. What a line made is named by the line (`A=$(…)`), never by a
 * pronoun the session fills behind it. Its listings number patients,
 * studies and series beside the core's files and folders, and its verbs say
 * which kinds they take.
 *
 * @module
 */
import type { ReferenceValue } from '../lib/parser.js';
import type { AnswerKindLook, ReferenceSource, VerbTakes } from '../core/backend.js';
import type { SessionAnswer } from '../session/answer.js';
import { fieldReading_value } from '../core/expansion.js';
import { answer_read } from '../core/variables.js';
import { GATHER_MODEL_KIND } from '../builtins/res/gather.kind.js';

/**
 * What the cohort answers: `${gather}` is a live `$(gather)`, re-read on
 * every use, and read by the same rule as any variable. Bare, it is every
 * member's address (where it was gathered FROM, which `pull` takes); a dot
 * is a field of the cohort as `gather` answers it, so
 * `${gather.series.folderPath}` is where each member LANDED, which a viewer
 * and a run take. Live, because the cohort is a working set a flow is still
 * building: a capture taken before `pull` would hold no landed folders.
 *
 * @param name - The reference, such as `gather`, `gather.series.folderPath`.
 * @returns The values, or null with the reason recorded.
 */
async function cohort_reference(name: string): Promise<ReferenceValue> {
  // Loaded on demand: the cohort's store is a builtin's, and reading it is
  // only worth doing when a line names the cohort.
  const { cohort_read } = await import('../builtins/res/gather.store.js');
  const state: unknown = await cohort_read();
  const answer: SessionAnswer = { source: 'gather', kind: GATHER_MODEL_KIND, rows: [], data: state };
  return fieldReading_value(answer_read(answer, 'gather', name.split('.').slice(1)));
}

/** The references the ChRIS session answers. */
export const chrisReferences: ReadonlyArray<ReferenceSource> = [
  {
    name: 'gather',
    resolve: async (name: string): Promise<ReferenceValue | undefined> => await cohort_reference(name),
    // `pull` notes where members landed; `gather` is the cohort's own verb.
    changedBy: ['gather', 'pull'],
  },
];

/**
 * The kinds the ChRIS listings number beside the core's. Series and studies
 * lead the refusal that teaches the syntax, as they are what a PACS answer
 * numbers most; a patient is named there by neither.
 */
export const chrisAnswerKinds: ReadonlyArray<AnswerKindLook> = [
  { code: 'SER', word: 'a series', example: '@SER3' },
  { code: 'STD', word: 'a study', example: '@STD1', group: true },
  { code: 'PAT', word: 'a patient', group: true },
];

/**
 * What each ChRIS verb takes by index, and what it adds to `cd`. A verb
 * handed the wrong kind refuses by name at expansion.
 */
export const chrisVerbTakes: ReadonlyArray<VerbTakes> = [
  { verb: 'image', kinds: ['SER', 'DIR', 'FIL'] },
  { verb: 'dcm', kinds: ['SER', 'DIR', 'FIL'] },
  { verb: 'pull', kinds: ['SER', 'STD', 'PAT'] },
  { verb: 'cd', kinds: ['SER', 'STD'] },
  { verb: 'download', kinds: ['FIL'] },
];
