/**
 * @file `find`: walk the namespace and print the paths an expression selects.
 *
 * POSIX's form: starting points first (`.` when none), then an expression of
 * tests and actions joined by implicit AND, `-o`, `!`/`-not` and parentheses.
 * The walk reads every folder through the listing cache (`vfs.listing_get`),
 * the same listings `ls` reads, so a tree already seen is walked without a
 * word to CUBE; only a folder never listed, or one whose listing expired, is
 * fetched. Links are not followed (POSIX's default). A long walk says how far
 * it has got, and Ctrl-C stops it, saying where; a folder that cannot be read
 * is named and the command fails, as POSIX `find` does, without stopping the
 * walk.
 *
 * Tests: `-name`, `-iname`, `-path`, `-ipath` (shell patterns, `*` crossing `/`
 * in a path), `-type f|d|l`, `-newermt DATE`; options `-maxdepth N`,
 * `-mindepth N`; actions `-print` (the default) and `-print0`. Anything else
 * is refused by name.
 *
 * @module
 */
import chalk from 'chalk';
import path from 'path';
import { path_resolve } from '../utils.js';
import { vfs, type VfsListing } from '../../lib/vfs/vfs.js';
import { spinner } from '../../lib/spinner.js';
import { commandCancellation_enable, commandCancellation_signalGet } from '../../core/cancellation.js';
import { errorStack, type Result } from '@fnndsc/fond';
import { envelope_error, type CommandEnvelope, type ListingItem } from '@fnndsc/menu';

/** One entry the walk visits. */
export interface FindNode {
  /** The path as printed (relative to how its starting point was typed). */
  shown: string;
  /** The entry's own name. */
  name: string;
  /** `d` a folder (any kind the namespace lists into), `l` a link, `f` anything else. */
  type: 'f' | 'd' | 'l';
  /** ISO date, when the listing carries one. */
  date?: string;
  /** Levels below its starting point. */
  depth: number;
}

/** A parsed expression. */
export type FindExpr =
  | { kind: 'and' | 'or'; left: FindExpr; right: FindExpr }
  | { kind: 'not'; operand: FindExpr }
  | { kind: 'test'; test: (node: FindNode) => boolean }
  | { kind: 'print'; separator: string };

/** What the command line asks for. */
export interface FindQuery {
  starts: string[];
  expr: FindExpr;
  maxdepth: number;
  mindepth: number;
  /** Whether the expression names an action; without one, every match is printed. */
  acts: boolean;
}

/** How long a walk runs before it says how far it has got. */
const PROGRESS_AFTER_MS: number = 1500;

/** Listing types the namespace descends into. */
const FOLDER_TYPES: ReadonlySet<string> = new Set(['dir', 'vfs', 'job']);

/**
 * A shell pattern as a regular expression, the way `find` matches it: `*`
 * any run of characters (a `/` included), `?` one, `[...]` a class.
 *
 * @param pattern - The pattern.
 * @param ignoreCase - Whether case is ignored.
 * @returns The expression, anchored at both ends.
 */
export function pattern_toRegExp(pattern: string, ignoreCase: boolean = false): RegExp {
  let source: string = '';
  for (let i: number = 0; i < pattern.length; i++) {
    const ch: string = pattern[i] as string;
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else if (ch === '[') {
      const close: number = pattern.indexOf(']', i + 2);
      if (close === -1) { source += '\\['; continue; }
      const body: string = pattern.slice(i + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\');
      source += `[${body}]`;
      i = close;
    } else if (ch === '\\' && i + 1 < pattern.length) {
      source += (pattern[++i] as string).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    } else source += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, ignoreCase ? 'i' : '');
}

/**
 * Parses `find`'s arguments.
 *
 * @param args - The words after `find`.
 * @returns The query, or the refusal to say.
 */
export function find_parse(args: string[]): FindQuery | string {
  const starts: string[] = [];
  let i: number = 0;
  while (i < args.length && !/^[-!(]/.test(args[i] as string)) starts.push(args[i++] as string);
  if (starts.length === 0) starts.push('.');
  const words: string[] = args.slice(i);
  let at: number = 0;
  let maxdepth: number = Number.POSITIVE_INFINITY;
  let mindepth: number = 0;
  let acts: boolean = false;

  const argument = (predicate: string): string => {
    const value: string | undefined = words[++at];
    if (value === undefined) throw new Error(`find: ${predicate} needs an argument`);
    return value;
  };
  const depth = (predicate: string): number => {
    const value: string = argument(predicate);
    if (!/^\d+$/.test(value)) throw new Error(`find: ${predicate} takes a number, not '${value}'`);
    return Number(value);
  };

  const primary = (): FindExpr => {
    const word: string | undefined = words[at];
    if (word === undefined) throw new Error('find: an expression ends where a test was expected');
    if (word === '(') {
      at++;
      const inner: FindExpr = or();
      if (words[at] !== ')') throw new Error("find: a '(' is not closed");
      at++;
      return inner;
    }
    let expr: FindExpr;
    switch (word) {
      case '-name': case '-iname': {
        const re: RegExp = pattern_toRegExp(argument(word), word === '-iname');
        expr = { kind: 'test', test: (node: FindNode): boolean => re.test(node.name) };
        break;
      }
      case '-path': case '-ipath': case '-wholename': {
        const re: RegExp = pattern_toRegExp(argument(word), word === '-ipath');
        expr = { kind: 'test', test: (node: FindNode): boolean => re.test(node.shown) };
        break;
      }
      case '-type': {
        const kind: string = argument(word);
        if (!['f', 'd', 'l'].includes(kind)) throw new Error(`find: -type takes f, d or l, not '${kind}'`);
        expr = { kind: 'test', test: (node: FindNode): boolean => node.type === kind };
        break;
      }
      case '-newermt': {
        const when: string = argument(word);
        const time: number = Date.parse(when);
        if (Number.isNaN(time)) throw new Error(`find: -newermt takes a date, not '${when}'`);
        expr = { kind: 'test', test: (node: FindNode): boolean => node.date !== undefined && Date.parse(node.date) > time };
        break;
      }
      case '-maxdepth': maxdepth = depth(word); expr = { kind: 'test', test: (): boolean => true }; break;
      case '-mindepth': mindepth = depth(word); expr = { kind: 'test', test: (): boolean => true }; break;
      case '-true': expr = { kind: 'test', test: (): boolean => true }; break;
      case '-false': expr = { kind: 'test', test: (): boolean => false }; break;
      case '-print': acts = true; expr = { kind: 'print', separator: '\n' }; break;
      case '-print0': acts = true; expr = { kind: 'print', separator: '\0' }; break;
      default: throw new Error(`find: unknown predicate '${word}'`);
    }
    at++;
    return expr;
  };
  const not = (): FindExpr => {
    if (words[at] === '!' || words[at] === '-not') { at++; return { kind: 'not', operand: not() }; }
    return primary();
  };
  const and = (): FindExpr => {
    let left: FindExpr = not();
    while (at < words.length && words[at] !== '-o' && words[at] !== '-or' && words[at] !== ')') {
      if (words[at] === '-a' || words[at] === '-and') at++;
      left = { kind: 'and', left, right: not() };
    }
    return left;
  };
  const or = (): FindExpr => {
    let left: FindExpr = and();
    while (words[at] === '-o' || words[at] === '-or') { at++; left = { kind: 'or', left, right: and() }; }
    return left;
  };

  try {
    const expr: FindExpr = words.length === 0 ? { kind: 'test', test: (): boolean => true } : or();
    if (at < words.length) return `find: unexpected '${words[at]}'`;
    return { starts, expr, maxdepth, mindepth, acts };
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Evaluates an expression on one entry, printing as its actions say.
 *
 * @param expr - The expression.
 * @param node - The entry.
 * @param out - Where printed paths go.
 * @returns Whether the expression is true for the entry.
 */
export function find_evaluate(expr: FindExpr, node: FindNode, out: string[]): boolean {
  switch (expr.kind) {
    case 'and': return find_evaluate(expr.left, node, out) && find_evaluate(expr.right, node, out);
    case 'or': return find_evaluate(expr.left, node, out) || find_evaluate(expr.right, node, out);
    case 'not': return !find_evaluate(expr.operand, node, out);
    case 'test': return expr.test(node);
    case 'print': out.push(node.shown + expr.separator); return true;
  }
}

/** An entry's kind, as `-type` names it. */
function type_of(item: ListingItem): 'f' | 'd' | 'l' {
  if (item.type === 'link') return 'l';
  return FOLDER_TYPES.has(item.type) ? 'd' : 'f';
}

/**
 * `find [path...] [expression]`.
 *
 * @param args - The words after `find`.
 * @returns The selected paths, and why any part of the walk failed.
 */
export async function builtin_find(args: string[]): Promise<CommandEnvelope> {
  const query: FindQuery | string = find_parse(args);
  if (typeof query === 'string') {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(query)}\n`);
  }
  commandCancellation_enable();
  const signal: AbortSignal | undefined = commandCancellation_signalGet();
  const out: string[] = [];
  let failures: string = '';
  let folders: number = 0;
  let found: number = 0;
  const startedAt: number = Date.now();
  let announced: boolean = false;
  const progress = (): void => {
    if (Date.now() - startedAt < PROGRESS_AFTER_MS) return;
    const words: string = `find: ${folders} folder${folders === 1 ? '' : 's'} walked, ${found} found`;
    if (announced) spinner.updateMessage(words); else { spinner.start(words); announced = true; }
  };
  const visit = (node: FindNode): void => {
    if (node.depth < query.mindepth) return;
    const before: number = out.length;
    const matched: boolean = find_evaluate(query.expr, node, out);
    if (!query.acts && matched) out.push(`${node.shown}\n`);
    if (out.length > before) found++;
  };

  try {
    for (const start of query.starts) {
      const resolved: string = await path_resolve(start);
      const shownRoot: string = start.startsWith('~') ? resolved : start;
      const self: Result<VfsListing> = await vfs.listing_get(resolved, { directory: true });
      const entry: ListingItem | undefined = self.ok ? self.value.items[0] : undefined;
      if (entry === undefined) {
        errorStack.stack_pop();
        failures += `find: '${start}': No such file or directory\n`;
        continue;
      }
      const rootType: 'f' | 'd' | 'l' = type_of(entry);
      visit({ shown: shownRoot, name: path.posix.basename(resolved) || resolved, type: rootType, date: entry.date || undefined, depth: 0 });
      if (rootType !== 'd') continue;
      // Depth first, in listing order: an entry, then everything beneath it.
      const walk = async (real: string, shown: string, depth: number): Promise<boolean> => {
        if (signal?.aborted) return false;
        if (depth >= query.maxdepth) return true;
        const listed: Result<VfsListing> = await vfs.listing_get(real);
        folders++;
        progress();
        if (!listed.ok) {
          const why: string = errorStack.stack_pop()?.message ?? 'cannot be read';
          failures += `find: '${shown}': ${why}\n`;
          return true;
        }
        for (const item of listed.value.items) {
          const node: FindNode = {
            shown: shown === '/' ? `/${item.name}` : `${shown}/${item.name}`,
            name: item.name,
            type: type_of(item),
            date: item.date || undefined,
            depth: depth + 1,
          };
          visit(node);
          if (node.type === 'd' && !(await walk(path.posix.join(real, item.name), node.shown, node.depth))) return false;
        }
        return true;
      };
      if (!(await walk(resolved, shownRoot, 0))) {
        failures += `find: stopped (Ctrl-C) after ${folders} folders; ${found} found so far\n`;
        break;
      }
    }
  } finally {
    if (announced) spinner.stop();
  }

  if (failures !== '') process.exitCode = 1;
  return { status: failures === '' ? 'ok' : 'error', rendered: out.join(''), renderedErr: failures === '' ? undefined : chalk.red(failures) };
}
