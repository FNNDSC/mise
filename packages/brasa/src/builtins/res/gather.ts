/**
 * @file Builtin gather command: the session's cohort as a kernel subject.
 *
 * Subcommands: list (the default), add, remove, clear, name, feed, process.
 *
 * Gathering was a surface gesture before it was a verb, which meant the set
 * a session was working on could only be built by pressing on it. As a
 * subject it is scriptable: a line adds to it, a manifest builds one, and
 * the surface becomes one client of the cohort rather than the only place
 * it exists.
 *
 * @module
 */
import { listingIn_take, listingOperands_of, type ListingModel } from '../../core/listing.js';
import { answerNumbering_of, handleWords_of, numberedFooter_of, type NumberedHandle } from '../../session/answer.js';
import chalk from 'chalk';
import path from 'path';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { commandArgs_process, ParsedArgs, path_resolve } from '../utils.js';
import {
  GatherKind,
  GatherMember,
  GatherState,
  cohort_read,
  cohort_write,
  cohortModel_of,
  member_key,
  members_drop,
  members_merge,
  pathKind_determine,
  seriesUID_ofPath,
} from './gather.store.js';
import { placeImagery_is, seriesFacts_fill } from './gather.facts.js';
import { CommandEnvelope, envelope_ok, envelope_error, type EnvelopeModel } from '@fnndsc/menu';

import { GATHER_MODEL_KIND } from './gather.kind.js';
export { GATHER_MODEL_KIND };

/**
 * Renders a refusal.
 *
 * @param message - What the operator needs to know.
 * @returns An error envelope, with the process marked failed.
 */
function gather_error(message: string): CommandEnvelope {
  process.exitCode = 1;
  return envelope_error('', undefined, `${chalk.red(message)}\n`);
}

/**
 * What to call a member in a listing.
 *
 * @param member - The member to name.
 * @returns Its description, else the leaf of its path.
 */
function member_label(member: GatherMember): string {
  const described: unknown = member.description;
  if (typeof described === 'string' && described.trim().length > 0) return described;
  return path.posix.basename(member.vfsPath);
}

/**
 * Where a member IS: home in CUBE, or still at the source.
 *
 * A series is home once CUBE has said where it landed; a place gathered
 * from the filesystem was never anywhere else.
 *
 * @param member - The member to place.
 * @returns A one-word state for the listing.
 */
function member_state(member: GatherMember): string {
  if (member.kind !== 'series') return 'in CUBE';
  const landed: unknown = member.folderPath;
  return typeof landed === 'string' && landed.length > 0 ? 'in CUBE' : 'at PACS';
}

/**
 * Renders the cohort as a table, with its name and counts.
 *
 * @param state - The cohort to show.
 * @returns A success envelope carrying the rendered table and the model.
 */
function cohort_render(state: GatherState): CommandEnvelope {
  const model: EnvelopeModel = cohortModel_of(state);
  if (state.series.length === 0) {
    return envelope_ok(`${chalk.gray('The cohort is empty. Gather something with `gather add <path>`.')}\n`, model);
  }

  // Each member wears the handle an index expands to (#1099): one sequence
  // per kind, as the cohort's numbering counts them.
  const numbered: NumberedHandle[] = answerNumbering_of(GATHER_MODEL_KIND, state) ?? [];
  const words: Map<string, string> = handleWords_of(numbered);
  const kindCode = (member: GatherMember): string => (member.kind === 'dir' ? 'DIR' : member.kind === 'file' ? 'FIL' : 'SER');
  const rows: Record<string, unknown>[] = state.series.map(
    (member: GatherMember): Record<string, unknown> => ({
      '@': words.get(`${kindCode(member)}:${member.vfsPath}`) ?? '',
      kind: member.kind,
      member: member_label(member),
      state: member_state(member),
      path: member.vfsPath,
    }),
  );
  const seriesCount: number = state.series.filter(
    (member: GatherMember): boolean => member.kind === 'series',
  ).length;
  const placeCount: number = state.series.length - seriesCount;
  const parts: string[] = [];
  if (seriesCount > 0) parts.push(`${seriesCount} ${seriesCount === 1 ? 'series' : 'series'}`);
  if (placeCount > 0) parts.push(`${placeCount} ${placeCount === 1 ? 'place' : 'places'}`);
  const title: string = state.name === null ? 'Cohort' : `Cohort · ${state.name}`;

  return envelope_ok(
    `${table_render(rows, ['@', 'kind', 'member', 'state', 'path'], {
      title: { title, justification: 'center' },
    })}${chalk.gray(parts.join(' · '))}\n${numbered.length > 0 ? `${chalk.gray(numberedFooter_of(numbered))}\n` : ''}`,
    model,
  );
}

/**
 * Takes paths into the cohort.
 *
 * Each operand is resolved against the session's cwd, so `gather add .` and
 * a relative series path mean what they say. What a path IS is asked of the
 * filesystem rather than guessed from its spelling.
 *
 * @param operands - Paths to gather.
 * @returns The cohort after the change.
 */
async function gather_add(operands: string[]): Promise<CommandEnvelope> {
  if (operands.length === 0) return gather_error('Usage: gather add <path> [path...]');

  const incoming: GatherMember[] = [];
  for (const operand of operands) {
    const resolved: string = await path_resolve(operand);
    const kind: GatherKind | null = await pathKind_determine(resolved);
    // A path that names nothing is refused by name, before anything is
    // taken: a cohort holding a typo is a cohort a run will be refused on.
    if (kind === null) return gather_error(`gather: ${resolved}: nothing is there.`);
    const member: GatherMember = { vfsPath: resolved, kind };
    if (member.kind === 'series') {
      const uid: string | undefined = seriesUID_ofPath(resolved);
      if (uid !== undefined) member.seriesUID = uid;
      member.imagery = true;
    } else if (placeImagery_is(member)) {
      member.imagery = true;
    }
    incoming.push(member);
  }
  await seriesFacts_fill(incoming);

  const state: GatherState = await cohort_read();
  const { members, added, merged } = members_merge(state.series, incoming);
  state.series = members;
  await cohort_write(state);

  const noted: string[] = [];
  if (added > 0) noted.push(`${added} gathered`);
  if (merged > 0) noted.push(`${merged} already in the cohort`);
  const envelope: CommandEnvelope = cohort_render(state);
  return envelope_ok(`${chalk.green(`gather: ${noted.join(', ')}.`)}\n${envelope.rendered}`, envelope.model);
}

/**
 * Drops members from the cohort, by path or by listing index.
 *
 * An index is how the operator reads the cohort back, so `gather remove 2`
 * removes the second row rather than refusing because 2 is not a path.
 *
 * @param operands - Paths or `#`-style indices to drop.
 * @returns The cohort after the change.
 */
async function gather_remove(operands: string[]): Promise<CommandEnvelope> {
  if (operands.length === 0) return gather_error('Usage: gather remove <path|index> [path|index...]');

  const state: GatherState = await cohort_read();
  if (state.series.length === 0) return gather_error('gather: the cohort is empty.');

  const keys: string[] = [];
  for (const operand of operands) {
    const asIndex: number = Number.parseInt(operand.replace(/^#/, ''), 10);
    if (!Number.isNaN(asIndex) && `${asIndex}` === operand.replace(/^#/, '')) {
      const member: GatherMember | undefined = state.series[asIndex - 1];
      if (member === undefined) return gather_error(`gather: no member ${operand} — the cohort holds ${state.series.length}.`);
      keys.push(member_key(member));
      continue;
    }
    keys.push(await path_resolve(operand));
  }

  const { members, dropped, missing } = members_drop(state.series, keys);
  if (missing.length > 0) {
    return gather_error(`gather: not in the cohort: ${missing.join(', ')}`);
  }
  state.series = members;
  await cohort_write(state);
  const envelope: CommandEnvelope = cohort_render(state);
  return envelope_ok(`${chalk.green(`gather: ${dropped} removed.`)}\n${envelope.rendered}`, envelope.model);
}

/**
 * Empties the cohort, keeping nothing — not its name, not its feed.
 *
 * @returns The empty cohort.
 */
async function gather_clear(): Promise<CommandEnvelope> {
  const state: GatherState = await cohort_read();
  const held: number = state.series.length;
  const emptied: GatherState = { version: state.version, name: null, feed: null, series: [] };
  await cohort_write(emptied);
  const envelope: CommandEnvelope = cohort_render(emptied);
  return envelope_ok(`${chalk.green(`gather: cleared ${held} ${held === 1 ? 'member' : 'members'}.`)}\n${envelope.rendered}`, envelope.model);
}

/**
 * Reads or sets the cohort's name.
 *
 * @param operands - The new name, or nothing to read the current one.
 * @returns The cohort, named.
 */
async function gather_name(operands: string[]): Promise<CommandEnvelope> {
  const state: GatherState = await cohort_read();
  if (operands.length === 0) {
    if (state.name === null) return envelope_ok(`${chalk.gray('The cohort has no name.')}\n`);
    return envelope_ok(`${state.name}\n`);
  }
  state.name = operands.join(' ');
  await cohort_write(state);
  // The cohort travels with the answer, as every changing verb's does, so
  // a surface showing it takes the name from here.
  return envelope_ok(`${chalk.green(`gather: the cohort is "${state.name}".`)}\n`, cohortModel_of(state));
}

/**
 * Makes the cohort's feed, or names the one it has.
 *
 * @param words - The words after `gather feed`, raw.
 * @returns The cohort, with its feed.
 */
async function gather_feed(words: ReadonlyArray<string>): Promise<CommandEnvelope> {
  // Loaded on demand, as `process` is: making a feed carries the pull and
  // feed machinery, which the cohort's own verbs never need.
  const { cohortFeed_make } = await import('./gather.process.js');
  const made: { state: GatherState; made: boolean } | string = await cohortFeed_make(words);
  if (typeof made === 'string') return gather_error(`gather feed: ${made}`);
  const feedId: number | undefined = made.state.feed?.feedId;
  const said: string = made.made ? `gather: the cohort's feed is ${feedId}, made now.` : `gather: the cohort's feed is ${feedId}.`;
  const envelope: CommandEnvelope = cohort_render(made.state);
  return envelope_ok(`${chalk.green(said)}\n${envelope.rendered}`, envelope.model);
}

/**
 * Builtin handler for the `gather` command.
 *
 * @param args - Parsed command arguments.
 * @returns An envelope carrying the cohort, or a usage refusal.
 */
export async function builtin_gather(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];
  const operands: string[] = parsed._.slice(1);

  try {
    if (subcommand === undefined || subcommand === 'list') return cohort_render(await cohort_read());
    if (subcommand === 'add' || subcommand === 'remove' || subcommand === 'rm') {
      // With no operands, a listing piped in is the operand list (#1103):
      // `query … | gather add`. With neither, the verb says what it needs
      // rather than taking the held listing behind the operator's back.
      let given: string[] = operands;
      if (given.length === 0) {
        const piped: ListingModel | null = listingIn_take();
        if (piped === null) {
          return gather_error(`gather ${subcommand}: what? give paths or handles (@SER3), \${listing}, or pipe a listing in (query … | gather ${subcommand === 'rm' ? 'remove' : subcommand})`);
        }
        given = listingOperands_of(piped) ?? [];
        if (given.length === 0) return gather_error(`gather ${subcommand}: the listing piped in has nothing to ${subcommand === 'add' ? 'gather' : 'remove'}.`);
      }
      return subcommand === 'add' ? await gather_add(given) : await gather_remove(given);
    }
    if (subcommand === 'clear') return await gather_clear();
    // Raw words: the run's own arguments follow `--`, and a generic parser
    // would read them as gather's options.
    // Loaded on demand: running carries the plugin and pipeline machinery,
    // which the cohort's own verbs never need.
    if (subcommand === 'process') {
      const { gather_process } = await import('./gather.process.js');
      return await gather_process(args.slice(args.indexOf('process') + 1));
    }
    if (subcommand === 'name') return await gather_name(operands);
    if (subcommand === 'feed') return await gather_feed(args.slice(args.indexOf('feed') + 1));
  } catch (e: unknown) {
    return gather_error(`gather: ${e instanceof Error ? e.message : String(e)}`);
  }

  return gather_error(`Unknown subcommand: ${subcommand}. Usage: gather <list|add|remove|clear|name|feed|process>`);
}
