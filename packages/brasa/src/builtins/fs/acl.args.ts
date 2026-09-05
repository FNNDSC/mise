/**
 * @file Shared `setfacl` / `getfacl` command-line grammar.
 *
 * A feed shared with another identity is, in POSIX terms, an access
 * control entry: `setfacl -m u:someone:r <path>`. That is the verb a
 * terminal already knows. "Share X with Y" is a sentence — it belongs to
 * a natural-language assist, not to a shell.
 *
 * Dependency-free, as `cat.args.ts` is: the engine graph cannot be loaded
 * under jest, so a grammar inside the builtin is a grammar nothing tests.
 *
 * @module
 */

/** One access control entry, as `setfacl -m` spells it. */
export interface AclEntry {
  /** Identity the entry names. Only user entries are supported. */
  username: string;
  /** Permission letters, in `rwx` order, minus omitted. */
  perms: string;
}

/** A parsed `setfacl` invocation. */
export interface SetfaclArgs {
  /** The entry to add or modify, when `-m` was given. */
  modify: AclEntry | null;
  /** The identity to strip, when `-x` was given. */
  remove: string | null;
  /** Paths the entry applies to. */
  paths: string[];
  /** What was wrong with the invocation, when something was. */
  error: string | null;
}

/** How `setfacl` is spelled, for help and for errors. */
export const SETFACL_USAGE: string = 'setfacl: usage: setfacl -m u:<user>:<perms> <path>...';

/** How `getfacl` is spelled. */
export const GETFACL_USAGE: string = 'getfacl: usage: getfacl <path>...';

/**
 * Reads an access control entry of the form `u:<user>:<perms>`.
 *
 * @param spec - The entry as typed.
 * @returns The entry, or null when it is not a user entry.
 */
export function aclEntry_parse(spec: string): AclEntry | null {
  const parts: string[] = spec.split(':');
  // `u:name:perms` and the long `user:name:perms` both read; group and
  // other entries are not something CUBE models, so they are refused
  // rather than silently treated as a user.
  if (parts.length !== 3) return null;
  const kind: string = parts[0] ?? '';
  if (kind !== 'u' && kind !== 'user') return null;
  const username: string = parts[1] ?? '';
  const perms: string = parts[2] ?? '';
  if (username === '') return null;
  if (!/^[rwx-]*$/.test(perms)) return null;
  return { username, perms };
}

/**
 * Reads a `setfacl` invocation.
 *
 * @param args - Raw argument tokens.
 * @returns The requested change and its targets, or the reason it cannot
 *   be read.
 */
export function setfaclArgs_parse(args: string[]): SetfaclArgs {
  const empty: SetfaclArgs = { modify: null, remove: null, paths: [], error: null };
  let modify: AclEntry | null = null;
  let remove: string | null = null;
  const paths: string[] = [];

  for (let index: number = 0; index < args.length; index++) {
    const token: string = args[index] ?? '';
    if (token === '-m' || token === '--modify') {
      const spec: string | undefined = args[++index];
      if (spec === undefined) return { ...empty, error: SETFACL_USAGE };
      const entry: AclEntry | null = aclEntry_parse(spec);
      if (entry === null) {
        return { ...empty, error: `setfacl: '${spec}' is not a user entry (want u:<user>:<perms>)` };
      }
      modify = entry;
      continue;
    }
    if (token === '-x' || token === '--remove') {
      const spec: string | undefined = args[++index];
      if (spec === undefined) return { ...empty, error: SETFACL_USAGE };
      const named: string = spec.startsWith('u:') ? spec.slice(2) : spec.startsWith('user:') ? spec.slice(5) : spec;
      if (named === '') return { ...empty, error: SETFACL_USAGE };
      remove = named.split(':')[0] ?? named;
      continue;
    }
    if (token.startsWith('-')) {
      return { ...empty, error: `setfacl: unsupported option '${token}'` };
    }
    paths.push(token);
  }

  if (modify === null && remove === null) return { ...empty, error: SETFACL_USAGE };
  if (paths.length === 0) return { ...empty, error: SETFACL_USAGE };
  return { modify, remove, paths, error: null };
}

/**
 * Resolves a feed id from an id, a `feed_N` name, or a path holding one.
 *
 * The path form matches `/feeds/feed_<id>/` wherever it appears, so a path
 * under `/SHARED` resolves by the same rule as one under a home folder.
 *
 * @param target - What the operator typed.
 * @returns The feed id, or null when nothing in it names a feed.
 */
export function aclTarget_resolve(target: string): number | null {
  const bare: number = Number(target);
  if (Number.isInteger(bare) && bare > 0) return bare;
  const named: RegExpMatchArray | null = target.match(/^feed_(\d+)$/);
  if (named !== null) return Number(named[1]);
  const inPath: RegExpMatchArray | null = target.match(/\/feeds\/feed_(\d+)(?:\/|$)/);
  return inPath !== null ? Number(inPath[1]) : null;
}

/**
 * Renders an access list the way `getfacl` does.
 *
 * @param path - The path as the operator named it.
 * @param owner - The owning identity, when known.
 * @param usernames - Identities granted access.
 * @returns The rendered block, without a trailing newline.
 */
export function acl_render(path: string, owner: string | null, usernames: readonly string[]): string {
  const name: string = path.replace(/^\//, '');
  const lines: string[] = [`# file: ${name}`];
  if (owner !== null) lines.push(`# owner: ${owner}`);
  lines.push('user::rw-');
  for (const username of usernames) lines.push(`user:${username}:r--`);
  return lines.join('\n');
}
