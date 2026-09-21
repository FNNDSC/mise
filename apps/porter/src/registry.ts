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
import type { Berth } from './host/sessionHost.js';

/** One identity the door has let through. */
export interface SessionEntry {
  key: string;
  identity: string;
  user: string;
  berth: Berth;
}

/** The sessions the door knows, by key. */
export class SessionRegistry {
  private readonly byKey: Map<string, SessionEntry> = new Map();

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

  /** Looks a key up. */
  public get(key: string): SessionEntry | null {
    return this.byKey.get(key) ?? null;
  }

  /** Forgets a key. */
  public forget(key: string): void {
    this.byKey.delete(key);
  }

  /** Every entry, for a status listing. */
  public all(): SessionEntry[] {
    return [...this.byKey.values()];
  }
}
