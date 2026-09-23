/**
 * @file A terminal comes through the door.
 *
 * The porter — the door a browser logs in at — mounts a session at
 * `/s/<key>/` and lets a cookie name it. A terminal can come the same way:
 * it posts the operator's password to the door once, keeps the cookie the
 * door hands back, follows the session's boot rows if it has to boot, and
 * attaches to the session's wire with the cookie on the upgrade. No attach
 * token ever reaches the terminal; the door holds it, exactly as it does
 * for a browser. Same login, same session, same idle rules, from a shell.
 *
 * @module
 */
import * as readline from 'node:readline';
import { Writable } from 'node:stream';
import chalk from 'chalk';

/** What the door said to a login. */
export interface DoorEntry {
  /** The session's key: its mount is `/s/<key>/`. */
  key: string;
  /** `attached` to a session already up, or `starting` one that boots now. */
  state: 'attached' | 'starting';
  /** The `Cookie` header value that names this browser's — this terminal's — session. */
  cookie: string;
}

/** The shape of `fetch` this module needs, so a test can stand one in. */
export type DoorFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The door's origin with one trailing slash, however it was typed.
 *
 * A door typed without a scheme — `localhost:4180`, `titan` — is reached
 * over plain HTTP, the way porter listens on loopback; a URL parser would
 * otherwise read `localhost:4180` as the scheme `localhost:` and the fetch
 * would die on it. A door is HTTP or HTTPS and nothing else.
 *
 * @param door - The door's URL as given: `https://titan/`, `http://titan:4180`, `localhost:4180`.
 * @returns The URL ending in `/`.
 * @throws Error naming the door when it is not an HTTP(S) address.
 */
export function door_normalise(door: string): string {
  const typed: string = door.trim();
  const withScheme: string = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `http://${typed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`not a door address: ${door}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`not a door address: ${door} (a door is http:// or https://)`);
  }
  return parsed.pathname.endsWith('/') ? parsed.href : `${parsed.href}/`;
}

/**
 * Whether a credential still has to be asked for. An empty one has: the
 * login config hands over an empty user when none was given, and asking
 * the password of nobody reads as `Password for  at …`.
 *
 * @param value - The credential as given, if at all.
 * @returns True when it is missing or empty.
 */
export function doorCredential_missing(value: string | undefined): value is undefined {
  return value === undefined || value.trim() === '';
}

/**
 * Why a request to the door did not get an answer, in one line: the
 * network's own code (`ECONNREFUSED`, `ENOTFOUND`) when it gave one.
 *
 * @param error - What the fetch threw.
 * @returns The reason.
 */
export function doorUnreached_reason(error: unknown): string {
  const cause: unknown = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const code: unknown = typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined;
  if (typeof code === 'string') return code;
  if (cause instanceof Error && cause.message !== '') return cause.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * The session's wire, from the door and the key: the mount on the socket
 * scheme the door's scheme implies.
 *
 * @param door - The door's URL.
 * @param key - The session's key.
 * @returns `wss://host/s/<key>/`, or `ws://` for a door reached over plain HTTP.
 */
export function doorWire_build(door: string, key: string): string {
  const base: URL = new URL(`s/${key}/`, door_normalise(door));
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return base.href;
}

/**
 * Logs in at the door with a password and keeps the cookie.
 *
 * @param door - The door's URL.
 * @param username - The CUBE username.
 * @param password - The password; sent once, kept nowhere.
 * @param fetchLike - The HTTP client; the global `fetch` by default.
 * @returns The entry, or the door's refusal.
 */
export async function door_login(door: string, username: string, password: string, fetchLike: DoorFetch = fetch): Promise<DoorEntry | { refused: string }> {
  const response = await fetchLike(`${door_normalise(door)}login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    let reason: string = `the door answered ${response.status}`;
    try {
      const body: unknown = await response.json();
      if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') reason = (body as { error: string }).error;
    } catch {
      // The status is the reason, then.
    }
    return { refused: reason };
  }
  const body = (await response.json()) as { key?: unknown; state?: unknown };
  const setCookies: string[] = response.headers.getSetCookie();
  const doorCookie: string | undefined = setCookies.map((line: string): string => line.split(';')[0] ?? '').find((pair: string): boolean => pair.startsWith('porter_session='));
  if (typeof body.key !== 'string' || (body.state !== 'attached' && body.state !== 'starting') || doorCookie === undefined) {
    return { refused: 'the door answered without a session' };
  }
  return { key: body.key, state: body.state, cookie: doorCookie };
}

/**
 * Follows a session's boot from the door, line by line, until it ends.
 *
 * @param door - The door's URL.
 * @param entry - The entry the login gave.
 * @param onLine - Told each boot line, ANSI and all.
 * @param fetchLike - The HTTP client.
 * @returns `ready`, or `failed` with the reason.
 */
export async function doorBoot_follow(
  door: string,
  entry: DoorEntry,
  onLine: (text: string) => void,
  fetchLike: DoorFetch = fetch,
): Promise<{ state: 'ready' } | { state: 'failed'; reason: string }> {
  const response = await fetchLike(`${door_normalise(door)}boot/${entry.key}`, { headers: { cookie: entry.cookie, accept: 'text/event-stream' } });
  if (!response.ok) return { state: 'failed', reason: `the door would not show the boot (${response.status})` };
  const text: string = await response.text();
  return bootEvents_read(text, onLine);
}

/**
 * Reads a boot's server-sent events as the door writes them.
 *
 * @param text - The whole stream, once it closed.
 * @param onLine - Told each `line` event's text.
 * @returns The end the stream reached.
 */
export function bootEvents_read(text: string, onLine: (text: string) => void): { state: 'ready' } | { state: 'failed'; reason: string } {
  for (const block of text.split('\n\n')) {
    let event: string = 'message';
    let data: string = '';
    for (const row of block.split('\n')) {
      if (row.startsWith('event: ')) event = row.slice(7);
      else if (row.startsWith('data: ')) data += row.slice(6);
    }
    if (data.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    if (event === 'line' && typeof parsed === 'object' && parsed !== null && typeof (parsed as { text?: unknown }).text === 'string') {
      onLine((parsed as { text: string }).text);
    } else if (event === 'ready') {
      return { state: 'ready' };
    } else if (event === 'failed') {
      const reason: unknown = typeof parsed === 'object' && parsed !== null ? (parsed as { reason?: unknown }).reason : null;
      return { state: 'failed', reason: typeof reason === 'string' ? reason : 'the session did not start' };
    }
  }
  return { state: 'failed', reason: 'the boot stream ended without a verdict' };
}

/** A writable that can be told to swallow what it is given: the password. */
type MutableWritable = Writable & { muted: boolean };

/**
 * Asks for a line on the terminal, hidden when it is a password.
 *
 * @param label - What is asked for.
 * @param hidden - Whether to echo nothing.
 * @returns The line typed.
 */
export function terminalLine_ask(label: string, hidden: boolean): Promise<string> {
  return new Promise((resolve: (line: string) => void): void => {
    const output: MutableWritable = Object.assign(new Writable({
      write(chunk: Buffer | string, encoding: BufferEncoding, callback: () => void): void {
        if (!(this as MutableWritable).muted) process.stdout.write(chunk, encoding);
        callback();
      },
    }), { muted: false });
    const rl: readline.Interface = readline.createInterface({ input: process.stdin, output, terminal: true });
    // The label is readline's own prompt: written beside it, readline's
    // repaint of an empty prompt (column one, clear to the end) erased it,
    // and the username question showed as a blank line. A hidden answer
    // writes the label first and then mutes what follows.
    if (hidden) {
      process.stdout.write(label);
      output.muted = true;
    }
    rl.question(hidden ? '' : label, (line: string): void => {
      rl.close();
      if (hidden) console.log('');
      resolve(line.trim());
    });
  });
}

/** Where a terminal ends up after the door: a wire and what to send with it. */
export interface DoorReach {
  identity: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * Takes a terminal through the door: asks what it must, logs in, follows
 * the boot if there is one, and hands back the session's wire.
 *
 * @param door - The door's URL.
 * @param username - The CUBE username, or undefined to ask.
 * @param password - The password, or undefined to ask.
 * @param fetchLike - The HTTP client.
 * @returns The reach, or null when the door refused (already said why).
 */
export async function door_enter(door: string, username: string | undefined, password: string | undefined, fetchLike: DoorFetch = fetch): Promise<DoorReach | null> {
  let doorUrl: string;
  try {
    doorUrl = door_normalise(door);
  } catch (error: unknown) {
    console.error(chalk.red(`[!] ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
  const user: string = doorCredential_missing(username) ? await terminalLine_ask(`Username at ${doorUrl}: `, false) : username;
  // An empty answer is refused here, by name: the door would only refuse it
  // after a password asked for nobody.
  if (doorCredential_missing(user)) {
    console.error(chalk.red('[!] A username is required to come through the door (give -u <user>, or answer the question).'));
    return null;
  }
  const secret: string = doorCredential_missing(password) ? await terminalLine_ask(`Password for ${user} at ${doorUrl}: `, true) : password;
  // A door that cannot be reached — porter down, a wrong port, a name that
  // does not resolve — is one line naming the door, never a stack trace.
  const unreached = (error: unknown): null => {
    console.error(chalk.red(`[!] The door at ${doorUrl} could not be reached: ${doorUnreached_reason(error)}`));
    return null;
  };
  let entered: DoorEntry | { refused: string };
  try {
    entered = await door_login(doorUrl, user, secret, fetchLike);
  } catch (error: unknown) {
    return unreached(error);
  }
  if ('refused' in entered) {
    console.error(chalk.red(`[!] The door refused: ${entered.refused}`));
    return null;
  }
  if (entered.state === 'starting') {
    console.log(chalk.gray(`[+] Starting your session at ${doorUrl} — the boot as it happens:`));
    let ended: { state: 'ready' } | { state: 'failed'; reason: string };
    try {
      ended = await doorBoot_follow(doorUrl, entered, (text: string): void => { console.log(text); }, fetchLike);
    } catch (error: unknown) {
      return unreached(error);
    }
    if (ended.state === 'failed') {
      console.error(chalk.red(`[!] The session did not start: ${ended.reason}`));
      return null;
    }
  }
  return {
    identity: `${user} through the door at ${doorUrl}`,
    url: doorWire_build(doorUrl, entered.key),
    headers: { cookie: entered.cookie },
  };
}
