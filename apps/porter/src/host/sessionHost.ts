/**
 * @file The seam between the door and wherever sessions run.
 *
 * On one host a session is a child process in four directories of its own;
 * on a cluster it is a pod with a volume. The porter never knows which: it
 * asks the host to find an identity's session, to start one with a token,
 * and to end one, and it gets back a berth — an address and an attach
 * token — either way. This is the `BerthResolver` seam of tier 1 walked
 * through: the surface's attach path did not change for identity-keyed
 * daemons, and the door's does not change for pods.
 *
 * @module
 */
import type { Berth } from '@fnndsc/calypso/berth';

export type { Berth };

/** One line of a session's boot, as the host saw it. */
export interface BootLine {
  /** Which stream it came off. */
  channel: 'out' | 'err';
  /** The line, ANSI and all: the greeter renders it as the terminal would. */
  text: string;
  /** The row's number in this boot, so a later line can settle it in place. */
  id?: number;
  /**
   * The row this line settles: a `[PENDING]` or `[RETRY]` row of the same
   * label, printed earlier. On a terminal the boot logger rewrites that row
   * where it stands; off one (as under porter) it can only append, so the
   * host matches the label and the greeter does the rewriting.
   */
  replaces?: number;
}

/** A boot in progress, or finished, as a host reports it. */
export interface BootReport {
  /** Every line so far, in order. */
  lines: BootLine[];
  /** Whether the session is up (berth answering), still booting, or gone. */
  state: 'booting' | 'ready' | 'failed';
  /** What went wrong, when the state is `failed`. */
  reason?: string;
}

/** Who to tell as a boot proceeds. */
export interface BootListener {
  line(line: BootLine): void;
  done(state: 'ready' | 'failed', reason?: string): void;
}

/** One session a host knows of, for a listing. */
export interface SessionSighting {
  identity: string;
  berth: Berth;
  alive: boolean;
}

/** Where sessions run. */
export interface SessionHost {
  /**
   * Finds every session this host holds a berth for, alive or not, and
   * takes the live ones under its wing — a porter restarted adopts the
   * fleet its predecessor started rather than starting rivals.
   *
   * @returns Every berth found, with whether its daemon answers.
   */
  sessions_adopt(): Promise<SessionSighting[]>;

  /**
   * Finds an identity's live session.
   *
   * @param identity - The normalised `<user>@<url>`.
   * @returns Its berth, or null when no session of theirs answers.
   */
  find(identity: string): Promise<Berth | null>;

  /**
   * Starts an identity's session with a CUBE token, or joins one already
   * starting; resolves once its berth answers.
   *
   * @param identity - The normalised `<user>@<url>`.
   * @param user - The CUBE username.
   * @param cubeUrl - The CUBE API base.
   * @param token - The CUBE token the door minted; the session's only credential.
   * @returns The berth.
   * @throws {Error} When the session does not come up.
   */
  spawn(identity: string, user: string, cubeUrl: string, token: string): Promise<Berth>;

  /**
   * Starts an identity's session and returns at once: the boot is followed
   * through {@link boot_follow}, and its end — ready, or failed with a
   * reason — is recorded there rather than thrown to anyone.
   *
   * @param identity - The normalised `<user>@<url>`.
   * @param user - The CUBE username.
   * @param cubeUrl - The CUBE API base.
   * @param token - The CUBE token the door minted.
   */
  spawn_begin(identity: string, user: string, cubeUrl: string, token: string): void;

  /**
   * Reads what a session's boot has said so far, and follows it.
   *
   * @param identity - The normalised `<user>@<url>`.
   * @param listener - Told each line from now on, and the end.
   * @returns The lines so far and the state now, or null when the host has
   *   no boot on record for this identity. The listener is released when
   *   the boot ends or when the returned function is called.
   */
  boot_follow(identity: string, listener: BootListener): { report: BootReport; release: () => void } | null;

  /**
   * Ends an identity's session, leaving the daemon the reason so it can tell
   * its surfaces before it goes.
   *
   * @param identity - The normalised `<user>@<url>`.
   * @param cause - Why: an administrator's end by default.
   * @returns Whether there was one to end.
   */
  evict(identity: string, cause?: 'restart' | 'end'): Promise<boolean>;

  /**
   * Restarts an identity's session and returns at once: the old daemon is
   * told why and ended, and a fresh one boots on the token the session saved
   * — the operator's password is not asked again. The whole of it is one
   * boot, followed through {@link boot_follow} from the first word, so a
   * greeter never sees a gap; a saved token the server refuses ends the boot
   * failed, with the reason.
   *
   * @param identity - The normalised `<user>@<url>`.
   * @param user - The CUBE username.
   * @param cubeUrl - The CUBE API base.
   */
  restart_begin(identity: string, user: string, cubeUrl: string): void;
}
