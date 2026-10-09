/**
 * @file What the ChRIS backend answers in `${name}`, and the kinds of row its
 * listings number.
 *
 * `${feed}`, `${run}` (and `${run.place}`) and `${query}` are what the session
 * most recently made or asked; `${gather}` and the names under it are the
 * cohort. Its listings number patients, studies and series beside the core's
 * files and folders, and its verbs say which kinds they take.
 *
 * @module
 */
import type { ReferenceValue } from '../lib/parser.js';
import type { AnswerKindLook, ReferenceSource, VerbTakes } from '../core/backend.js';
import { recentFeed_get, recentQuery_get, recentRunPlace_get, recentRuns_get } from '../session/recent.js';

/**
 * What the cohort answers, for the pronoun that names part of it.
 *
 * @param name - The reference, such as `gather`, `gather.first.place`.
 * @returns The values, or null when the cohort cannot answer.
 */
async function cohort_reference(name: string): Promise<ReferenceValue> {
  // Loaded on demand: the cohort's store is a builtin's, and reading it is
  // only worth doing when a line names the cohort.
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

/** The references the ChRIS session answers. */
export const chrisReferences: ReadonlyArray<ReferenceSource> = [
  {
    name: 'feed',
    resolve: async (name: string): Promise<ReferenceValue | undefined> => {
      if (name !== 'feed') return undefined;
      const feed: number | null = recentFeed_get();
      return feed === null ? null : { values: [`${feed}`] };
    },
  },
  {
    name: 'run',
    resolve: async (name: string): Promise<ReferenceValue | undefined> => {
      if (name === 'run') {
        const runs: number[] = recentRuns_get();
        return runs.length === 0 ? null : { values: [`${runs[runs.length - 1]}`] };
      }
      if (name === 'run.place') {
        const place: string | null = recentRunPlace_get();
        return place === null ? null : { values: [place] };
      }
      return undefined;
    },
  },
  {
    name: 'query',
    resolve: async (name: string): Promise<ReferenceValue | undefined> => {
      if (name !== 'query') return undefined;
      const query: string | null = recentQuery_get();
      return query === null ? null : { values: [query] };
    },
  },
  {
    name: 'gather',
    resolve: async (name: string): Promise<ReferenceValue | undefined> => await cohort_reference(name),
  },
];

/**
 * The kinds the ChRIS listings number beside the core's. Series and studies
 * lead the refusal that teaches the syntax, as they are what a PACS answer
 * numbers most; a patient is named there by neither.
 */
export const chrisAnswerKinds: ReadonlyArray<AnswerKindLook> = [
  { code: 'SER', word: 'a series', example: '@SER3' },
  { code: 'STD', word: 'a study', example: '@STD1' },
  { code: 'PAT', word: 'a patient' },
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
