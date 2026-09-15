/**
 * @file The dormant set: link groups that have left the stage but are not
 * gone.
 *
 * A group is the unit of restoration. When it leaves the stage — a gutter
 * domain switch, a restore that displaces it, its last on-stage pane closed —
 * its live panes are disposed (their engines freed), but a small SNAPSHOT of
 * what it was is kept here so it can be brought back. The snapshot is not the
 * pane; it is the facts a replay needs: the series or volume it regarded, the
 * image view state (layout, slice, window/level, colormap, ghost), which panes
 * it held, and a thumbnail of the viewer. Restoring re-opens from those facts.
 *
 * Holding a snapshot costs almost nothing, so the cap exists only to keep the
 * PANES view legible over a long session, not because retention is expensive.
 * The least-recently-on-stage group falls off first; nothing recently touched
 * is ever evicted. The set survives a reload through the surface's own
 * localStorage, rehydrated dormant — a reload restores the cards, never the
 * stage.
 *
 * @module
 */

/** The image view state a snapshot restores. */
export interface GroupView {
  layout: string;
  slice: number;
  voi?: { lower: number; upper: number } | null;
  ghost?: number | null;
  colormap?: string;
}

/** One dormant group: enough to bring it back, and to show it as a card. */
export interface GroupSnapshot {
  /** Stable identity: the anchor's address (one series is one group). */
  id: string;
  /** What the card reads, derived from the anchor (series description, folder). */
  label: string;
  /** The anchor the group regards. */
  regard: { address: string; modelKind: string };
  /** Member kinds for the card's badges: `viewer`, `tags`, `files`. */
  members: string[];
  /** The image view state, when the group holds a viewer. */
  view?: GroupView;
  /** A small raster of the viewer at dormancy, as a data URL. */
  thumbnail?: string;
  /** When the group last left the stage, epoch ms — the LRU key. */
  lastTouched: number;
}

/** How many dormant groups the set holds before the oldest falls off. */
export const DORMANT_CAP: number = 24;

/** The localStorage key the dormant set persists under, per surface. */
const STORE_KEY: string = 'argus.dormant';

/** A minimal key-value store; localStorage in the browser, injected in tests. */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The dormant set of link groups, newest-first, LRU-capped, persisted.
 */
export class DormantRegistry {
  private readonly groups: Map<string, GroupSnapshot> = new Map<string, GroupSnapshot>();

  /**
   * @param cap - How many groups to hold before evicting the oldest.
   * @param store - Where to persist; a wrapped localStorage by default,
   *   omitted (and persistence skipped) when storage is unavailable.
   */
  constructor(private readonly cap: number = DORMANT_CAP, private readonly store?: KeyStore) {
    this.rehydrate();
  }

  /**
   * Records or refreshes a group's snapshot, bumps it to most-recent, evicts
   * the oldest past the cap, and persists.
   *
   * @param snapshot - The group snapshot; its `id` is the identity.
   */
  public add(snapshot: GroupSnapshot): void {
    this.groups.delete(snapshot.id);
    this.groups.set(snapshot.id, snapshot);
    while (this.groups.size > this.cap) {
      const oldest: string | undefined = this.oldest_id();
      if (oldest === undefined) break;
      this.groups.delete(oldest);
    }
    this.persist();
  }

  /** The groups, most-recently-dormant first. */
  public list(): GroupSnapshot[] {
    return [...this.groups.values()].sort((a, b): number => b.lastTouched - a.lastTouched);
  }

  /**
   * Reads one group's snapshot.
   *
   * @param id - The group's id.
   * @returns The snapshot, or undefined when the set does not hold it.
   */
  public get(id: string): GroupSnapshot | undefined {
    return this.groups.get(id);
  }

  /** Whether the set holds a group. */
  public has(id: string): boolean {
    return this.groups.has(id);
  }

  /**
   * Forgets a group — the one explicit destroy. Persists.
   *
   * @param id - The group's id.
   * @returns True when a group was removed.
   */
  public dismiss(id: string): boolean {
    const had: boolean = this.groups.delete(id);
    if (had) this.persist();
    return had;
  }

  /** The id of the least-recently-dormant group. */
  private oldest_id(): string | undefined {
    let oldest: GroupSnapshot | undefined;
    for (const snapshot of this.groups.values()) {
      if (oldest === undefined || snapshot.lastTouched < oldest.lastTouched) oldest = snapshot;
    }
    return oldest?.id;
  }

  /** Writes the set to the store, swallowing a storage that refuses. */
  private persist(): void {
    if (this.store === undefined) return;
    try {
      this.store.setItem(STORE_KEY, JSON.stringify([...this.groups.values()]));
    } catch {
      // A private window, blocked or full storage: the set stays in memory.
    }
  }

  /** Reads the set back on construction; a bad or absent value leaves it empty. */
  private rehydrate(): void {
    if (this.store === undefined) return;
    try {
      const raw: string | null = this.store.getItem(STORE_KEY);
      if (raw === null) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed as GroupSnapshot[]) {
        if (entry !== null && typeof entry === 'object' && typeof entry.id === 'string') this.groups.set(entry.id, entry);
      }
    } catch {
      // Unreadable storage: start empty rather than throw on boot.
    }
  }
}

/** localStorage wrapped as a KeyStore, or undefined where it is unavailable. */
export function localKeyStore(): KeyStore | undefined {
  try {
    const probe: Storage | undefined = globalThis.localStorage;
    if (probe === undefined) return undefined;
    // Touch it: a private window throws on access, not just on write.
    probe.getItem(STORE_KEY);
    return probe;
  } catch {
    return undefined;
  }
}
