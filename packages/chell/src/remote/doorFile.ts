/**
 * @file The door file: what `chell auth login` keeps, and the rules for
 * reading it back.
 *
 * One file per door in the user's own config dir, `~/.config/chell/doors/
 * <door-host>.json`, holding the door, the user, the token's name, the
 * token itself, when it was minted and when it dies. Mode 0600 in a 0700
 * directory, written through a same-directory rename. A `default` file
 * beside them names the door chell goes through when none is given.
 *
 * Reading follows ssh's rule for a loose key: a file not owned by this
 * uid, or readable by group or others, is refused by name and never used,
 * and the refusal never falls back to a prompt a script would hang on.
 *
 * Porter runs as a system user with a home of its own; this file is
 * chell's, so it lands where chell runs: the user's home.
 *
 * @module
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** What the file holds. */
export interface DoorFile {
  /** The door's URL, normalised with its trailing slash. */
  door: string;
  /** The CUBE username the token logs in as. */
  user: string;
  /** The token's name at the door (`chris@titan`). */
  name: string;
  /** The token. */
  token: string;
  /** ISO time it was minted. */
  minted: string;
  /** ISO time it dies. */
  expires: string;
}

/** Why a door file was not used. */
export type DoorFileRefusal = { refused: string };

/** The env var a runner sets instead of a file; `CHELL_DOOR_USER` names who it is for. */
export const DOOR_TOKEN_ENV: string = 'CHELL_DOOR_TOKEN';
export const DOOR_USER_ENV: string = 'CHELL_DOOR_USER';

/** Where the door files live: `$XDG_CONFIG_HOME/chell/doors`, else `~/.config/chell/doors`. */
export function doorsDir_get(env: NodeJS.ProcessEnv = process.env): string {
  const base: string = env['XDG_CONFIG_HOME'] !== undefined && env['XDG_CONFIG_HOME'].length > 0 ? env['XDG_CONFIG_HOME'] : join(homedir(), '.config');
  return join(base, 'chell', 'doors');
}

/**
 * The door's host as a file name: `titan.tch.harvard.edu`, or
 * `pangea.tch.harvard.edu_4180` when the door has a port of its own.
 *
 * @param door - The door's URL, normalised or not.
 * @returns A name safe for a file.
 */
export function doorHost_of(door: string): string {
  const parsed: URL = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(door) ? door : `http://${door}`);
  return parsed.port === '' ? parsed.hostname : `${parsed.hostname}_${parsed.port}`;
}

/** The door file's path for a door. */
export function doorFile_path(door: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(doorsDir_get(env), `${doorHost_of(door)}.json`);
}

/**
 * Writes a door file: the directory made 0700, the file 0600, through a
 * same-directory rename so a crash never leaves half a token.
 *
 * @param file - What to keep.
 * @param env - The environment, for the config dir.
 * @returns The path written.
 */
export function doorFile_write(file: DoorFile, env: NodeJS.ProcessEnv = process.env): string {
  const dir: string = doorsDir_get(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path: string = doorFile_path(file.door, env);
  const temporary: string = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  return path;
}

/**
 * Reads a door file, refusing one that is loose.
 *
 * @param door - The door.
 * @param env - The environment, for the config dir.
 * @param uid - The uid chell runs as; the file must be its.
 * @returns The file, a refusal naming why, or null when there is none.
 */
export function doorFile_read(door: string, env: NodeJS.ProcessEnv = process.env, uid: number = process.getuid?.() ?? -1): DoorFile | DoorFileRefusal | null {
  const path: string = doorFile_path(door, env);
  if (!existsSync(path)) return null;
  const facts = statSync(path);
  if (uid >= 0 && facts.uid !== uid) {
    return { refused: `the door file ${path} is not yours (owned by uid ${facts.uid}); remove it, or run chell auth login as yourself` };
  }
  if ((facts.mode & 0o077) !== 0) {
    return { refused: `the door file ${path} is readable by others (mode 0${(facts.mode & 0o777).toString(8)}); fix it with chmod 600, or remove it and run chell auth login again` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { refused: `the door file ${path} does not parse; remove it and run chell auth login again` };
  }
  if (!doorFile_check(parsed)) return { refused: `the door file ${path} is not a door file; remove it and run chell auth login again` };
  return parsed;
}

/** Whether a parsed value is a door file. */
export function doorFile_check(value: unknown): value is DoorFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<DoorFile>;
  return ['door', 'user', 'name', 'token', 'minted', 'expires'].every((key: string): boolean => typeof (file as Record<string, unknown>)[key] === 'string');
}

/**
 * Removes a door file.
 *
 * @returns Whether there was one.
 */
export function doorFile_remove(door: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const path: string = doorFile_path(door, env);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/** The doors with a file, by host name. */
export function doorFiles_list(env: NodeJS.ProcessEnv = process.env): string[] {
  const dir: string = doorsDir_get(env);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name: string): boolean => name.endsWith('.json')).map((name: string): string => name.slice(0, -5)).sort();
}

/** The default door's marker file. */
function defaultPath_get(env: NodeJS.ProcessEnv): string {
  return join(doorsDir_get(env), 'default');
}

/** The env var a host sets for its own door, the default for everyone on it who chose none. */
export const DOOR_HOST_ENV: string = 'CHELL_DOOR';

/**
 * The door chell goes through when none is given: the user's own default
 * (`chell auth login` remembers it), else the host's (`CHELL_DOOR`, set by
 * the host's `chell` wrapper), else null.
 */
export function doorDefault_read(env: NodeJS.ProcessEnv = process.env): string | null {
  const path: string = defaultPath_get(env);
  if (existsSync(path)) {
    const door: string = readFileSync(path, 'utf8').trim();
    if (door.length > 0) return door;
  }
  const host: string | undefined = env[DOOR_HOST_ENV];
  return host !== undefined && host.trim().length > 0 ? host.trim() : null;
}

/** The user's own default door alone, without the host's: what `login` decides whether to set. */
export function doorDefaultOwn_read(env: NodeJS.ProcessEnv = process.env): string | null {
  const path: string = defaultPath_get(env);
  if (!existsSync(path)) return null;
  const door: string = readFileSync(path, 'utf8').trim();
  return door.length > 0 ? door : null;
}

/** Remembers the default door. */
export function doorDefault_write(door: string, env: NodeJS.ProcessEnv = process.env): void {
  const dir: string = doorsDir_get(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(defaultPath_get(env), `${door}\n`, { encoding: 'utf8', mode: 0o600 });
}

/** Forgets the default door when it is this one. */
export function doorDefault_clear(door: string, env: NodeJS.ProcessEnv = process.env): void {
  if (doorDefault_read(env) === door) unlinkSync(defaultPath_get(env));
}

/** How many whole days until an ISO time; negative when past. */
export function days_until(iso: string, now: number = Date.now()): number {
  return Math.floor((Date.parse(iso) - now) / (24 * 3600 * 1000));
}

/**
 * Whether a door may carry a token: TLS, or loopback. A token over plain
 * HTTP to another host is readable on the wire.
 *
 * @param door - The door's URL.
 * @returns True when a token may be sent.
 */
export function door_carriesTokens(door: string): boolean {
  const parsed: URL = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(door) ? door : `http://${door}`);
  if (parsed.protocol === 'https:') return true;
  return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1' || parsed.hostname === '[::1]';
}

/** A credential for a door, and where it came from. */
export type DoorCredential =
  | { kind: 'token'; token: string; user: string | null; source: 'env' | 'file'; name: string | null; expires: string | null }
  | { kind: 'none' };

/**
 * The token a script carries for a door, by precedence: the environment
 * (`CHELL_DOOR_TOKEN`, with `CHELL_DOOR_USER`), then the door file. A
 * password given on the command line is resolved by the caller before
 * this, and wins.
 *
 * @param door - The door.
 * @param env - The environment.
 * @returns The credential, a refusal (a loose file), or none.
 */
export function doorCredential_resolve(door: string, env: NodeJS.ProcessEnv = process.env): DoorCredential | DoorFileRefusal {
  const fromEnv: string | undefined = env[DOOR_TOKEN_ENV];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    const user: string | undefined = env[DOOR_USER_ENV];
    return { kind: 'token', token: fromEnv.trim(), user: user !== undefined && user.length > 0 ? user : null, source: 'env', name: null, expires: null };
  }
  const file: DoorFile | DoorFileRefusal | null = doorFile_read(door, env);
  if (file === null) return { kind: 'none' };
  if ('refused' in file) return file;
  return { kind: 'token', token: file.token, user: file.user, source: 'file', name: file.name, expires: file.expires };
}
