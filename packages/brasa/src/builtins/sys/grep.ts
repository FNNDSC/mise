/**
 * @file grep: the system's grep on text, and a grep that knows numbered
 * listings (#1100).
 *
 * Fed a numbered listing (a PACS answer, `ls`, the cohort; piped in, or the
 * held one when nothing is piped), grep keeps rows rather than lines: a row
 * that matches stays with its parents for context, a matched group (a study,
 * a patient) keeps all of its rows, and every kept row keeps the handle it
 * wore — `@SER41` stays `@SER41`. The kept rows become the held listing, so
 * `gather add @SER41` and `${listing}` read what grep left.
 *
 * It takes grep's own flags only, with grep's meanings: -i -v -w -E -F -c
 * and -e. Anything else (or a file operand) is the system grep's business,
 * and the whole line goes there as text, said in one line. Plain text in is
 * always the system grep where the surface can run it; `command grep` skips
 * this builtin altogether.
 *
 * @module
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';
import { stdin_take } from '../games/stdin.js';
import { listingIn_take, type ListingModel } from '../../core/listing.js';
import { answerKinds_get } from '../../core/answerKinds.js';
import { surface_get } from '../../core/surface.js';
import {
  answer_get, answerFilter_apply, answerNumbering_of, answerOrdinals_attach, answerRow_key, answerRows_of,
  handle_word, numberedFooter_of, type AnswerRow, type NumberedHandle,
} from '../../session/answer.js';

/** What a grep line asks. */
export interface GrepAsk {
  insensitive: boolean;
  invert: boolean;
  word: boolean;
  extended: boolean;
  fixed: boolean;
  count: boolean;
  patterns: string[];
  /** A flag or operand this grep does not take: the line is the system grep's. */
  foreign: string | null;
}

/** grep's long flags this grep takes, to their short form. */
const LONG_FLAGS: Readonly<Record<string, string>> = {
  '--ignore-case': 'i', '--invert-match': 'v', '--word-regexp': 'w',
  '--extended-regexp': 'E', '--fixed-strings': 'F', '--count': 'c',
};

/**
 * Reads a grep line's words.
 *
 * @param args - The words after `grep`.
 * @returns What they ask.
 */
export function grepArgs_parse(args: ReadonlyArray<string>): GrepAsk {
  const ask: GrepAsk = { insensitive: false, invert: false, word: false, extended: false, fixed: false, count: false, patterns: [], foreign: null };
  const operands: string[] = [];
  const flag = (letter: string): boolean => {
    if (letter === 'i') ask.insensitive = true;
    else if (letter === 'v') ask.invert = true;
    else if (letter === 'w') ask.word = true;
    else if (letter === 'E') ask.extended = true;
    else if (letter === 'F') ask.fixed = true;
    else if (letter === 'c') ask.count = true;
    else return false;
    return true;
  };
  for (let at: number = 0; at < args.length; at++) {
    const word: string = args[at] ?? '';
    if (word === '--') { operands.push(...args.slice(at + 1)); break; }
    if (word === '-e' || word === '--regexp') {
      const pattern: string | undefined = args[at + 1];
      if (pattern === undefined) { ask.foreign = word; break; }
      ask.patterns.push(pattern);
      at += 1;
      continue;
    }
    if (word.startsWith('--regexp=')) { ask.patterns.push(word.slice('--regexp='.length)); continue; }
    if (word.startsWith('--')) {
      const short: string | undefined = LONG_FLAGS[word];
      if (short === undefined) { ask.foreign ??= word; continue; }
      flag(short);
      continue;
    }
    if (word.startsWith('-') && word.length > 1) {
      // Clustered short flags: -vi. An -e inside a cluster takes the rest.
      const letters: string = word.slice(1);
      for (let index: number = 0; index < letters.length; index++) {
        const letter: string = letters[index] ?? '';
        if (letter === 'e') {
          const rest: string = letters.slice(index + 1);
          const pattern: string | undefined = rest !== '' ? rest : args[++at];
          if (pattern === undefined) ask.foreign ??= word;
          else ask.patterns.push(pattern);
          break;
        }
        if (!flag(letter)) { ask.foreign ??= `-${letter}`; break; }
      }
      continue;
    }
    operands.push(word);
  }
  if (ask.patterns.length === 0 && operands.length > 0) ask.patterns.push(operands.shift() as string);
  // A file to read is the system grep's: this one reads a listing or a pipe.
  if (operands.length > 0) ask.foreign ??= operands[0] ?? null;
  return ask;
}

/**
 * A basic regular expression (grep's default) as a JavaScript one: in a BRE
 * `\|` `\(` `\)` `\{` `\}` `\+` `\?` are the operators and the bare
 * characters are literal.
 *
 * @param pattern - The BRE.
 * @returns The equivalent JavaScript source.
 */
function basic_toSource(pattern: string): string {
  let out: string = '';
  for (let at: number = 0; at < pattern.length; at++) {
    const char: string = pattern[at] ?? '';
    if (char === '\\' && at + 1 < pattern.length) {
      const next: string = pattern[at + 1] ?? '';
      out += '|(){}+?'.includes(next) ? next : `\\${next}`;
      at += 1;
    } else {
      out += '|(){}+?'.includes(char) ? `\\${char}` : char;
    }
  }
  return out;
}

/**
 * Builds the test a line (or a row's text) passes.
 *
 * @param ask - What the grep line asks.
 * @returns The test, or a refusal when a pattern does not compile.
 */
export function grepMatcher_build(ask: GrepAsk): ((text: string) => boolean) | { refused: string } {
  const sources: string[] = ask.patterns.map((pattern: string): string => {
    const source: string = ask.fixed ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : ask.extended ? pattern : basic_toSource(pattern);
    return ask.word ? `(?<![\\w])(?:${source})(?![\\w])` : `(?:${source})`;
  });
  try {
    const expression: RegExp = new RegExp(sources.join('|'), ask.insensitive ? 'i' : '');
    return (text: string): boolean => expression.test(text);
  } catch (error: unknown) {
    return { refused: `grep: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Which rows a grep keeps of a listing: a matching row with its parents, a
 * matched group with all its rows; under -v the matching rows (and a
 * matched group's rows) go, and a group stays while any of its rows does.
 *
 * @param rows - The listing's rows, in order.
 * @param matches - The test.
 * @param invert - grep -v.
 * @returns The kept rows, in order.
 */
export function listingRows_grep(rows: ReadonlyArray<AnswerRow>, matches: (text: string) => boolean, invert: boolean): AnswerRow[] {
  const byKey: Map<string, AnswerRow> = new Map(rows.map((row: AnswerRow): [string, AnswerRow] => [answerRow_key(row), row]));
  const ancestors = (row: AnswerRow): AnswerRow[] => {
    const chain: AnswerRow[] = [];
    let parent: AnswerRow | undefined = row.parent === undefined ? undefined : byKey.get(row.parent);
    while (parent !== undefined && !chain.includes(parent)) {
      chain.push(parent);
      parent = parent.parent === undefined ? undefined : byKey.get(parent.parent);
    }
    return chain;
  };
  const hit = (row: AnswerRow): boolean => matches(row.text ?? row.label);
  // A row is caught by its own match or a matched group above it.
  const caught = (row: AnswerRow): boolean => hit(row) || ancestors(row).some(hit);
  const hasChildren: Set<string> = new Set(rows.flatMap((row: AnswerRow): string[] => (row.parent === undefined ? [] : [row.parent])));
  const kept: Set<string> = new Set();
  if (!invert) {
    for (const row of rows) {
      if (!caught(row)) continue;
      kept.add(answerRow_key(row));
      for (const parent of ancestors(row)) kept.add(answerRow_key(parent));
    }
  } else {
    for (const row of rows) {
      if (caught(row) || hasChildren.has(answerRow_key(row))) continue;
      kept.add(answerRow_key(row));
      for (const parent of ancestors(row)) kept.add(answerRow_key(parent));
    }
    // A group with no rows of its own stays when it is not caught.
    for (const row of rows) {
      const key: string = answerRow_key(row);
      if (!caught(row) && !hasChildren.has(key) && row.parent === undefined) kept.add(key);
    }
  }
  return rows.filter((row: AnswerRow): boolean => kept.has(answerRow_key(row)));
}

/** What a listing kind is called in grep's footer. */
const LISTING_WORDS: Readonly<Record<string, string>> = { 'pacs.query': 'PACS answer', 'fs.listing': 'listing', 'gather.cohort': 'cohort' };

/** A leaf kind's plural, for the count. */
const KIND_PLURALS: Readonly<Record<string, string>> = { SER: 'series', FIL: 'files', DIR: 'folders' };

/**
 * Filters a listing and says what was kept, in the listing's own shape.
 *
 * @param listing - The listing: its kind, model, and the line that made it.
 * @param ask - What the grep line asks.
 * @param line - The grep line itself, for the footer.
 * @returns The envelope: the kept rows with their handles, and the filtered model.
 */
function listing_grep(listing: ListingModel & { source: string }, ask: GrepAsk, line: string): CommandEnvelope {
  const built = grepMatcher_build(ask);
  if (typeof built !== 'function') return envelope_error('', undefined, `${built.refused}\n`);
  const rows: AnswerRow[] = answerRows_of(listing.kind, listing.data) ?? [];
  const numbered: NumberedHandle[] = answerNumbering_of(listing.kind, listing.data) ?? [];
  const kept: AnswerRow[] = listingRows_grep(rows, built, ask.invert);
  const groups: Set<string> = new Set(answerKinds_get().filter((kind): boolean => kind.group === true).map((kind): string => kind.code));
  const leaves = (list: ReadonlyArray<AnswerRow>): AnswerRow[] => list.filter((row: AnswerRow): boolean => !groups.has(row.kind));
  if (ask.count) return envelope_ok(`${leaves(kept).length}\n`);

  const ordinalOf: Map<string, number> = new Map(rows.map((row: AnswerRow, at: number): [string, number] => [answerRow_key(row), numbered[at]?.ordinal ?? 0]));
  const keptKeys: Set<string> = new Set(kept.map(answerRow_key));
  const keptHandles: NumberedHandle[] = kept.map((row: AnswerRow): NumberedHandle => ({ kind: row.kind, ordinal: ordinalOf.get(answerRow_key(row)) ?? 0, address: row.address ?? row.values[0] ?? '' }));
  const width: number = Math.max(0, ...keptHandles.map((handle: NumberedHandle): number => handle_word(handle).length));
  const depthOf = (row: AnswerRow): number => {
    let depth: number = 0;
    let parent: string | undefined = row.parent;
    while (parent !== undefined && depth < 8) {
      const up: AnswerRow | undefined = rows.find((one: AnswerRow): boolean => answerRow_key(one) === parent);
      if (up === undefined) break;
      depth += 1;
      parent = up.parent;
    }
    return depth;
  };
  const lines: string[] = kept.map((row: AnswerRow, at: number): string =>
    `${'  '.repeat(depthOf(row) + 1)}${chalk.cyan(handle_word(keptHandles[at] as NumberedHandle).padEnd(width))}  ${row.text ?? row.label}`);
  const leafKinds: string[] = [...new Set(leaves(rows).map((row: AnswerRow): string => row.kind))];
  const plural: string = leafKinds.length === 1 ? KIND_PLURALS[leafKinds[0] ?? ''] ?? 'rows' : 'rows';
  const what: string = `${LISTING_WORDS[listing.kind] ?? listing.kind}${listing.source !== '' ? `: ${listing.source}` : ''}`;
  const tally: string = `${leaves(kept).length} of ${leaves(rows).length} ${plural} kept (${line}; ${what})`;
  const footer: string = numberedFooter_of(keptHandles);
  const rendered: string = `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}${chalk.gray(`  ${tally}`)}\n${footer !== '' ? `${chalk.gray(`  ${footer}`)}\n` : ''}`;
  // grep's own status: no match is exit 1, and an empty listing replaces nothing.
  if (leaves(kept).length === 0) process.exitCode = 1;

  const filtered: unknown = answerFilter_apply(listing.kind, listing.data, keptKeys);
  if (filtered === null || typeof filtered !== 'object') return envelope_ok(rendered);
  // The kept rows keep the numbers they wore, wherever the listing goes next.
  answerOrdinals_attach(filtered, new Map([...keptKeys].map((key: string): [string, number] => [key, ordinalOf.get(key) ?? 0])));
  return envelope_ok(rendered, { kind: listing.kind, data: filtered });
}

/**
 * Plain grep on text: the system's, where the surface runs host programs;
 * otherwise this grep's own line filter, with the same flags.
 *
 * @param text - The text piped in.
 * @param ask - What the grep line asks.
 * @param args - The words after `grep`, for the system grep.
 * @returns The envelope.
 */
async function text_grep(text: string, ask: GrepAsk, args: ReadonlyArray<string>): Promise<CommandEnvelope> {
  const surface = surface_get();
  if (surface.capabilities.pipeSegments) {
    const out: Buffer = await surface.pipeSegment(`grep ${args.map(word_quote).join(' ')}`, Buffer.from(text, 'utf-8'));
    return envelope_ok(out.toString('utf-8'));
  }
  if (ask.foreign !== null) return envelope_error('', undefined, `grep ${ask.foreign}: this surface has no system grep to pass it to\n`);
  const built = grepMatcher_build(ask);
  if (typeof built !== 'function') return envelope_error('', undefined, `${built.refused}\n`);
  const lines: string[] = text.replace(/\n$/, '').split('\n').filter((line: string): boolean => built(line) !== ask.invert);
  if (lines.length === 0) process.exitCode = 1;
  return envelope_ok(ask.count ? `${lines.length}\n` : lines.length > 0 ? `${lines.join('\n')}\n` : '');
}

/** A word as a POSIX shell reads it back. */
function word_quote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * `grep [-ivwEFc] [-e PATTERN]... [PATTERN]`
 *
 * @param args - The words after `grep`.
 * @returns The envelope.
 */
export async function builtin_grep(args: string[]): Promise<CommandEnvelope> {
  const ask: GrepAsk = grepArgs_parse(args);
  const line: string = `grep ${args.map(word_quote).join(' ')}`.trim();
  const piped: ListingModel | null = listingIn_take();
  const text: string | null = stdin_take();
  // A flag or a file this grep does not take: the system grep's, as text.
  if (ask.foreign !== null) {
    const answered: CommandEnvelope = await text_grep(text ?? '', ask, args);
    if (answered.status === 'ok') {
      return { ...answered, renderedErr: `${chalk.gray(`grep ${ask.foreign}: passed to the system grep; the held listing is unchanged`)}\n` };
    }
    return answered;
  }
  if (ask.patterns.length === 0) return envelope_error('', undefined, 'grep: a pattern to keep: grep [-ivwEFc] [-e PATTERN] PATTERN\n');
  if (piped !== null) return listing_grep({ ...piped, source: '' }, ask, line);
  if (text !== null) return text_grep(text, ask, args);
  // Nothing piped: the held listing, as an index reads it.
  const held = answer_get();
  if (held === null) return envelope_error('', undefined, 'grep: nothing to filter: pipe text or a listing in, or list something first (query, ls, gather list)\n');
  return listing_grep({ kind: held.kind, data: held.data, source: held.source }, ask, line);
}
