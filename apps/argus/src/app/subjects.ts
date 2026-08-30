/**
 * @file The subject bus: pane linkage as hub-and-spoke subjects.
 *
 * Panes never link to each other; they subscribe to named subjects, and the
 * first subject is *regard* — the addressable thing the operator most
 * recently indicated. Each pane sits in one link group (possibly of one);
 * a regard write lands in the writer's group as a retained cell (last write
 * wins), and a late-joining subscriber immediately receives the retained
 * value. A group dies with its last member; nothing is retained past that.
 *
 * The bus is the surface's group layer. The session layer — the kernel's
 * one answer to "what is the operator regarding" — is fed through the
 * write observer, which the composer wires to the daemon; the bus itself
 * knows nothing of the wire. Design record: docs/aegis.adoc.
 *
 * @module
 */

/** One indication: an address in the namespace, with the model kind it was indicated through. */
export interface RegardIndication {
  address: string;
  modelKind?: string;
}

/** The retained regard of one group: the indication plus its writer. */
export interface RegardValue extends RegardIndication {
  paneId: string;
}

/** A group-regard subscriber. */
export type RegardSubscriber = (value: RegardValue) => void;

/** Observes every write, for the session layer (the wire). */
export type RegardWriteObserver = (value: RegardValue, groupId: string) => void;

/** One link group: its retained cell and its subscribers. */
interface LinkGroup {
  value: RegardValue | null;
  subscribers: Map<string, RegardSubscriber>;
  /** Members that render regard (viewers); their presence relieves writers of inline duty. */
  viewers: Set<string>;
}

/**
 * The surface-local subject bus.
 */
export class SubjectBus {
  private readonly groups: Map<string, LinkGroup> = new Map();
  private readonly membership: Map<string, string> = new Map();
  private writeObserver: RegardWriteObserver | null = null;

  /**
   * Sets the observer every write also flows to (the session layer).
   *
   * @param observer - The write observer.
   */
  public writeObserver_set(observer: RegardWriteObserver): void {
    this.writeObserver = observer;
  }

  /**
   * Joins a pane to a link group, creating the group on first join.
   *
   * @param paneId - The joining pane.
   * @param groupId - The group to join.
   */
  public pane_join(paneId: string, groupId: string): void {
    this.pane_leave(paneId);
    this.membership.set(paneId, groupId);
    if (!this.groups.has(groupId)) {
      this.groups.set(groupId, { value: null, subscribers: new Map(), viewers: new Set() });
    }
  }

  /**
   * Removes a pane from its group: subscription, viewer mark, membership.
   * The group itself dies with its last member — nothing is retained.
   *
   * @param paneId - The leaving pane.
   */
  public pane_leave(paneId: string): void {
    const groupId: string | undefined = this.membership.get(paneId);
    if (groupId === undefined) {
      return;
    }
    this.membership.delete(paneId);
    const group: LinkGroup | undefined = this.groups.get(groupId);
    if (group === undefined) {
      return;
    }
    group.subscribers.delete(paneId);
    group.viewers.delete(paneId);
    for (const member of this.membership.values()) {
      if (member === groupId) {
        return;
      }
    }
    this.groups.delete(groupId);
  }

  /**
   * Returns the pane's group, enrolling loners in a group of their own.
   *
   * @param paneId - The pane.
   * @returns The pane's group id.
   */
  public group_of(paneId: string): string {
    const existing: string | undefined = this.membership.get(paneId);
    if (existing !== undefined) {
      return existing;
    }
    this.pane_join(paneId, paneId);
    return paneId;
  }

  /**
   * Marks a pane as its group's viewer: the member that renders regard.
   *
   * @param paneId - The viewer pane.
   */
  public viewer_mark(paneId: string): void {
    const group: LinkGroup | undefined = this.groups.get(this.group_of(paneId));
    group?.viewers.add(paneId);
  }

  /**
   * Whether a pane's group has a viewer member. A writer with no viewer in
   * its group renders its own regard inline (the overlay rule).
   *
   * @param paneId - Any member pane.
   * @returns True when a viewer is present in the pane's group.
   */
  public groupHasViewer(paneId: string): boolean {
    const group: LinkGroup | undefined = this.groups.get(this.group_of(paneId));
    return group !== undefined && group.viewers.size > 0;
  }

  /**
   * Writes the group's regard: retained, last write wins, subscribers
   * notified, and the write observer (the session layer) fed.
   *
   * @param paneId - The writing pane.
   * @param indication - The indicated address.
   */
  public regard_write(paneId: string, indication: RegardIndication): void {
    const groupId: string = this.group_of(paneId);
    const group: LinkGroup = this.groups.get(groupId) as LinkGroup;
    const value: RegardValue = { ...indication, paneId };
    group.value = value;
    for (const subscriber of group.subscribers.values()) {
      subscriber(value);
    }
    this.writeObserver?.(value, groupId);
  }

  /**
   * Subscribes a pane to its group's regard. The retained value, when one
   * exists, is replayed immediately — a late joiner sees the current
   * indication rather than waiting for the next.
   *
   * @param paneId - The subscribing pane (already a group member).
   * @param subscriber - Called on every write, and once now when a value is retained.
   */
  public regard_subscribe(paneId: string, subscriber: RegardSubscriber): void {
    const group: LinkGroup = this.groups.get(this.group_of(paneId)) as LinkGroup;
    group.subscribers.set(paneId, subscriber);
    if (group.value !== null) {
      subscriber(group.value);
    }
  }

  /**
   * Returns a group's retained regard through any member pane.
   *
   * @param paneId - Any member pane.
   * @returns The retained value, or null before the first write.
   */
  public regard_get(paneId: string): RegardValue | null {
    return this.groups.get(this.group_of(paneId))?.value ?? null;
  }
}
