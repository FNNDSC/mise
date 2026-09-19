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
 * . *Session pronouns*, a closed RESERVED set — the cohort, the feed, the
 *   run, the query, the place the session stands.
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
import { recentFeed_get, recentQuery_get, recentRunPlace_get, recentRuns_get } from '../session/recent.js';

/** The names the session answers for; a manifest may not take them. */
export const RESERVED_REFERENCES: ReadonlySet<string> = new Set([
  'gather', 'feed', 'run', 'query', 'cwd',
]);

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
  return RESERVED_REFERENCES.has(name.split('.')[0]);
}

/**
 * What the cohort answers, for the pronoun that names part of it.
 *
 * @param name - The reference, such as `gather`, `gather.first.place`.
 * @returns The values, or null when the cohort cannot answer.
 */
async function cohort_reference(name: string): Promise<ReferenceValue> {
  // Loaded on demand: the resolver sits under dispatch, and the cohort sits
  // above it in a builtin.
  const { cohort_read } = await import('../builtins/res/gather.store.js');
  const state = await cohort_read();
  const members = state.series;

  // A member has two addresses and the difference is load-bearing: where it
  // was gathered FROM, which `pull` takes, and where it LANDED, which a
  // viewer and a run take.
  const wantsPlace: boolean = name.endsWith('.place');
  const stem: string = wantsPlace ? name.slice(0, -'.place'.length) : name;
  const addressOf = (member: { vfsPath: string; kind?: string; folderPath?: unknown }): string | null => {
    if (!wantsPlace) return member.vfsPath;
    const landed: unknown = member.folderPath;
    if (typeof landed === 'string' && landed.length > 0) return landed;
    return member.kind === 'series' ? null : member.vfsPath;
  };

  if (stem === 'gather') {
    const addresses: Array<string | null> = members.map(addressOf);
    if (addresses.some((address: string | null): boolean => address === null)) return null;
    return { values: addresses as string[] };
  }

  const which: string = stem.slice('gather.'.length);
  if (which === 'size') return { values: [`${members.length}`] };
  if (which === 'name') return { values: [state.name ?? ''] };

  const pick = (member: typeof members[number] | undefined): ReferenceValue => {
    if (member === undefined) return null;
    const address: string | null = addressOf(member);
    return address === null ? null : { values: [address] };
  };
  if (which === 'first') return pick(members[0]);
  if (which === 'last') return pick(members[members.length - 1]);
  const nth: number = Number(which);
  if (Number.isInteger(nth) && nth >= 1 && nth <= members.length) return pick(members[nth - 1]);
  return null;
}

/**
 * Answers a reference: the session, then the manifest, then the environment.
 *
 * @param name - The reference's name.
 * @returns What it refers to, or null when nothing does.
 */
export async function reference_resolve(name: string): Promise<ReferenceValue> {
  if (name === 'cwd') return { values: [await session.getCWD()] };

  if (name === 'feed') {
    const feed: number | null = recentFeed_get();
    return feed === null ? null : { values: [`${feed}`] };
  }

  if (name === 'run') {
    const runs: number[] = recentRuns_get();
    return runs.length === 0 ? null : { values: [`${runs[runs.length - 1]}`] };
  }

  if (name === 'run.place') {
    const place: string | null = recentRunPlace_get();
    return place === null ? null : { values: [place] };
  }

  if (name === 'query') {
    const query: string | null = recentQuery_get();
    return query === null ? null : { values: [query] };
  }

  if (name === 'gather' || name.startsWith('gather.')) return await cohort_reference(name);

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
  const hint: string = reference_isReserved(name)
    ? ` — nothing in this session has one yet`
    : '';
  return `\${${name}}: nothing to put there${hint}. Looked in ${places}.`;
}
