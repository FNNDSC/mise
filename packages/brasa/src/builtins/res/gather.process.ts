/**
 * @file `gather process`: one run over the whole cohort.
 *
 * A cohort is processed as a group: one feed whose `pl-dircopy` root holds
 * every member's landed folder, and the named plugin or pipeline runs once
 * off that root, reading the group from it. There is no loop: the iteration
 * is in the data the plugin reads. This is the shape ARGUS's PROCESS builds
 * from a press (#597), so a manifest and a press make the same feed.
 *
 * When the cohort already has a feed (`gather feed`, which ARGUS's CREATE
 * FEED sends, noted it on the cohort), the run goes off that feed's root and
 * nothing is copied twice; otherwise the feed is made here and noted on the
 * cohort for the next run. The name resolves as a bare line resolves it in
 * `/bin`. A series not pulled yet has no folder to copy, and the verb refuses
 * by name rather than processing part of the cohort.
 *
 * It answers what the bare run would: `run.scheduled` for a plugin,
 * `pipeline.scheduled` for a pipeline. Waiting, `--detach` and failure are
 * the bare run's.
 *
 * @module
 */
import chalk from 'chalk';
import { feed_create, type FeedCreationResult } from '@fnndsc/salsa';
import { envelope_error, type CommandEnvelope } from '@fnndsc/menu';
import { sink_dataLine } from '../../core/sink.js';
import { binExecutableMatches_get, type BinExecutableMatches } from '../../chris/binExecutables.js';
import { builtin_executePlugin } from '../pluginExecute.js';
import { builtin_pipeline } from './pipeline.js';
import { newFeed_cacheAdd, run_follow } from '../feedCreation.js';
import { cohort_read, cohort_write, cohortFolders_resolve, cohortModel_wrap, type GatherFeed, type GatherMember, type GatherState } from './gather.store.js';
import { ambient_publish } from '../../core/ambient.js';
import { exitCode_set } from '../../core/handlerRun.js';

/** How `gather process` was asked for. */
export interface GatherProcessArgs {
  /** The plugin or pipeline, as `/bin` names it. */
  name: string | null;
  /** The feed's title, when one is made. */
  title: string | null;
  /** Whether the line returns at once rather than waiting for the run. */
  detach: boolean;
  /** What follows `--`, handed to the run as its own arguments. */
  forwarded: string[];
  /** Why the words make no request, when they do not. */
  error: string | null;
}

/** The usage line a refusal points at. */
const USAGE: string = 'gather process <plugin|pipeline> [--title T] [--detach] [-- <its arguments>]';

/**
 * Reads the words after `gather process`.
 *
 * @param words - The words, raw.
 * @returns The request, or why it is not one.
 */
export function gatherProcessArgs_parse(words: ReadonlyArray<string>): GatherProcessArgs {
  const delimiter: number = words.indexOf('--');
  const own: ReadonlyArray<string> = delimiter === -1 ? words : words.slice(0, delimiter);
  const forwarded: string[] = delimiter === -1 ? [] : words.slice(delimiter + 1);
  const parsed: GatherProcessArgs = { name: null, title: null, detach: false, forwarded, error: null };
  for (let at: number = 0; at < own.length; at++) {
    const word: string = own[at] as string;
    if (word === '--detach') { parsed.detach = true; continue; }
    if (word === '--title') {
      const title: string | undefined = own[at + 1];
      if (title === undefined || title.startsWith('--') || title.trim() === '') { parsed.error ??= '--title needs a title'; continue; }
      parsed.title = title.trim();
      at++;
      continue;
    }
    if (word.startsWith('-')) { parsed.error ??= `${word}: unknown option; the run's own arguments go after --`; continue; }
    if (parsed.name !== null) { parsed.error ??= `one plugin or pipeline at a time; ${word} is a second (its arguments go after --)`; continue; }
    parsed.name = word;
  }
  if (parsed.name === null) parsed.error ??= `name the plugin or pipeline to run over the cohort. Usage: ${USAGE}`;
  return parsed;
}

/**
 * Refuses, saying why.
 *
 * @param message - What the operator needs to know.
 * @returns The error envelope.
 */
function process_refuse(message: string): CommandEnvelope {
  exitCode_set(1);
  return envelope_error('', undefined, `${chalk.red(`gather process: ${message}`)}\n`);
}

/**
 * Where a member is in CUBE: a pulled series' landed folder, a folder or
 * file's own path; null for a series not pulled yet.
 *
 * @param member - The member.
 * @returns Its CFS path, or null.
 */
function member_place(member: GatherMember): string | null {
  if (member.kind !== 'series') return member.vfsPath;
  const landed: unknown = member.folderPath;
  return typeof landed === 'string' && landed.length > 0 ? landed : null;
}

/**
 * What a member is called in a refusal.
 *
 * @param member - The member.
 * @returns Its description, or the last part of its address.
 */
function member_word(member: GatherMember): string {
  return member.description ?? member.vfsPath.split('/').filter(Boolean).pop() ?? member.vfsPath;
}

/**
 * The cohort's feed: the one noted on it, or one made now from every
 * member's place and noted on the cohort.
 *
 * @param state - The cohort.
 * @param places - Every member's CFS path.
 * @param title - The title for a feed made now.
 * @returns The feed and whether it was made now, or a refusal.
 */
async function cohortFeed_ensure(state: GatherState, places: string[], title: string): Promise<{ feed: GatherFeed; made: boolean } | string> {
  if (state.feed !== null) return { feed: state.feed, made: false };
  const feed: FeedCreationResult | null = await feed_create(places, { title });
  const feedId: number = Number(feed?.id);
  const rootInstanceId: number = Number(feed?.pluginInstance?.data?.id);
  const owner: string = typeof feed?.owner_username === 'string' ? feed.owner_username.trim() : '';
  if (!Number.isInteger(feedId) || feedId <= 0 || !Number.isInteger(rootInstanceId) || rootInstanceId <= 0 || owner === '') {
    return `could not make the cohort's feed '${title}'`;
  }
  newFeed_cacheAdd({ feedID: feedId, title, ownerUsername: owner, rootInstanceID: rootInstanceId });
  run_follow(feedId);
  const made: GatherFeed = { feedId, rootInstanceId, path: `/home/${owner}/feeds/feed_${feedId}/pl-dircopy_${rootInstanceId}/data` };
  await cohort_write({ ...state, feed: made });
  sink_dataLine(chalk.green(`Feed created: ${feedId} (${places.length} member${places.length === 1 ? '' : 's'} in its root, ${rootInstanceId})`));
  return { feed: made, made: true };
}

/**
 * `gather feed [--title T]`: the cohort's feed, made now when it has none.
 *
 * The feed is rooted on every member's place, so a series still at the
 * PACS is pulled first (one `pull` over all of them); a folder or a file is
 * already in CUBE and goes into the root as it is. The feed is noted on the
 * cohort, which is what a later `gather process` runs off and what a
 * surface reads it from.
 *
 * @param words - The words after `gather feed`, raw.
 * @returns The cohort with its feed, and whether the feed was made now; or a refusal.
 */
export async function cohortFeed_make(words: ReadonlyArray<string>): Promise<{ state: GatherState; made: boolean } | string> {
  let title: string | null = null;
  for (let at: number = 0; at < words.length; at++) {
    const word: string = words[at] as string;
    if (word === '--title') {
      const given: string | undefined = words[at + 1];
      if (given === undefined || given.startsWith('--') || given.trim() === '') return '--title needs a title';
      title = given.trim();
      at++;
      continue;
    }
    return `${word}: not understood. Usage: gather feed [--title T]`;
  }

  let state: GatherState = await cohortFolders_resolve(await cohort_read());
  if (state.series.length === 0) return 'the cohort is empty; gather add something first';
  if (state.feed !== null) return { state, made: false };

  const away: GatherMember[] = state.series.filter((member: GatherMember): boolean => member_place(member) === null);
  if (away.length > 0) {
    // Loaded on demand: only a cohort with series still at the PACS pulls.
    const { builtin_pull } = await import('../fs/pull.js');
    await builtin_pull(away.map((member: GatherMember): string => member.vfsPath));
    state = await cohortFolders_resolve(await cohort_read());
    const waiting: GatherMember[] = state.series.filter((member: GatherMember): boolean => member_place(member) === null);
    if (waiting.length > 0) {
      const named: string = waiting.slice(0, 5).map(member_word).join(', ') + (waiting.length > 5 ? `, and ${waiting.length - 5} more` : '');
      return `${waiting.length} series did not land (${named}); no feed was made`;
    }
  }

  const places: string[] = state.series.map((member: GatherMember): string => member_place(member) as string);
  const ensured: { feed: GatherFeed; made: boolean } | string = await cohortFeed_ensure(state, places, title ?? state.name ?? 'cohort');
  if (typeof ensured === 'string') return ensured;
  return { state: { ...state, feed: ensured.feed }, made: ensured.made };
}

/**
 * `gather process <name> [--title T] [--detach] [-- args]`: runs a plugin or
 * a pipeline once over the whole cohort.
 *
 * @param words - The words after `gather process`, raw.
 * @returns The run's envelope, or a refusal.
 */
export async function gather_process(words: ReadonlyArray<string>): Promise<CommandEnvelope> {
  const parsed: GatherProcessArgs = gatherProcessArgs_parse(words);
  if (parsed.error !== null || parsed.name === null) return process_refuse(parsed.error ?? USAGE);
  const name: string = parsed.name;

  // A series pulled but not yet noted on the cohort is found in CUBE, not
  // refused as never pulled.
  const state: GatherState = await cohortFolders_resolve(await cohort_read());
  if (state.series.length === 0) return process_refuse('the cohort is empty; gather add something first');
  const waiting: GatherMember[] = state.series.filter((member: GatherMember): boolean => member_place(member) === null);
  if (waiting.length > 0) {
    const named: string = waiting.slice(0, 5).map(member_word).join(', ') + (waiting.length > 5 ? `, and ${waiting.length - 5} more` : '');
    return process_refuse(`${waiting.length} series ${waiting.length === 1 ? 'is' : 'are'} not pulled yet (${named}); pull \${gather} first`);
  }

  const matches: BinExecutableMatches = await binExecutableMatches_get(name);
  if (matches.plugin !== undefined && matches.pipeline !== undefined) {
    return process_refuse(`${name} names both a plugin and a pipeline in /bin; it cannot tell which to run`);
  }
  if (matches.plugin === undefined && matches.pipeline === undefined) {
    return process_refuse(`no plugin or pipeline named ${name} in /bin`);
  }

  const places: string[] = state.series.map((member: GatherMember): string => member_place(member) as string);
  const title: string = parsed.title ?? state.name ?? 'cohort';
  const ensured: { feed: GatherFeed; made: boolean } | string = await cohortFeed_ensure(state, places, title);
  if (typeof ensured === 'string') return process_refuse(ensured);
  const { feed, made } = ensured;
  // The cohort now has its folders and its feed. It goes out on the session
  // bus, not as this line's answer: `R=$(gather process …)` holds the line's
  // last model, which is the run's, as a bare run's would be (#1252).
  ambient_publish({ kind: 'envelope', envelope: { status: 'ok', rendered: '', model: cohortModel_wrap({ ...state, feed }) } });

  const detach: string[] = parsed.detach ? ['--detach'] : [];
  const envelope: CommandEnvelope = matches.pipeline !== undefined
    // By its /bin name, which names the id: a pipeline found by its CUBE
    // name runs as exactly that one.
    ? await builtin_pipeline(['run', matches.pipeline.name, '--previous', String(feed.rootInstanceId), ...detach, ...parsed.forwarded])
    : await builtin_executePlugin(name, [...detach, ...parsed.forwarded], feed.path);
  // The run went off a root, so it reads as continuing a feed; when that
  // feed was made by this line, the answer says so, as a bare run's would.
  if (made && envelope.model !== undefined && typeof envelope.model.data === 'object' && envelope.model.data !== null) {
    return { ...envelope, model: { ...envelope.model, data: { ...envelope.model.data, newFeed: true } } };
  }
  return envelope;
}
