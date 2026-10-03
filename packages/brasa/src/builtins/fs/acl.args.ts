/**
 * @file Shared `setfacl` / `getfacl` / `chmod` command-line grammar.
 *
 * A feed shared with another identity is, in POSIX terms, an access
 * control entry: `setfacl -m u:someone:r <path>`, `setfacl -m g:lab:r`,
 * and the other entry `setfacl -m o::r` for everyone (a public feed). That
 * is the verb a terminal already knows. "Share X with Y" is a sentence — it
 * belongs to a natural-language assist, not to a shell.
 *
 * Dependency-free, as `cat.args.ts` is: the engine graph cannot be loaded
 * under jest, so a grammar inside the builtin is a grammar nothing tests.
 *
 * @module
 */

/** Which identity an entry names. */
export type AclKind = 'user' | 'group' | 'other';

/** One access control entry, as `setfacl -m` spells it. */
export interface AclEntry {
  kind: AclKind;
  /** The user or group; empty for the other entry. */
  name: string;
  /** Permission letters, in `rwx` order, minus omitted. */
  perms: string;
}

/** A grant to withdraw, as `setfacl -x` names it. */
export interface AclRemoval {
  kind: 'user' | 'group';
  name: string;
}

/** A parsed `setfacl` invocation. */
export interface SetfaclArgs {
  /** The entry to add or modify, when `-m` was given. */
  modify: AclEntry | null;
  /** The grant to withdraw, when `-x` was given. */
  remove: AclRemoval | null;
  /** Paths the entry applies to. */
  paths: string[];
  /** What was wrong with the invocation, when something was. */
  error: string | null;
}

/** Who can read a feed besides its owner, as `getfacl` shows it. */
export interface AclView {
  users: readonly string[];
  groups: readonly string[];
  public: boolean;
}

/** How `setfacl` is spelled, for help and for errors. */
export const SETFACL_USAGE: string = 'setfacl: usage: setfacl -m u:<user>:r|g:<group>:r|o::r|o::- <path>... | setfacl -x u:<user>|g:<group> <path>...';

/** How `getfacl` is spelled. */
export const GETFACL_USAGE: string = 'getfacl: usage: getfacl <path>...';

/** How `chmod` is spelled on a feed. */
export const CHMOD_USAGE: string = 'chmod: usage: chmod o+r|o-r <feed>... (a feed is public or private; nothing else is a mode it has)';

/** The words for an entry's kind, short and long. */
const KIND_OF: Readonly<Record<string, AclKind>> = { u: 'user', user: 'user', g: 'group', group: 'group', o: 'other', other: 'other' };

/**
 * Reads an access control entry: `u:<user>:<perms>`, `g:<group>:<perms>`,
 * or the other entry `o::<perms>` (also `o:<perms>`); long kinds read too.
 *
 * @param spec - The entry as typed.
 * @returns The entry, or null when it is none of these.
 */
export function aclEntry_parse(spec: string): AclEntry | null {
  const parts: string[] = spec.split(':');
  const kind: AclKind | undefined = KIND_OF[parts[0] ?? ''];
  if (kind === undefined) return null;
  if (kind === 'other') {
    // `o::r` names no one; `o:r` is the same entry spelled shorter.
    const perms: string | null = parts.length === 3 && parts[1] === '' ? (parts[2] ?? '') : parts.length === 2 ? (parts[1] ?? '') : null;
    return perms !== null && /^[rwx-]*$/.test(perms) ? { kind, name: '', perms } : null;
  }
  if (parts.length !== 3) return null;
  const name: string = parts[1] ?? '';
  const perms: string = parts[2] ?? '';
  if (name === '' || !/^[rwx-]*$/.test(perms)) return null;
  return { kind, name, perms };
}

/**
 * Reads the grant `setfacl -x` withdraws: `u:<user>` or `g:<group>` (a bare
 * name is a user, as on Linux).
 *
 * @param spec - The entry as typed.
 * @returns The grant, or the refusal's words.
 */
export function aclRemoval_parse(spec: string): AclRemoval | string {
  const parts: string[] = spec.split(':');
  // `o` or `other` alone names the other entry, never a user called "o".
  const bareOther: boolean = parts.length === 1 && KIND_OF[spec] === 'other';
  const kind: AclKind | undefined = bareOther ? 'other' : parts.length === 1 ? 'user' : KIND_OF[parts[0] ?? ''];
  const name: string = parts.length === 1 ? (parts[0] ?? '') : (parts[1] ?? '');
  if (kind === 'other') return "setfacl: the other entry cannot be removed; make the feed private with setfacl -m o::- (or chmod o-r)";
  if (kind === undefined || name === '') return SETFACL_USAGE;
  return { kind, name };
}

/**
 * Reads a `setfacl` invocation.
 *
 * @param args - Raw argument tokens.
 * @returns The requested change and its targets, or the reason it cannot be read.
 */
export function setfaclArgs_parse(args: string[]): SetfaclArgs {
  const empty: SetfaclArgs = { modify: null, remove: null, paths: [], error: null };
  let modify: AclEntry | null = null;
  let remove: AclRemoval | null = null;
  const paths: string[] = [];

  for (let index: number = 0; index < args.length; index++) {
    const token: string = args[index] ?? '';
    if (token === '-m' || token === '--modify') {
      const spec: string | undefined = args[++index];
      if (spec === undefined) return { ...empty, error: SETFACL_USAGE };
      const entry: AclEntry | null = aclEntry_parse(spec);
      if (entry === null) {
        return { ...empty, error: `setfacl: '${spec}' is not an entry (want u:<user>:r, g:<group>:r, o::r or o::-)` };
      }
      modify = entry;
      continue;
    }
    if (token === '-x' || token === '--remove') {
      const spec: string | undefined = args[++index];
      if (spec === undefined) return { ...empty, error: SETFACL_USAGE };
      const removal: AclRemoval | string = aclRemoval_parse(spec);
      if (typeof removal === 'string') return { ...empty, error: removal };
      remove = removal;
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
 * Reads a `chmod` on feeds: `o+r` makes them public, `o-r` private, and
 * either is the other entry `setfacl` writes.
 *
 * @param args - Raw argument tokens.
 * @returns The entry and the feeds, or the refusal's words.
 */
export function chmodArgs_parse(args: string[]): { entry: AclEntry; paths: string[] } | string {
  const [mode, ...paths] = args;
  if (mode === undefined || paths.length === 0) return CHMOD_USAGE;
  if (mode === 'o+r') return { entry: { kind: 'other', name: '', perms: 'r' }, paths };
  if (mode === 'o-r') return { entry: { kind: 'other', name: '', perms: '-' }, paths };
  return `chmod: mode '${mode}' is not one a feed has: o+r makes it public, o-r private`;
}

/**
 * Resolves a feed id from an id, a `feed_N` name, a path through `/feeds/`,
 * or its projection `/proc/jobs/feed_N`.
 *
 * @param target - What the operator typed.
 * @returns The feed id, or null when nothing in it names a feed.
 */
export function aclTarget_resolve(target: string): number | null {
  const bare: number = Number(target);
  if (Number.isInteger(bare) && bare > 0) return bare;
  const named: RegExpMatchArray | null = target.match(/^feed_(\d+)$/);
  if (named !== null) return Number(named[1]);
  const inPath: RegExpMatchArray | null = target.match(/\/(?:feeds|proc\/jobs)\/feed_(\d+)(?:\/|$)/);
  return inPath !== null ? Number(inPath[1]) : null;
}

/**
 * Renders an access list the way `getfacl` does: the owner's entry, one line
 * per user and per group granted read, then the other entry (public or not).
 *
 * @param path - The path as the operator named it.
 * @param owner - The owning identity, when known.
 * @param access - Who can read it.
 * @returns The rendered block, without a trailing newline.
 */
export function acl_render(path: string, owner: string | null, access: AclView): string {
  const name: string = path.replace(/^\//, '');
  const lines: string[] = [`# file: ${name}`];
  if (owner !== null) lines.push(`# owner: ${owner}`);
  lines.push('user::rw-');
  for (const user of access.users) lines.push(`user:${user}:r--`);
  for (const group of access.groups) lines.push(`group:${group}:r--`);
  lines.push(access.public ? 'other::r--' : 'other::---');
  return lines.join('\n');
}
