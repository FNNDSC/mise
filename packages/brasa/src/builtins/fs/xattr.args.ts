/**
 * @file Shared `setfattr` / `getfattr` command-line grammar.
 *
 * A feed's tags are, in POSIX terms, an extended attribute: `setfattr -n
 * tag -v urgent feed_12` hangs one, `getfattr feed_12` reads them. One
 * attribute exists, `tag` (also spelled `user.tag`), and it holds many
 * values — CUBE's tags on the feed.
 *
 * Dependency-free, as `acl.args.ts` is: the engine graph cannot be loaded
 * under jest, so a grammar inside the builtin is a grammar nothing tests.
 *
 * @module
 */
import { aclTarget_resolve } from './acl.args.js';

/** The one attribute a feed carries. */
export const XATTR_TAG: string = 'tag';

/** How `setfattr` is spelled. */
export const SETFATTR_USAGE: string = 'setfattr: usage: setfattr -n tag -v <value> <path>... | setfattr -x tag [-v <value>] <path>...';

/** How `getfattr` is spelled. */
export const GETFATTR_USAGE: string = 'getfattr: usage: getfattr [-n tag] <path>...';

/** A parsed `setfattr` invocation. */
export interface SetfattrArgs {
  /** Set a value (`-n`), or remove (`-x`). */
  mode: 'set' | 'remove';
  /** The value to set or remove; null removes every value (`-x` alone). */
  value: string | null;
  paths: string[];
  error: string | null;
}

/** A parsed `getfattr` invocation. */
export interface GetfattrArgs {
  paths: string[];
  error: string | null;
}

/**
 * Whether an attribute name is the one a feed carries.
 *
 * @param name - The name as typed.
 * @returns True for `tag` and `user.tag`.
 */
function name_isTag(name: string): boolean {
  return name === XATTR_TAG || name === `user.${XATTR_TAG}`;
}

/**
 * Reads a `setfattr` invocation. Unknown flags and attributes are refused by name.
 *
 * @param args - The tokens after the verb.
 * @returns The parsed invocation, its error set when it is wrong.
 */
export function setfattrArgs_parse(args: ReadonlyArray<string>): SetfattrArgs {
  let mode: 'set' | 'remove' | null = null;
  let name: string | null = null;
  let value: string | null = null;
  const paths: string[] = [];
  const fail = (error: string): SetfattrArgs => ({ mode: 'set', value: null, paths: [], error });
  for (let i = 0; i < args.length; i += 1) {
    const token: string = args[i] ?? '';
    if (token === '-n' || token === '--name' || token === '-x' || token === '--remove') {
      const given: string | undefined = args[i + 1];
      if (given === undefined) return fail(`setfattr: option '${token}' requires an argument\n${SETFATTR_USAGE}`);
      mode = token === '-n' || token === '--name' ? 'set' : 'remove';
      name = given;
      i += 1;
    } else if (token === '-v' || token === '--value') {
      const given: string | undefined = args[i + 1];
      if (given === undefined) return fail(`setfattr: option '${token}' requires an argument\n${SETFATTR_USAGE}`);
      value = given;
      i += 1;
    } else if (token.startsWith('-')) {
      return fail(`setfattr: invalid option -- '${token.replace(/^-+/, '')}'\n${SETFATTR_USAGE}`);
    } else {
      paths.push(token);
    }
  }
  if (mode === null || name === null) return fail(SETFATTR_USAGE);
  if (!name_isTag(name)) return fail(`setfattr: ${name}: Operation not supported (a feed carries one attribute, tag)`);
  if (mode === 'set' && (value === null || value.trim() === '')) return fail(`setfattr: -n ${name} needs -v <value>\n${SETFATTR_USAGE}`);
  if (paths.length === 0) return fail(SETFATTR_USAGE);
  return { mode, value: value === null ? null : value.trim(), paths, error: null };
}

/**
 * Reads a `getfattr` invocation. `-n tag` is accepted (it is the only
 * attribute); `-d` (dump all) reads the same.
 *
 * @param args - The tokens after the verb.
 * @returns The parsed invocation, its error set when it is wrong.
 */
export function getfattrArgs_parse(args: ReadonlyArray<string>): GetfattrArgs {
  const paths: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const token: string = args[i] ?? '';
    if (token === '-n' || token === '--name') {
      const given: string | undefined = args[i + 1];
      if (given === undefined) return { paths: [], error: `getfattr: option '${token}' requires an argument\n${GETFATTR_USAGE}` };
      if (!name_isTag(given)) return { paths: [], error: `getfattr: ${given}: No such attribute (a feed carries one attribute, tag)` };
      i += 1;
    } else if (token === '-d' || token === '--dump') {
      continue;
    } else if (token.startsWith('-')) {
      return { paths: [], error: `getfattr: invalid option -- '${token.replace(/^-+/, '')}'\n${GETFATTR_USAGE}` };
    } else {
      paths.push(token);
    }
  }
  if (paths.length === 0) return { paths: [], error: GETFATTR_USAGE };
  return { paths, error: null };
}

/**
 * The feed a path names: an id, a `feed_N`, a path through `/feeds/` as
 * setfacl reads it, or the projection `/proc/jobs/feed_N`.
 *
 * @param target - The path as typed.
 * @returns The feed id, or null.
 */
export function xattrTarget_resolve(target: string): number | null {
  const held: number | null = aclTarget_resolve(target);
  if (held !== null) return held;
  const projected: RegExpMatchArray | null = target.match(/\/jobs\/feed_(\d+)(?:\/|$)/);
  return projected !== null ? Number(projected[1]) : null;
}

/**
 * Renders a feed's tags the way `getfattr` dumps attributes: a `# file:`
 * line, then one `tag="…"` line per value; nothing under it when bare.
 *
 * @param path - The path as named.
 * @param tags - The tag names.
 * @returns The block.
 */
export function xattr_render(path: string, tags: ReadonlyArray<string>): string {
  return [`# file: ${path}`, ...tags.map((tag: string): string => `${XATTR_TAG}="${tag.replace(/"/g, '\\"')}"`)].join('\n');
}
