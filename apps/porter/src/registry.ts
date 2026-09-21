/**
 * @file Who is behind which door.
 *
 * A browser names its session by a short key in the path — `/s/<key>/` —
 * never by the identity, which carries a URL with slashes in it and is the
 * operator's business, not the URL bar's. The key is the berth key calypso
 * already computes for the identity, so a porter restarted finds the same
 * key for the same operator. The registry maps key to identity and to the
 * berth the door last saw.
 *
 * @module
 */
import { berthKey_compute } from '@fnndsc/calypso/berth';
import type { Berth, SessionHost } from './host/sessionHost.js';

/** One identity the door has let through. */
export interface SessionEntry {
  key: string;
  identity: string;
  user: string;
  berth: Berth;
}

/** A session the door has admitted but whose berth has not answered yet. */
interface PendingEntry {
  key: string;
  identity: string;
  user: string;
}

/** The sessions the door knows, by key. */
export class SessionRegistry {
  private readonly byKey: Map<string, SessionEntry> = new Map();
  private readonly pending: Map<string, PendingEntry> = new Map();

  /**
   * The key an identity is addressed by.
   *
   * @param identity - The normalised identity.
   * @returns Sixteen hex characters, stable for the identity.
   */
  public key_of(identity: string): string {
    return berthKey_compute(identity);
  }

  /** Records an identity and the berth it answers at. */
  public note(identity: string, user: string, berth: Berth): SessionEntry {
    const entry: SessionEntry = { key: this.key_of(identity), identity, user, berth };
    this.byKey.set(entry.key, entry);
    return entry;
  }

  /** Records an identity whose session is booting; the berth comes later. */
  public pending_note(identity: string, user: string): void {
    const key: string = this.key_of(identity);
    if (this.byKey.has(key)) return;
    this.pending.set(key, { key, identity, user });
  }

  /** The identity behind a key, admitted or still booting. */
  public identity_of(key: string): string | null {
    return this.byKey.get(key)?.identity ?? this.pending.get(key)?.identity ?? null;
  }

  /**
   * Moves a booting identity into the registry once its berth answers.
   *
   * @param identity - The identity whose boot ended.
   * @param host - Where to read the berth from.
   * @returns The entry, or null when the boot ended without a berth.
   */
  public async settle(identity: string, host: Pick<SessionHost, 'find'>): Promise<SessionEntry | null> {
    const key: string = this.key_of(identity);
    const waiting: PendingEntry | undefined = this.pending.get(key);
    if (waiting === undefined) return this.byKey.get(key) ?? null;
    const berth: Berth | null = await host.find(identity);
    if (berth === null) return null;
    this.pending.delete(key);
    return this.note(identity, waiting.user, berth);
  }

  /** Looks a key up. */
  public get(key: string): SessionEntry | null {
    return this.byKey.get(key) ?? null;
  }

  /** Forgets a key. */
  public forget(key: string): void {
    this.byKey.delete(key);
    this.pending.delete(key);
  }

  /** Every entry, for a status listing. */
  public all(): SessionEntry[] {
    return [...this.byKey.values()];
  }
}
