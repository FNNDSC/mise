/**
 * @file Builtin gather command: the session's cohort as a kernel subject.
 *
 * Subcommands: list (the default), add, remove, clear, name.
 *
 * Gathering was a surface gesture before it was a verb, which meant the set
 * a session was working on could only be built by pressing on it. As a
 * subject it is scriptable: a line adds to it, a manifest builds one, and
 * the surface becomes one client of the cohort rather than the only place
 * it exists.
 *
 * @module
 */
import chalk from 'chalk';
import path from 'path';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { commandArgs_process, ParsedArgs, path_resolve } from '../utils.js';
import {
  GatherKind,
  GatherMember,
  GatherState,
  cohort_read,
  cohort_write,
  member_key,
  members_drop,
  members_merge,
  pathKind_determine,
  seriesUID_ofPath,
} from './gather.store.js';

/** The model kind under which a cohort travels to a surface. */
export const GATHER_MODEL_KIND: string = 'gather.cohort';

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
  const model = { kind: GATHER_MODEL_KIND, data: state };
  if (state.series.length === 0) {
    return envelope_ok(`${chalk.gray('The cohort is empty. Gather something with `gather add <path>`.')}\n`, model);
  }

  const rows: Record<string, unknown>[] = state.series.map(
    (member: GatherMember, index: number): Record<string, unknown> => ({
      '#': index + 1,
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
    `${table_render(rows, ['#', 'kind', 'member', 'state', 'path'], {
      title: { title, justification: 'center' },
    })}${chalk.gray(parts.join(' · '))}\n`,
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
    }
    incoming.push(member);
  }

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
  return envelope_ok(`${chalk.green(`gather: the cohort is "${state.name}".`)}\n`);
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
    if (subcommand === 'add') return await gather_add(operands);
    if (subcommand === 'remove' || subcommand === 'rm') return await gather_remove(operands);
    if (subcommand === 'clear') return await gather_clear();
    if (subcommand === 'name') return await gather_name(operands);
  } catch (e: unknown) {
    return gather_error(`gather: ${e instanceof Error ? e.message : String(e)}`);
  }

  return gather_error(`Unknown subcommand: ${subcommand}. Usage: gather <list|add|remove|clear|name>`);
}
