/**
 * @file Door tokens: how a script comes through the door without a password.
 *
 * A token is minted once by a human login (a browser code or a password)
 * and carried by scripts afterwards as `Authorization: Bearer …`. The door
 * keeps only its hash, with the identity it is for, a name the operator
 * can read (`cron@titan`), when it was minted and when it dies. A token
 * dies on its day: no sliding refresh, so a leaked key in steady use still
 * ends, and every script is re-blessed by a human on the horizon the
 * operator set (`PORTER_TOKEN_DAYS`). Revocation is by name.
 *
 * Device codes are the browser half of `chell auth login`: chell asks for
 * a short one-time code, the human opens the door's login page on any
 * device, logs in with the code, and the door hands chell the token it
 * minted. A code lives ten minutes and is taken once.
 *
 * The store is one JSON file at mode 0600 in the porter's own state, read
 * at start and written whole on every change through a same-directory
 * atomic rename; the plaintext is never in it.
 *
 * @module
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** What the plaintext starts with, so a token is recognisable in a log or a leak. */
export const DOOR_TOKEN_PREFIX: string = 'pdt_';

/** How long a device code waits to be authorised, in ms. */
export const DEVICE_CODE_LIFE_MS: number = 10 * 60 * 1000;

/** One token the door knows: everything but the plaintext. */
export interface DoorToken {
  /** The operator-readable name, unique per identity (`cron@titan`). */
  name: string;
  /** The canonical identity (`user@cubeUrl`) the token logs in as. */
  identity: string;
  /** The CUBE username, for lists and the journal. */
  user: string;
  /** SHA-256 of the plaintext, hex. */
  hash: string;
  /** ISO time it was minted. */
  created: string;
  /** ISO time it dies. */
  expires: string;
  /** ISO time it last let someone in, or null when never. */
  lastUsed: string | null;
}

/** What the store answers for a presented token. */
export type TokenCheck =
  | { ok: true; record: DoorToken }
  | { ok: false; why: 'unknown' }
  | { ok: false; why: 'expired'; record: DoorToken };

/** The file's shape on disk. */
interface TokenFile {
  schemaVersion: 1;
  tokens: DoorToken[];
}

/** Makes a fresh plaintext token: 32 random bytes, base64url, prefixed. */
export function token_make(): string {
  return `${DOOR_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** Hashes a plaintext token the way the store keeps it. */
export function token_hash(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/** Whether a string looks like a door token, before any lookup. */
export function token_looksLike(value: string): boolean {
  return value.startsWith(DOOR_TOKEN_PREFIX) && value.length > DOOR_TOKEN_PREFIX.length + 20;
}

/**
 * The door's token store: minted, checked, revoked, listed, persisted.
 */
export class TokenStore {
  private tokens: DoorToken[] = [];

  /**
   * @param path - The JSON file; its directory is made (0700) when missing.
   * @param days - How long a minted token lives.
   * @param now - The clock, replaceable in tests.
   */
  public constructor(
    private readonly path: string,
    private readonly days: number,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  /**
   * Reads the file. A missing file is an empty store; a file that does not
   * parse is refused loudly, since silently starting empty would let every
   * script's key stop working with no word why.
   */
  public load(): void {
    if (!existsSync(this.path)) {
      this.tokens = [];
      return;
    }
    const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Partial<TokenFile>).tokens)) {
      throw new Error(`the door's token store at ${this.path} is not a token file`);
    }
    this.tokens = (parsed as TokenFile).tokens;
  }

  /**
   * Mints a token for an identity. A token of the same name for the same
   * identity is replaced, so `login` again on the same host never leaves
   * a forgotten key behind.
   *
   * @param identity - The canonical identity.
   * @param user - The CUBE username.
   * @param name - The operator-readable name.
   * @returns The plaintext, shown once, and the record kept.
   */
  public mint(identity: string, user: string, name: string): { token: string; record: DoorToken } {
    const token: string = token_make();
    const created: Date = this.now();
    const record: DoorToken = {
      name,
      identity,
      user,
      hash: token_hash(token),
      created: created.toISOString(),
      expires: new Date(created.getTime() + this.days * 24 * 3600 * 1000).toISOString(),
      lastUsed: null,
    };
    this.tokens = this.tokens.filter((held: DoorToken): boolean => !(held.identity === identity && held.name === name));
    this.tokens.push(record);
    this.save();
    return { token, record };
  }

  /**
   * Checks a presented plaintext against the store, in constant time per
   * record, and says why when it fails.
   *
   * @param plain - The token as presented.
   * @returns The record when it lets someone in.
   */
  public check(plain: string): TokenCheck {
    const presented: Buffer = Buffer.from(token_hash(plain), 'hex');
    for (const record of this.tokens) {
      const kept: Buffer = Buffer.from(record.hash, 'hex');
      if (kept.length !== presented.length || !timingSafeEqual(kept, presented)) continue;
      if (Date.parse(record.expires) <= this.now().getTime()) return { ok: false, why: 'expired', record };
      return { ok: true, record };
    }
    return { ok: false, why: 'unknown' };
  }

  /**
   * Notes that a token just let someone in.
   *
   * @param record - The token that did.
   */
  public touch(record: DoorToken): void {
    record.lastUsed = this.now().toISOString();
    this.save();
  }

  /**
   * Revokes a user's tokens: one by name, or all of them.
   *
   * @param user - The CUBE username.
   * @param name - The token's name, or undefined for every one of the user's.
   * @returns How many went.
   */
  public revoke(user: string, name?: string): number {
    const before: number = this.tokens.length;
    this.tokens = this.tokens.filter((held: DoorToken): boolean => !(held.user === user && (name === undefined || held.name === name)));
    if (this.tokens.length !== before) this.save();
    return before - this.tokens.length;
  }

  /** @returns Every token the door knows, as kept (no plaintext exists to show). */
  public list(): DoorToken[] {
    return [...this.tokens];
  }

  /** Writes the whole store, mode 0600, through a same-directory atomic rename. */
  private save(): void {
    const file: TokenFile = { schemaVersion: 1, tokens: this.tokens };
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary: string = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.path);
    chmodSync(this.path, 0o600);
  }
}

/** What a device code hands chell once a human authorised it. */
export interface DeviceGrant {
  token: string;
  user: string;
  name: string;
  expires: string;
}

/** One code waiting, authorised, or spent. */
interface DeviceCode {
  /** The host chell runs on, for the page ("authorise chell on titan") and the token's name. */
  host: string;
  issued: number;
  grant: DeviceGrant | null;
}

/** The letters a code is made of: no 0/O, 1/I/L, so it survives being read aloud. */
const CODE_ALPHABET: string = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Makes a code like `K7PD-3MXQ`. */
export function deviceCode_make(): string {
  const bytes: Buffer = randomBytes(8);
  let code: string = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += CODE_ALPHABET[(bytes[i] as number) % CODE_ALPHABET.length];
  }
  return code;
}

/** Normalises a code as a human might type it: upper case, the dash optional. */
export function deviceCode_normalise(typed: string): string {
  const letters: string = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return letters.length === 8 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : typed.trim().toUpperCase();
}

/**
 * The device codes the door has out: issued by chell, authorised by a human
 * on the login page, taken once by chell's poll.
 */
export class DeviceCodes {
  private readonly codes: Map<string, DeviceCode> = new Map();

  public constructor(private readonly now: () => number = (): number => Date.now()) {}

  /**
   * Issues a code for a chell on a host.
   *
   * @param host - Where chell runs.
   * @returns The code and when it stops being accepted.
   */
  public issue(host: string): { code: string; expires: string } {
    this.sweep();
    let code: string = deviceCode_make();
    while (this.codes.has(code)) code = deviceCode_make();
    const issued: number = this.now();
    this.codes.set(code, { host, issued, grant: null });
    return { code, expires: new Date(issued + DEVICE_CODE_LIFE_MS).toISOString() };
  }

  /**
   * Looks a code up for the login page.
   *
   * @param code - As typed.
   * @returns The host chell runs on, or null when the code is not out.
   */
  public host_of(code: string): string | null {
    this.sweep();
    const held: DeviceCode | undefined = this.codes.get(deviceCode_normalise(code));
    return held === undefined || held.grant !== null ? null : held.host;
  }

  /**
   * Authorises a code: a human logged in with it.
   *
   * @param code - As typed.
   * @param grant - What chell gets.
   * @returns Whether the code was waiting.
   */
  public authorise(code: string, grant: DeviceGrant): boolean {
    this.sweep();
    const held: DeviceCode | undefined = this.codes.get(deviceCode_normalise(code));
    if (held === undefined || held.grant !== null) return false;
    held.grant = grant;
    return true;
  }

  /**
   * Chell's poll: the grant once, pending while the human has not yet
   * logged in, unknown after the code died or was taken.
   *
   * @param code - As chell was given it.
   */
  public take(code: string): { state: 'pending' } | { state: 'unknown' } | { state: 'authorised'; grant: DeviceGrant } {
    this.sweep();
    const held: DeviceCode | undefined = this.codes.get(code);
    if (held === undefined) return { state: 'unknown' };
    if (held.grant === null) return { state: 'pending' };
    this.codes.delete(code);
    return { state: 'authorised', grant: held.grant };
  }

  /** Forgets codes past their life. */
  private sweep(): void {
    const cutoff: number = this.now() - DEVICE_CODE_LIFE_MS;
    for (const [code, held] of this.codes) {
      if (held.issued < cutoff) this.codes.delete(code);
    }
  }
}
