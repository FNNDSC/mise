/**
 * @file Builtin expect command: a claim the session can refuse.
 *
 * A workflow that only acts is a demonstration. `expect` is what makes one a
 * TEST: it states a claim about the session — how many things are gathered,
 * what a feed's status is, what a produced file's tags say — and refuses,
 * non-zero, when the claim does not hold. Because it is a verb rather than a
 * harness, a workflow asserts wherever it is played: in CI, at an operator's
 * console, or in someone else's browser after they were handed the file.
 *
 * Time lives here and nowhere else. `--within` polls until the claim holds or
 * the deadline passes, which is why no other verb needs a timeout and why the
 * language has no sleep: a sleep asserts nothing and lies about how long the
 * work actually took.
 *
 * @module
 */
import chalk from 'chalk';
import path from 'path';
import { CommandEnvelope, envelope_ok, envelope_error, procCache_get } from '@fnndsc/cumin';
import { jobs_statusBatch } from '@fnndsc/salsa';
import type { DicomTag, DicomTagsModel, DicomVaryingTag } from '@fnndsc/menu';
import type { Result } from '@fnndsc/cumin';
import { commandArgs_process, ParsedArgs, path_resolve } from '../utils.js';
import { duration_parse } from '../../lib/duration.js';

export { duration_parse };
import { vfs } from '../../lib/vfs/vfs.js';
import type { ListingItem } from '@fnndsc/chili/models/listing.js';
import { cohort_read, GatherMember, GatherState } from './gather.store.js';
import { path_physical, tagsModel_read } from './dicom.js';
import { feedStatus_derive } from '../proc.helpers.js';
import { commandCancellation_enable, commandCancellation_signalGet } from '../../core/cancellation.js';

/** The model kind under which a checked claim travels to a surface. */
export const EXPECT_MODEL_KIND: string = 'expect.result';

/** How the two sides of a claim are compared. */
const PREDICATES: ReadonlyArray<string> = [
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'notContains', 'matches',
];

/** What a claim can be about. */
const SUBJECTS: ReadonlyArray<string> = ['gather', 'feed', 'run', 'path'];

/** Predicates that only mean anything about numbers. */
const NUMERIC_PREDICATES: ReadonlySet<string> = new Set(['gt', 'gte', 'lt', 'lte']);

/** How often a waiting claim asks again. */
const RECHECK_MS: number = 2000;

/** What a claim turned out to be. */
export interface ExpectVerdict {
  /** What was asked about, as the operator wrote it. */
  claim: string;
  /** Whether the claim held. */
  held: boolean;
  /** The value asked for. */
  wanted: string;
  /** The value found; absent when the subject could not be read at all. */
  got: string | null;
  /** Why the subject could not answer, when it could not. */
  refusal?: string;
  /** How long the claim was waited on. */
  waitedMs: number;
}


/**
 * Compares what was found against what was wanted.
 *
 * @param got - The value the session answered.
 * @param predicate - How to compare.
 * @param wanted - The value the claim asked for.
 * @returns Whether the claim holds, or a refusal when the comparison is not meaningful.
 */
export function claim_holds(
  got: string,
  predicate: string,
  wanted: string,
): { held: boolean } | { refusal: string } {
  if (NUMERIC_PREDICATES.has(predicate)) {
    const left: number = Number(got);
    const right: number = Number(wanted);
    if (Number.isNaN(left) || Number.isNaN(right)) {
      return { refusal: `${predicate} compares numbers, and "${Number.isNaN(left) ? got : wanted}" is not one` };
    }
    if (predicate === 'gt') return { held: left > right };
    if (predicate === 'gte') return { held: left >= right };
    if (predicate === 'lt') return { held: left < right };
    return { held: left <= right };
  }

  if (predicate === 'eq' || predicate === 'ne') {
    // A count read back as text and a count written as a number are the same
    // claim: 14 and "14" must not disagree because one came from a table.
    const numeric: boolean = got.trim() !== '' && wanted.trim() !== ''
      && !Number.isNaN(Number(got)) && !Number.isNaN(Number(wanted));
    const same: boolean = numeric ? Number(got) === Number(wanted) : got === wanted;
    return { held: predicate === 'eq' ? same : !same };
  }

  if (predicate === 'contains') return { held: got.includes(wanted) };
  if (predicate === 'notContains') return { held: !got.includes(wanted) };

  try {
    return { held: new RegExp(wanted).test(got) };
  } catch {
    return { refusal: `matches needs a regular expression, and "${wanted}" is not one` };
  }
}

/** What a subject answered, or why it could not. */
interface SubjectReading {
  got: string | null;
  refusal?: string;
}

/**
 * Reads how much of the cohort is home.
 *
 * A place gathered from the filesystem was never anywhere else, so it counts
 * as home; a series counts once CUBE has said where it landed.
 *
 * @param state - The cohort.
 * @returns How many members are in CUBE.
 */
function cohortPulled_count(state: GatherState): number {
  return state.series.filter((member: GatherMember): boolean => {
    if (member.kind !== 'series') return true;
    const landed: unknown = member.folderPath;
    return typeof landed === 'string' && landed.length > 0;
  }).length;
}

/**
 * Answers a claim about the cohort.
 *
 * @param property - `size` or `pulled`.
 * @returns What the cohort says.
 */
async function gather_read(property: string): Promise<SubjectReading> {
  const state: GatherState = await cohort_read();
  if (property === 'size') return { got: `${state.series.length}` };
  if (property === 'pulled') return { got: `${cohortPulled_count(state)}` };
  if (property === 'name') return { got: state.name ?? '' };
  return { got: null, refusal: `gather has no property "${property}" — try size, pulled or name` };
}

/**
 * Answers a claim about a feed.
 *
 * @param target - The feed id.
 * @param property - `status` today.
 * @returns What the feed says.
 */
async function feed_read(target: string, property: string): Promise<SubjectReading> {
  const feedID: number = Number(target);
  if (!Number.isInteger(feedID)) return { got: null, refusal: `"${target}" is not a feed id` };
  if (property !== 'status') return { got: null, refusal: `feed has no property "${property}" — try status` };
  const feed = procCache_get().feed_get(feedID);
  if (feed === undefined || feed === null) {
    return { got: null, refusal: `feed ${feedID} is not in this session's index yet` };
  }
  return { got: feedStatus_derive(feed) };
}

/**
 * Answers a claim about one run.
 *
 * @param target - The plugin instance id.
 * @param property - `status` today.
 * @returns What the run says.
 */
async function run_read(target: string, property: string): Promise<SubjectReading> {
  const instanceID: number = Number(target);
  if (!Number.isInteger(instanceID)) return { got: null, refusal: `"${target}" is not an instance id` };
  if (property !== 'status') return { got: null, refusal: `run has no property "${property}" — try status` };
  const statuses: Map<number, string> = await jobs_statusBatch([instanceID]);
  const status: string | undefined = statuses.get(instanceID);
  if (status === undefined) return { got: null, refusal: `instance ${instanceID} did not answer` };
  return { got: status };
}


/** How far beneath a named folder a claim will look for what it was asked about. */
const DEEP_MAX: number = 4;

/**
 * Walks a folder, gathering what it holds and the folders under it.
 *
 * A plugin's output is routinely NESTED — pfdicom writes under
 * `share/incoming/<input tree>`, and a converter mirrors its input — so a
 * claim about what a run produced, made at the node's own folder, would be
 * false about a run that worked perfectly. The walk is bounded: a claim is
 * a question about a result, not a crawl of the filesystem.
 *
 * @param root - Where to start.
 * @param depth - How many levels below the root to visit.
 * @returns Every item found, with the folder each was found in.
 */
async function folder_walkDeep(root: string, depth: number): Promise<Array<{ folder: string; item: ListingItem }>> {
  const found: Array<{ folder: string; item: ListingItem }> = [];
  const queue: Array<{ path: string; level: number }> = [{ path: root, level: 0 }];

  while (queue.length > 0) {
    const here = queue.shift() as { path: string; level: number };
    const listed: Result<ListingItem[]> = await vfs.data_get(here.path);
    if (!listed.ok) continue;
    for (const item of listed.value) {
      found.push({ folder: here.path, item });
      if (item.type === 'dir' && here.level < depth) {
        queue.push({ path: `${here.path.replace(/\/$/, '')}/${item.name}`, level: here.level + 1 });
      }
    }
  }
  return found;
}

/**
 * Turns a shell-style pattern into a matcher.
 *
 * @param pattern - A glob such as `*.nii*`.
 * @returns A regular expression anchored to the whole name.
 */
function glob_toRegExp(pattern: string): RegExp {
  const escaped: string = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/**
 * Answers a claim about a path: whether it is there, what it holds, what its
 * headers say.
 *
 * @param target - The path, as the operator wrote it.
 * @param property - `exists`, `count`, or `tags`.
 * @param tagName - The tag to read, when the property is `tags`.
 * @param matching - A glob narrowing a count.
 * @param deep - Look beneath the folder, not only in it.
 * @returns What the path says.
 */
async function path_read(
  target: string,
  property: string,
  tagName: string | undefined,
  matching: string | undefined,
  deep: boolean,
): Promise<SubjectReading> {
  const resolved: string = await path_resolve(target);

  if (property === 'exists') {
    const listed: Result<ListingItem[]> = await vfs.data_get(resolved);
    if (listed.ok) return { got: 'true' };
    // A file is not a listing: its parent knows it.
    const parent: Result<ListingItem[]> = await vfs.data_get(path.posix.dirname(resolved));
    if (!parent.ok) return { got: 'false' };
    const leaf: string = path.posix.basename(resolved);
    return { got: `${parent.value.some((item: ListingItem): boolean => item.name === leaf)}` };
  }

  if (property === 'count') {
    if (deep) {
      const walked: Array<{ folder: string; item: ListingItem }> = await folder_walkDeep(resolved, DEEP_MAX);
      const files: ListingItem[] = walked
        .map((entry): ListingItem => entry.item)
        .filter((item: ListingItem): boolean => item.type !== 'dir');
      if (matching === undefined) return { got: `${files.length}` };
      const deepPattern: RegExp = glob_toRegExp(matching);
      return { got: `${files.filter((item: ListingItem): boolean => deepPattern.test(item.name)).length}` };
    }
    const listed: Result<ListingItem[]> = await vfs.data_get(resolved);
    if (!listed.ok) return { got: null, refusal: `${resolved} cannot be listed` };
    if (matching === undefined) return { got: `${listed.value.length}` };
    const pattern: RegExp = glob_toRegExp(matching);
    return { got: `${listed.value.filter((item: ListingItem): boolean => pattern.test(item.name)).length}` };
  }

  if (property === 'tags') {
    if (tagName === undefined) return { got: null, refusal: 'expect path <p> tags <TagName> <predicate> <value>' };
    const physical: string = await path_physical(resolved);
    let model: Result<DicomTagsModel> = await tagsModel_read(physical);
    if (!model.ok) {
      // A plugin's output is routinely nested, so a tag claim made at the
      // node's own folder looks BENEATH it before giving up: the files a run
      // produced are what the claim is about, wherever the plugin filed them.
      const walked: Array<{ folder: string; item: ListingItem }> = await folder_walkDeep(resolved, DEEP_MAX);
      const folders: string[] = [...new Set(walked
        .filter((entry): boolean => entry.item.type === 'dir')
        .map((entry): string => `${entry.folder.replace(/\/$/, '')}/${entry.item.name}`))];
      for (const folder of folders) {
        const beneath: Result<DicomTagsModel> = await tagsModel_read(await path_physical(folder));
        if (beneath.ok) { model = beneath; break; }
      }
    }
    if (!model.ok) return { got: null, refusal: `${resolved} holds no readable DICOM, here or beneath it` };
    const constant: DicomTag | undefined = model.value.constant.find(
      (tag: DicomTag): boolean => tag.name === tagName || tag.tag === tagName,
    );
    if (constant !== undefined) return { got: constant.value };
    // A tag that varies across the folder answers with every value it takes,
    // so a claim about "the" value cannot pass by reading only the first file.
    const varying: DicomVaryingTag | undefined = model.value.varying.find(
      (tag: DicomVaryingTag): boolean => tag.name === tagName || tag.tag === tagName,
    );
    if (varying !== undefined) {
      const values: string[] = [...new Set(varying.values
        .map((entry: { value: string | null }): string => entry.value ?? '')
        .filter((value: string): boolean => value.length > 0))];
      return { got: values.join(', ') };
    }
    return { got: '' };
  }

  return { got: null, refusal: `path has no property "${property}" — try exists, count or tags` };
}

/**
 * Asks the session once.
 *
 * @param subject - What the claim is about.
 * @param target - Which one, for the subjects that need naming.
 * @param property - What about it.
 * @param tagName - The tag, when the property is `tags`.
 * @param matching - A glob, when the property is `count`.
 * @param deep - Whether to look beneath the path as well as in it.
 * @returns What the session answered.
 */
async function subject_read(
  subject: string,
  target: string | undefined,
  property: string,
  tagName: string | undefined,
  matching: string | undefined,
  deep: boolean,
): Promise<SubjectReading> {
  if (subject === 'gather') return await gather_read(property);
  if (subject === 'feed') return await feed_read(target ?? '', property);
  if (subject === 'run') return await run_read(target ?? '', property);
  if (subject === 'path') return await path_read(target ?? '', property, tagName, matching, deep);
  return { got: null, refusal: `expect knows nothing about "${subject}" — try gather, feed, run or path` };
}

/**
 * Sleeps between asks, unless the command is cancelled first.
 *
 * @param ms - How long to wait.
 * @param signal - The foreground command's abort signal.
 * @returns True when the sleep completed.
 */
async function pause_take(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted === true) return false;
  return await new Promise<boolean>((resolve): void => {
    const onAbort = (): void => { clearTimeout(timer); resolve(false); };
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Renders a claim the way it was made, for the readout.
 *
 * @param parts - The claim's words.
 * @returns One line.
 */
function claim_render(parts: string[]): string {
  return parts.filter((part: string): boolean => part.length > 0).join(' ');
}

/**
 * Builtin handler for the `expect` command.
 *
 * @param args - Parsed command arguments.
 * @returns An ok envelope when the claim holds, an error envelope when it does not.
 */
export async function builtin_expect(args: string[]): Promise<CommandEnvelope> {
  // `--deep` carries no value: undeclared, the parser hands it the next
  // operand — which is the COMPARISON — and the claim loses its predicate.
  const parsed: ParsedArgs = commandArgs_process(args, { booleanLongOptions: ['deep'] });
  const operands: string[] = parsed._;
  const subject: string | undefined = operands[0];

  if (subject === undefined) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('Usage: expect <gather|feed|run|path> [<target>] <property> [<predicate> <value>] [--within <duration>]')}\n`);
  }

  // The subject is checked FIRST: read as a shape instead, an unknown
  // subject refuses by complaining about whatever word happened to land
  // where a comparison goes, which names the wrong fault.
  if (!SUBJECTS.includes(subject)) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`expect knows nothing about "${subject}" — try ${SUBJECTS.join(', ')}.`)}\n`);
  }

  // `gather` is the one subject that names nothing: there is one cohort.
  const named: boolean = subject !== 'gather';
  const target: string | undefined = named ? operands[1] : undefined;
  const property: string | undefined = named ? operands[2] : operands[1];
  const rest: string[] = named ? operands.slice(3) : operands.slice(2);
  const tagName: string | undefined = property === 'tags' ? rest.shift() : undefined;

  if (property === undefined) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`expect ${subject}: say what about it — a property such as size, status, exists or count.`)}\n`);
  }

  // `expect path <p> exists` is the claim in full; everything else compares.
  const predicate: string = rest[0] ?? (property === 'exists' ? 'eq' : '');
  const wanted: string = rest[1] ?? (property === 'exists' ? 'true' : '');
  if (predicate === '' || !PREDICATES.includes(predicate)) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`expect: "${predicate}" is not a comparison — use ${PREDICATES.join(', ')}.`)}\n`);
  }

  let deadlineMs: number = 0;
  if (typeof parsed.within === 'string') {
    const parsedWait: number | null = duration_parse(parsed.within);
    if (parsedWait === null) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`expect: --within takes a duration such as 30s, 20m or 2h, not "${parsed.within}".`)}\n`);
    }
    deadlineMs = parsedWait;
  }

  // The claim is printed as it was MADE, narrowing included: a ✓ reading
  // `count gt 0` for a claim that was about `*.nii*` says the wrong thing
  // held, and a battery is read by people who were not there.
  const narrowing: string = matching_get(parsed) === undefined ? '' : `--matching '${matching_get(parsed)}'`;
  const claim: string = claim_render([
    subject, target ?? '', property, tagName ?? '', narrowing,
    parsed.deep === true ? '--deep' : '', predicate, wanted,
  ]);
  const started: number = Date.now();
  if (deadlineMs > 0) commandCancellation_enable();
  const signal: AbortSignal | undefined = deadlineMs > 0 ? commandCancellation_signalGet() : undefined;

  let reading: SubjectReading = { got: null };
  let outcome: { held: boolean } | { refusal: string } = { held: false };

  for (;;) {
    reading = await subject_read(subject, target, property, tagName, matching_get(parsed), parsed.deep === true);
    if (reading.got !== null) {
      outcome = claim_holds(reading.got, predicate, wanted);
      if ('refusal' in outcome) break;
      if (outcome.held) break;
    }
    const elapsed: number = Date.now() - started;
    if (elapsed >= deadlineMs) break;
    const slept: boolean = await pause_take(Math.min(RECHECK_MS, deadlineMs - elapsed), signal);
    if (!slept) break;
  }

  const waitedMs: number = Date.now() - started;
  const held: boolean = 'held' in outcome && outcome.held && reading.got !== null;
  const refusal: string | undefined = 'refusal' in outcome ? outcome.refusal : reading.refusal;
  const verdict: ExpectVerdict = {
    claim,
    held,
    wanted,
    got: reading.got,
    ...(refusal !== undefined ? { refusal } : {}),
    waitedMs,
  };
  const model = { kind: EXPECT_MODEL_KIND, data: verdict };

  if (held) {
    const took: string = deadlineMs > 0 ? chalk.gray(` (${Math.round(waitedMs / 1000)}s)`) : '';
    return envelope_ok(`${chalk.green('✓')} ${claim}${took}\n`, model);
  }

  process.exitCode = 1;
  const lines: string[] = [
    chalk.red(`✗ ${claim}`),
    `    wanted  ${wanted}`,
    `    got     ${reading.got ?? '—'}`,
  ];
  if (refusal !== undefined) lines.push(`    because ${refusal}`);
  if (deadlineMs > 0) lines.push(chalk.gray(`    waited  ${Math.round(waitedMs / 1000)}s of ${Math.round(deadlineMs / 1000)}s`));
  return envelope_error('', undefined, `${lines.join('\n')}\n`, );
}

/**
 * The glob narrowing a count, when one was given.
 *
 * @param parsed - The parsed arguments.
 * @returns The pattern, or undefined.
 */
function matching_get(parsed: ParsedArgs): string | undefined {
  return typeof parsed.matching === 'string' ? parsed.matching : undefined;
}
