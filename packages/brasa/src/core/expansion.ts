/**
 * @file What a `${reference}` refers to, for every line the session runs.
 *
 * There was more than one answer to this. The dispatcher substituted the
 * environment after tokenizing (so a single-quoted `$HOME` expanded anyway),
 * and `play` substituted parameters and session pronouns before tokenizing
 * (so a gathered path with a space had to be quoted by hand). Two expanders
 * over one syntax is two sources of truth, and they composed by accident
 * rather than by design.
 *
 * One resolver now answers for all of them, in a fixed order:
 *
 * . *Session pronouns*: the place the session stands (`cwd`), and those
 *   the backend answers (ChRIS: the cohort, the feed, the run, the query).
 * . *Parameters* of the manifest being played, if one is.
 * . *The environment*.
 *
 * A name nothing answers refuses the LINE rather than expanding to nothing
 * or standing as text: `rm -rf ${DIR}/scratch` with `DIR` unset is how a
 * script deletes the wrong thing, and this stack does not do silent
 * workarounds.
 *
 * @module
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ReferenceValue } from '../lib/parser.js';
import { session } from '../session/index.js';
import { answer_get, answerKind_count, answerRow_get, type AnswerHandle, type AnswerKind, type AnswerRow } from '../session/answer.js';
import { backendInstalled_get, type AnswerKindLook, type ReferenceSource } from './backend.js';
import { answerKind_find, answerKinds_get, verbTakes_get } from './answerKinds.js';

/** The name the core answers for itself: where the session stands. */
const CORE_REFERENCE: string = 'cwd';

/**
 * The references the backend answers.
 *
 * @returns Its sources, or none before a backend is installed.
 */
function referenceSources_get(): ReadonlyArray<ReferenceSource> {
  return backendInstalled_get()?.references ?? [];
}

/** Whether an unanswerable reference may stand as written: what a dry run does. */
const standsScope: AsyncLocalStorage<boolean> = new AsyncLocalStorage<boolean>();

/** Parameters of the manifest being played, if one is. */
const paramScope: AsyncLocalStorage<Map<string, string>> = new AsyncLocalStorage<Map<string, string>>();

/**
 * Runs work with a manifest's parameters in scope.
 *
 * @param params - The parameters, already checked for completeness.
 * @param operation - The work to run.
 * @returns The operation's result.
 */
export async function paramScope_run<T>(params: Map<string, string>, operation: () => Promise<T>): Promise<T> {
  return await paramScope.run(params, operation);
}

/**
 * Runs work in which an unanswerable reference stands as written.
 *
 * A dry run has run nothing, so a reference to what an earlier line WOULD
 * have produced cannot be answered — and refusing there would make a dry run
 * useless for exactly the manifests that chain, which is most of them.
 *
 * @param operation - The work to run.
 * @returns The operation's result.
 */
export async function unresolvedStands_run<T>(operation: () => Promise<T>): Promise<T> {
  return await standsScope.run(true, operation);
}

/**
 * Whether the work on this async path lets a reference stand unanswered.
 *
 * @returns True inside a dry run.
 */
export function unresolvedStands_get(): boolean {
  return standsScope.getStore() === true;
}

/**
 * Whether a name is one the session answers for.
 *
 * @param name - The reference's name, dots and all.
 * @returns True when the session owns it.
 */
export function reference_isReserved(name: string): boolean {
  const stem: string = name.split('.')[0];
  return stem === CORE_REFERENCE || referenceSources_get().some((source: ReferenceSource): boolean => source.name === stem);
}

/**
 * Reads what an index names: `@SER3`, `@STD001`, `@FIL2,3,7`, `@DIR2-4`.
 *
 * The kind is written once and the ordinals follow; zero padding is how
 * the pill draws it, not something the operator must type. A range written
 * backwards is still a range: the operator meant those rows.
 *
 * @param spec - The index without its sigil.
 * @returns The handles, in the order written, or null when the spec is not
 *   an index.
 */
export function indices_parse(spec: string): AnswerHandle[] | null {
  const match: RegExpMatchArray | null = spec.match(/^([A-Z]{3})(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/);
  if (match === null) return null;
  const kind: string = match[1];
  if (answerKind_find(kind) === undefined) return null;
  const handles: AnswerHandle[] = [];
  for (const part of match[2].split(',')) {
    const range: RegExpMatchArray | null = part.match(/^(\d+)-(\d+)$/);
    if (range === null) { handles.push({ kind: kind as AnswerKind, ordinal: Number(part) }); continue; }
    const from: number = Number(range[1]);
    const to: number = Number(range[2]);
    const step: number = from <= to ? 1 : -1;
    for (let at: number = from; step > 0 ? at <= to : at >= to; at += step) {
      handles.push({ kind: kind as AnswerKind, ordinal: at });
    }
  }
  return handles;
}

/**
 * The kind a refusal names, in words.
 *
 * @param kind - A kind's code; only registered kinds are ever parsed.
 * @returns The kind in words.
 */
function kind_word(kind: AnswerKind): string {
  return answerKind_find(kind)?.word ?? kind;
}

/** The verb the line began with, set by the dispatcher before expansion. */
let verbInHand: string | null = null;

/**
 * Tells the resolver which verb the line is for, so an index can be
 * refused by kind.
 *
 * @param verb - The command word, or null between lines.
 */
export function verbInHand_set(verb: string | null): void {
  verbInHand = verb;
}

/** Why the last index was refused, when it was refused by kind. */
let kindRefusal: string | null = null;

/**
 * What the rows an index names are worth, as operands.
 *
 * @param name - The index, sigil included.
 * @returns The rows' values, or null when nothing is numbered, a number is
 *   past the end of its kind, or the verb in hand does not take the kind.
 */
function index_resolve(name: string): ReferenceValue {
  kindRefusal = null;
  const handles: AnswerHandle[] | null = indices_parse(name.slice(1));
  if (handles === null || handles.length === 0) return null;

  // A verb that is given the wrong kind refuses BY NAME at expansion —
  // "IMAGE takes a series or a folder; STD001 is a study" — rather than
  // resolving to a path and failing three steps later for a reason that
  // names nothing the operator typed. A verb not declared takes any kind.
  const takes: ReadonlyArray<AnswerKind> | undefined = verbInHand === null ? undefined : verbTakes_get(verbInHand);
  const values: string[] = [];
  for (const handle of handles) {
    if (takes !== undefined && !takes.includes(handle.kind)) {
      kindRefusal = `${verbInHand} takes ${takes.map(kind_word).join(' or ')}; `
        + `${handle.kind}${`${handle.ordinal}`.padStart(3, '0')} is ${kind_word(handle.kind)}.`;
      return null;
    }
    const row: AnswerRow | null = answerRow_get(handle);
    if (row === null) return null;
    values.push(...row.values);
  }
  return { values };
}

/**
 * Answers a reference: an index, then the session, then the manifest, then
 * the environment.
 *
 * @param name - The reference's name.
 * @returns What it refers to, or null when nothing does.
 */
export async function reference_resolve(name: string): Promise<ReferenceValue> {
  if (name.startsWith('@')) return index_resolve(name);

  if (name === CORE_REFERENCE) return { values: [await session.getCWD()] };

  const stem: string = name.split('.')[0];
  for (const source of referenceSources_get()) {
    if (source.name !== stem) continue;
    const answered: ReferenceValue | undefined = await source.resolve(name);
    if (answered !== undefined) return answered;
  }

  const params: Map<string, string> | undefined = paramScope.getStore();
  const given: string | undefined = params?.get(name);
  if (given !== undefined) return { values: [given] };

  const environment: string | undefined = process.env[name];
  return environment === undefined ? null : { values: [environment] };
}

/**
 * Says where a reference was looked for, for a refusal an operator can act on.
 *
 * @param name - The reference nothing answered.
 * @returns The refusal's text.
 */
export function reference_refusal(name: string): string {
  const scoped: boolean = paramScope.getStore() !== undefined;
  const places: string = scoped ? "the session, this manifest's parameters, the environment" : 'the session, the environment';
  if (name.startsWith('@')) {
    if (kindRefusal !== null) return `${name}: ${kindRefusal}`;
    const numbered = answer_get();
    if (numbered === null) return `${name}: nothing is numbered yet — list something first.`;
    const handles: AnswerHandle[] | null = indices_parse(name.slice(1));
    if (handles === null) {
      const shown: AnswerKindLook[] = answerKinds_get().filter((kind: AnswerKindLook): boolean => kind.example !== undefined);
      const lead: string = shown[0]?.code ?? 'FIL';
      return `${name}: an index says what it counts — ${shown.map((kind: AnswerKindLook): string => kind.example ?? '').join(', ')} — and may list or range them (@${lead}2,3 or @${lead}2-5).`;
    }
    const kind: AnswerKind = handles[0].kind;
    const count: number = answerKind_count(kind);
    return count === 0
      ? `${name}: the last answer (${numbered.source}) holds no ${kind_word(kind)} rows.`
      : `${name}: the last answer (${numbered.source}) holds ${count} ${kind} row${count === 1 ? '' : 's'}.`;
  }
  const hint: string = reference_isReserved(name)
    ? ` — nothing in this session has one yet`
    : '';
  return `\${${name}}: nothing to put there${hint}. Looked in ${places}.`;
}
