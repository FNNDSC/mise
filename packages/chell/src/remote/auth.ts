/**
 * @file `chell auth`: the gh-auth experience for a porter.
 *
 * `chell auth login` gets this machine a door token once, by one of three
 * ways: a one-time code the human enters on the door's login page from any
 * device (the default, so the password never crosses the terminal), a
 * password typed here (`--with-password`, for a door no browser can reach),
 * or a token minted elsewhere and pasted in (`--with-token`, read from
 * stdin). The token lands in the user's door file; the door becomes the
 * default when none was. `status` says who you are and how long the token
 * lives; `logout` revokes it at the door and removes the file; `token`
 * mints one to carry to another machine; `tokens` lists this identity's.
 *
 * Off a TTY nothing is asked: the command line, the environment or the
 * file answers, else one line of refusal.
 *
 * @module
 */
import chalk from 'chalk';
import { hostname } from 'node:os';
import {
  door_normalise,
  door_login,
  door_loginByToken,
  door_loginForToken,
  doorDevice_begin,
  doorDevice_wait,
  doorTokens_list,
  doorToken_revoke,
  terminalLine_ask,
  doorUnreached_reason,
  type DoorFetch,
  type DoorTokenGrant,
} from './door.js';
import {
  doorCredential_resolve,
  doorDefault_clear,
  doorDefault_read,
  doorDefaultOwn_read,
  doorDefault_write,
  doorFile_path,
  doorFile_read,
  doorFile_remove,
  doorFile_write,
  doorFiles_list,
  door_carriesTokens,
  days_until,
  type DoorFile,
} from './doorFile.js';

/** The verbs `chell auth` knows. */
export type AuthVerb = 'login' | 'status' | 'logout' | 'token' | 'tokens';

/** What `chell auth …` asked for. */
export interface AuthAsk {
  verb: AuthVerb;
  /** `--door <url>`; else the default door, else asked. */
  door?: string;
  /** `--name <name>`: the token's name at the door. */
  name?: string;
  /** How to log in: `--with-password`, `--with-token`, else the browser code (a TTY asks once). */
  withPassword?: boolean;
  withToken?: boolean;
  /** `-u <user>`, for a password login without a question. */
  user?: string;
  /** `-p <password>`; discouraged, honoured. */
  password?: string;
  /** `--insecure-door`: a token over plain HTTP to another host, knowingly. */
  insecureDoor?: boolean;
  /** `--default`: make this door the default even when another was. */
  makeDefault?: boolean;
}

const AUTH_USAGE: string = [
  'chell auth login [--door <url>] [--name <name>] [--with-password | --with-token] [-u <user>] [--default]',
  'chell auth status [--door <url>]',
  'chell auth logout [--door <url>]',
  'chell auth token --name <name> [--door <url>] [--with-password]     mint a token to carry elsewhere (shown once)',
  'chell auth tokens [--door <url>]                                    this identity\'s tokens at the door',
].join('\n');

/**
 * Reads the words after `auth`.
 *
 * @param words - `process.argv` after `auth`.
 * @returns The ask, or a refusal by name.
 */
export function authArgs_parse(words: ReadonlyArray<string>): AuthAsk | { refusal: string } {
  const [verb, ...rest] = words;
  if (verb === undefined || verb === '--help' || verb === '-h') return { refusal: AUTH_USAGE };
  if (!['login', 'status', 'logout', 'token', 'tokens'].includes(verb)) return { refusal: `auth: unknown verb '${verb}'\n${AUTH_USAGE}` };
  const ask: AuthAsk = { verb: verb as AuthVerb };
  for (let i = 0; i < rest.length; i++) {
    const word: string = rest[i] as string;
    const next = (): string | { refusal: string } => {
      const value: string | undefined = rest[i + 1];
      if (value === undefined || value.startsWith('-')) return { refusal: `auth ${verb}: ${word} wants a value` };
      i += 1;
      return value;
    };
    const take = (key: 'door' | 'name' | 'user' | 'password'): { refusal: string } | null => {
      const value = next();
      if (typeof value !== 'string') return value;
      ask[key] = value;
      return null;
    };
    let refusal: { refusal: string } | null = null;
    if (word === '--door') refusal = take('door');
    else if (word === '--name') refusal = take('name');
    else if (word === '-u' || word === '--user') refusal = take('user');
    else if (word === '-p' || word === '--password') refusal = take('password');
    else if (word === '--with-password') ask.withPassword = true;
    else if (word === '--with-token') ask.withToken = true;
    else if (word === '--insecure-door') ask.insecureDoor = true;
    else if (word === '--default') ask.makeDefault = true;
    else return { refusal: `auth ${verb}: unknown word '${word}'\n${AUTH_USAGE}` };
    if (refusal !== null) return refusal;
  }
  if (ask.withPassword && ask.withToken) return { refusal: 'auth login: --with-password and --with-token are two ways in; pick one' };
  if (ask.verb === 'token' && ask.name === undefined) return { refusal: 'auth token: --name <name> is required; the name is what the token is for (e.g. "cron on titan")' };
  return ask;
}

/** What the verbs need from the world, replaceable in a test. */
export interface AuthWorld {
  fetchLike: DoorFetch;
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
  /** Asks a line on the terminal; hidden for a password. */
  ask: (label: string, hidden: boolean) => Promise<string>;
  /** Reads one line from stdin (a pasted token). */
  stdinLine: () => Promise<string>;
  say: (line: string) => void;
  warn: (line: string) => void;
  hostname: () => string;
  now: () => number;
  /** How long the browser code is waited for, in ms. */
  deviceWaitMs: number;
}

/** The world as it is. */
export function authWorld_real(): AuthWorld {
  return {
    fetchLike: fetch,
    env: process.env,
    isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
    ask: terminalLine_ask,
    stdinLine: async (): Promise<string> => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return Buffer.concat(chunks).toString('utf8').split('\n')[0]?.trim() ?? '';
    },
    say: (line: string): void => { console.log(line); },
    warn: (line: string): void => { console.error(line); },
    hostname: (): string => hostname().split('.')[0] ?? hostname(),
    now: (): number => Date.now(),
    deviceWaitMs: 10 * 60 * 1000,
  };
}

/**
 * Runs one `chell auth` verb.
 *
 * @param ask - What was asked.
 * @param world - The world.
 * @returns The exit code.
 */
export async function auth_run(ask: AuthAsk, world: AuthWorld = authWorld_real()): Promise<number> {
  const door: string | null = await door_resolve(ask, world);
  if (door === null) return 1;
  switch (ask.verb) {
    case 'login': return login_run(ask, door, world);
    case 'status': return status_run(door, world);
    case 'logout': return logout_run(door, world);
    case 'token': return token_run(ask, door, world);
    case 'tokens': return tokens_run(door, world);
  }
}

/** The door: given, else the default, else asked on a TTY, else refused. */
async function door_resolve(ask: AuthAsk, world: AuthWorld): Promise<string | null> {
  let door: string | undefined = ask.door ?? doorDefault_read(world.env) ?? undefined;
  if (door === undefined) {
    if (!world.isTTY) {
      world.warn(chalk.red('[!] No door: give --door <url>, or run chell auth login once on a terminal to set a default.'));
      return null;
    }
    const typed: string = (await world.ask('Door (the porter\'s URL, e.g. https://titan.tch.harvard.edu): ', false)).trim();
    if (typed.length === 0) {
      world.warn(chalk.red('[!] A door is required.'));
      return null;
    }
    door = typed;
  }
  try {
    return door_normalise(door);
  } catch (error: unknown) {
    world.warn(chalk.red(`[!] ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
}

/** The TLS rule: a token never goes over plain HTTP to another host unless said knowingly. */
function tokenTransport_check(door: string, ask: AuthAsk, world: AuthWorld): boolean {
  if (door_carriesTokens(door) || ask.insecureDoor === true) return true;
  world.warn(chalk.red(`[!] ${door} is plain http to another host: a token sent there is readable on the wire. Use the https door, or say --insecure-door knowingly.`));
  return false;
}

/** The token's default name: `<user>@<this host>`. */
function tokenName_default(user: string, world: AuthWorld): string {
  return `${user}@${world.hostname()}`;
}

async function login_run(ask: AuthAsk, door: string, world: AuthWorld): Promise<number> {
  if (!tokenTransport_check(door, ask, world)) return 1;
  let grant: DoorTokenGrant | null;
  const way: 'browser' | 'password' | 'token' | null = await way_choose(ask, world);
  if (way === null) return 1;
  try {
    if (way === 'token') grant = await byToken_login(door, world);
    else if (way === 'password') grant = await byPassword_login(ask, door, world, ask.name);
    else grant = await byBrowser_login(door, world);
  } catch (error: unknown) {
    world.warn(chalk.red(`[!] The door at ${door} could not be reached: ${doorUnreached_reason(error)}`));
    return 1;
  }
  if (grant === null) return 1;
  const file: DoorFile = { door, user: grant.user, name: grant.name, token: grant.token, minted: new Date(world.now()).toISOString(), expires: grant.expires };
  const path: string = doorFile_write(file, world.env);
  const wasDefault: string | null = doorDefaultOwn_read(world.env);
  if (wasDefault === null || ask.makeDefault === true) doorDefault_write(door, world.env);
  world.say(chalk.green(`[+] Logged in at ${door} as ${grant.user}; token "${grant.name}" dies ${grant.expires.slice(0, 10)} (${days_until(grant.expires, world.now())} days).`));
  world.say(chalk.gray(`    kept in ${path} (0600)${(wasDefault === null || ask.makeDefault === true) ? '; this door is now the default: chell and chell -c go through it with no flags' : ''}`));
  return 0;
}

/** Which way in: the flags decide; a TTY asks once; off a TTY only a pasted token or the env can answer. */
async function way_choose(ask: AuthAsk, world: AuthWorld): Promise<'browser' | 'password' | 'token' | null> {
  if (ask.withToken) return 'token';
  if (ask.withPassword || ask.password !== undefined) return 'password';
  if (!world.isTTY) {
    world.warn(chalk.red('[!] No terminal to ask on: run chell auth login --with-token with the token on stdin, or set CHELL_DOOR_TOKEN.'));
    return null;
  }
  world.say('How would you like to log in?');
  world.say('  1  with a web browser (a code to enter on the door\'s login page, from any device)');
  world.say('  2  with a password typed here');
  world.say('  3  with a token minted elsewhere, pasted here');
  const picked: string = (await world.ask('Choose [1]: ', false)).trim();
  if (picked === '' || picked === '1') return 'browser';
  if (picked === '2') return 'password';
  if (picked === '3') return 'token';
  world.warn(chalk.red(`[!] '${picked}' is not a choice.`));
  return null;
}

async function byToken_login(door: string, world: AuthWorld): Promise<DoorTokenGrant | null> {
  const token: string = world.isTTY ? (await world.ask('Token: ', true)).trim() : await world.stdinLine();
  if (token.length === 0) {
    world.warn(chalk.red('[!] No token given.'));
    return null;
  }
  const entered = await door_loginByToken(door, token, world.fetchLike);
  if ('refused' in entered) {
    world.warn(chalk.red(`[!] The door refused the token: ${entered.refused}`));
    return null;
  }
  return { token, user: entered.user, name: entered.tokenName, expires: entered.expires };
}

async function byPassword_login(ask: AuthAsk, door: string, world: AuthWorld, name: string | undefined): Promise<DoorTokenGrant | null> {
  const user: string = ask.user ?? (world.isTTY ? (await world.ask(`Username at ${door}: `, false)).trim() : '');
  if (user.length === 0) {
    world.warn(chalk.red('[!] A username is required (-u <user>).'));
    return null;
  }
  const password: string = ask.password ?? (world.isTTY ? await world.ask(`Password for ${user} at ${door}: `, true) : '');
  if (password.length === 0) {
    world.warn(chalk.red('[!] A password is required on this way in.'));
    return null;
  }
  const minted = await door_loginForToken(door, user, password, name ?? tokenName_default(user, world), world.fetchLike);
  if ('refused' in minted) {
    world.warn(chalk.red(`[!] The door refused: ${minted.refused}`));
    return null;
  }
  return minted.grant;
}

async function byBrowser_login(door: string, world: AuthWorld): Promise<DoorTokenGrant | null> {
  const begun = await doorDevice_begin(door, world.hostname(), world.fetchLike);
  if ('refused' in begun) {
    world.warn(chalk.red(`[!] The door would not give a code: ${begun.refused}`));
    return null;
  }
  // The way gh does it: the code first, then a plain address to type it at.
  world.say('');
  world.say(`  ! First copy your one-time code: ${chalk.bold(begun.code)}`);
  world.say(`  Then open ${chalk.bold(`${door}device`)} on any device, log in, and enter the code.`);
  world.say(chalk.gray('  (waiting up to ten minutes; Ctrl-C to stop)'));
  world.say('');
  const outcome = await doorDevice_wait(door, begun.code, { fetchLike: world.fetchLike, deadlineMs: world.deviceWaitMs });
  if (outcome.state === 'expired') {
    world.warn(chalk.red('[!] The code was not entered in time; run chell auth login again.'));
    return null;
  }
  if (outcome.state === 'refused') {
    world.warn(chalk.red(`[!] The door stopped answering for the code: ${outcome.refused}`));
    return null;
  }
  return outcome.grant;
}

async function status_run(door: string, world: AuthWorld): Promise<number> {
  const credential = doorCredential_resolve(door, world.env);
  if ('refused' in credential) {
    world.warn(chalk.red(`[!] ${credential.refused}`));
    return 1;
  }
  const isDefault: boolean = doorDefault_read(world.env) === door;
  if (credential.kind === 'none') {
    world.say(`Not logged in at ${door}${isDefault ? ' (the default door)' : ''}; run chell auth login${isDefault ? '' : ` --door ${door}`}.`);
    const others: string[] = doorFiles_list(world.env);
    if (others.length > 0) world.say(chalk.gray(`    doors with a token on this machine: ${others.join(', ')}`));
    return 1;
  }
  if (credential.source === 'env') {
    world.say(`Logged in at ${door} by CHELL_DOOR_TOKEN${credential.user === null ? '' : ` as ${credential.user}`} (the environment, not a file).`);
    return 0;
  }
  const left: number = days_until(credential.expires ?? '', world.now());
  const life: string = left < 0 ? chalk.red(`died ${(credential.expires ?? '').slice(0, 10)}; run chell auth login`) : `dies ${(credential.expires ?? '').slice(0, 10)} (${left} days)`;
  world.say(`Logged in at ${door} as ${credential.user}${isDefault ? ' (the default door)' : ''}; token "${credential.name}" ${life}.`);
  world.say(chalk.gray(`    ${doorFile_path(door, world.env)}`));
  return left < 0 ? 1 : 0;
}

async function logout_run(door: string, world: AuthWorld): Promise<number> {
  const file = doorFile_read(door, world.env);
  if (file === null) {
    world.say(`Not logged in at ${door}; nothing to do.`);
    doorDefault_clear(door, world.env);
    return 0;
  }
  if ('refused' in file) {
    // A loose file still goes: that is the safe direction.
    world.warn(chalk.yellow(`[!] ${file.refused}`));
    doorFile_remove(door, world.env);
    doorDefault_clear(door, world.env);
    world.say(`Removed the door file for ${door}.`);
    return 0;
  }
  try {
    const revoked = await doorToken_revoke(door, file.token, world.fetchLike);
    if ('refused' in revoked) world.warn(chalk.yellow(`[!] The door did not revoke the token (${revoked.refused}); it dies ${file.expires.slice(0, 10)} on its own. An operator can revoke it: porter --revoke ${file.user} "${file.name}".`));
    else world.say(chalk.green(`[+] Revoked token "${file.name}" at ${door}.`));
  } catch (error: unknown) {
    world.warn(chalk.yellow(`[!] The door at ${door} could not be reached (${doorUnreached_reason(error)}); the token dies ${file.expires.slice(0, 10)} on its own.`));
  }
  doorFile_remove(door, world.env);
  doorDefault_clear(door, world.env);
  world.say(`Logged out of ${door}; the door file is gone.`);
  return 0;
}

async function token_run(ask: AuthAsk, door: string, world: AuthWorld): Promise<number> {
  if (!tokenTransport_check(door, ask, world)) return 1;
  let grant: DoorTokenGrant | null;
  try {
    grant = ask.withPassword || ask.password !== undefined || !world.isTTY
      ? await byPassword_login(ask, door, world, ask.name)
      : await byBrowser_login(door, world);
  } catch (error: unknown) {
    world.warn(chalk.red(`[!] The door at ${door} could not be reached: ${doorUnreached_reason(error)}`));
    return 1;
  }
  if (grant === null) return 1;
  // A browser login names the token after this host; the name asked for is
  // what the token is for, so it is said as asked.
  world.say(chalk.green(`[+] Minted token "${grant.name}" for ${grant.user} at ${door}; it dies ${grant.expires.slice(0, 10)} and is shown once:`));
  world.say(grant.token);
  world.say(chalk.gray('    carry it to the other machine: chell auth login --with-token (paste it there), or CHELL_DOOR_TOKEN for a runner.'));
  return 0;
}

async function tokens_run(door: string, world: AuthWorld): Promise<number> {
  const credential = doorCredential_resolve(door, world.env);
  if ('refused' in credential) {
    world.warn(chalk.red(`[!] ${credential.refused}`));
    return 1;
  }
  if (credential.kind === 'none') {
    world.warn(chalk.red(`[!] Not logged in at ${door}; run chell auth login first.`));
    return 1;
  }
  try {
    const listed = await doorTokens_list(door, credential.token, world.fetchLike);
    if ('refused' in listed) {
      world.warn(chalk.red(`[!] The door refused: ${listed.refused}`));
      return 1;
    }
    if (listed.tokens.length === 0) {
      world.say(`No door tokens for ${listed.user} at ${door}.`);
      return 0;
    }
    world.say(`Door tokens for ${listed.user} at ${door}:`);
    for (const token of listed.tokens) {
      const left: number = days_until(token.expires, world.now());
      const mine: string = credential.name === token.name ? '  ← this machine' : '';
      world.say(`  ${token.name.padEnd(28)} minted ${token.created.slice(0, 10)}  ${left < 0 ? 'died' : 'dies'} ${token.expires.slice(0, 10)}  ${token.lastUsed === null ? 'never used' : `last used ${token.lastUsed.slice(0, 10)}`}${mine}`);
    }
    return 0;
  } catch (error: unknown) {
    world.warn(chalk.red(`[!] The door at ${door} could not be reached: ${doorUnreached_reason(error)}`));
    return 1;
  }
}
