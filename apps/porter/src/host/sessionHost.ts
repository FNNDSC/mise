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

/** Where sessions run. */
export interface SessionHost {
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
   * Ends an identity's session.
   *
   * @param identity - The normalised `<user>@<url>`.
   * @returns Whether there was one to end.
   */
  evict(identity: string): Promise<boolean>;
}
