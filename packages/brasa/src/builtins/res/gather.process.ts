/**
 * @file `gather process`: one run over the whole cohort.
 *
 * A cohort is processed as a group: one feed whose `pl-dircopy` root holds
 * every member's landed folder, and the named plugin or pipeline runs once
 * off that root, reading the group from it. There is no loop: the iteration
 * is in the data the plugin reads. This is the shape ARGUS's PROCESS builds
 * from a press (#597), so a manifest and a press make the same feed.
 *
 * When the cohort already has a feed (a `pull --new-feed`, or ARGUS's
 * CREATE FEED, noted it on the cohort), the run goes off that feed's root and
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
import { cohort_read, cohort_write, type GatherFeed, type GatherMember, type GatherState } from './gather.store.js';

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
  process.exitCode = 1;
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

  const state: GatherState = await cohort_read();
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

  const detach: string[] = parsed.detach ? ['--detach'] : [];
  const envelope: CommandEnvelope = matches.pipeline !== undefined
    ? await builtin_pipeline(['run', name, '--previous', String(feed.rootInstanceId), ...detach, ...parsed.forwarded])
    : await builtin_executePlugin(name, [...detach, ...parsed.forwarded], feed.path);
  // The run went off a root, so it reads as continuing a feed; when that
  // feed was made by this line, the answer says so, as a bare run's would.
  if (made && envelope.model !== undefined && typeof envelope.model.data === 'object' && envelope.model.data !== null) {
    return { ...envelope, model: { ...envelope.model, data: { ...envelope.model.data, newFeed: true } } };
  }
  return envelope;
}
