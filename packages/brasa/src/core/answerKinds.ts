/**
 * @file The kinds of row an index can name, and the kinds each verb takes.
 *
 * The core numbers files and folders; a backend adds the kinds its own
 * listings carry (ChRIS: patients, studies, series) and says which of them its
 * verbs take. Both are read when an index is resolved, so they follow the
 * installed backend.
 *
 * @module
 */
import { backendInstalled_get, type AnswerKindLook, type Backend } from './backend.js';

/** The kinds the core numbers. */
const CORE_KINDS: ReadonlyArray<AnswerKindLook> = [
  { code: 'FIL', word: 'a file', example: '@FIL2' },
  { code: 'DIR', word: 'a folder', example: '@DIR4' },
];

/** What the core's own verbs take by index. */
const CORE_TAKES: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ['cat', ['FIL']],
  ['cd', ['DIR']],
]);

/**
 * Every kind an index may name: the backend's first, then the core's.
 *
 * @returns The kinds, in that order.
 */
export function answerKinds_get(): ReadonlyArray<AnswerKindLook> {
  const backend: Backend | null = backendInstalled_get();
  return [...(backend?.answerKinds ?? []), ...CORE_KINDS];
}

/**
 * One kind, by its code.
 *
 * @param code - The three letters.
 * @returns The kind, or undefined when nothing numbers it.
 */
export function answerKind_find(code: string): AnswerKindLook | undefined {
  return answerKinds_get().find((kind: AnswerKindLook): boolean => kind.code === code);
}

/**
 * What a verb can be handed by index: the core's kinds for it, then the
 * backend's.
 *
 * @param verb - The command word.
 * @returns The kinds, or undefined when the verb takes any kind.
 */
export function verbTakes_get(verb: string): ReadonlyArray<string> | undefined {
  const added: string[] = (backendInstalled_get()?.verbTakes ?? [])
    .filter((entry): boolean => entry.verb === verb)
    .flatMap((entry): ReadonlyArray<string> => entry.kinds);
  const core: ReadonlyArray<string> | undefined = CORE_TAKES.get(verb);
  if (core === undefined && added.length === 0) return undefined;
  return [...(core ?? []), ...added];
}
