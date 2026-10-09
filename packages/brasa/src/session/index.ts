/**
 * @file Session Management.
 *
 * Maintains the global state of the shell. What the session stores beyond
 * this process (its working directory, its home) the installed backend keeps.
 *
 * @module
 */
import type { Regard } from '@fnndsc/menu';
import { backend_get } from '../core/backend.js';

/**
 * Manages the shell session state (Connection, Context).
 */
export class Session {
  private static instance: Session;
  private _offline: boolean = false;
  private _physicalMode: boolean = false;
  private _timingEnabled: boolean = false;
  private _previousCWD: string | undefined;
  private _regard: Regard | null = null;

  /**
   * Private constructor for Singleton.
   */
  private constructor() {}

  /**
   * Returns the singleton instance of the Session.
   */
  static getInstance(): Session {
    if (!Session.instance) {
      Session.instance = new Session();
    }
    return Session.instance;
  }

  /**
   * Initialize the session: the backend prepares its own state.
   */
  async init(): Promise<void> {
    await backend_get().session.init();
  }

  /**
   * The current working directory: what the backend stores for the
   * identity, or, before it has stored anything, the identity's home.
   *
   * A first session used to begin at `/`, which is a place nobody works
   * in — the operator's own words: "she should be in the user's homedir".
   * A shell lands in the home; so does this one. A stored directory is
   * always honoured, `/` included, since the operator put it there.
   */
  async getCWD(): Promise<string> {
    const stored: string | null = await backend_get().session.cwd_load();
    if (stored) return stored;
    return backend_get().session.home_get();
  }

  /**
   * Set Current Working Directory: the backend stores it for the identity.
   */
  async setCWD(path: string): Promise<void> {
    await backend_get().session.cwd_save(path);
  }

  /**
   * Changes directory as an interactive `cd` operation while retaining the
   * previous directory for `cd -`.
   *
   * Other temporary context changes use {@link setCWD} directly and therefore
   * do not disturb interactive navigation history.
   *
   * @param path - New current working directory.
   * @returns Nothing.
   */
  async directory_change(path: string): Promise<void> {
    const current: string = await this.getCWD();
    if (current !== path) this._previousCWD = current;
    await this.setCWD(path);
  }

  /**
   * Returns the directory immediately preceding the latest interactive change.
   *
   * @returns Previous directory, or undefined when none exists in this session.
   */
  previousCWD_get(): string | undefined {
    return this._previousCWD;
  }
  
  /**
   * Get offline status.
   */
  get offline(): boolean {
    return this._offline;
  }

  /**
   * Set offline status.
   */
  set offline(value: boolean) {
    this._offline = value;
  }

  /**
   * Gets physical filesystem mode status.
   *
   * When true, path operations work directly with physical paths
   * without logical-to-physical mapping.
   *
   * @returns True if in physical mode, false if using logical paths.
   */
  physicalMode_get(): boolean {
    return this._physicalMode;
  }

  /**
   * Sets physical filesystem mode.
   *
   * @param enabled - True to enable physical mode, false for logical mode.
   */
  physicalMode_set(enabled: boolean): void {
    this._physicalMode = enabled;
  }

  /**
   * Gets timing mode status.
   *
   * When true, command execution times are displayed after each command.
   *
   * @returns True if timing is enabled, false otherwise.
   */
  timingEnabled_get(): boolean {
    return this._timingEnabled;
  }

  /**
   * Sets timing mode.
   *
   * @param enabled - True to enable timing display, false to disable.
   */
  timingEnabled_set(enabled: boolean): void {
    this._timingEnabled = enabled;
  }

  /**
   * Returns the session's retained regard: the addressable thing the operator
   * most recently indicated on any surface, or null before the first
   * indication. Last write wins; the value survives surface reattachment for
   * the life of the session.
   *
   * @returns The retained regard, or null when nothing has been indicated.
   */
  regard_get(): Regard | null {
    return this._regard;
  }

  /**
   * Retains a regard write from a surface.
   *
   * @param regard - The indicated address with its provenance.
   */
  regard_set(regard: Regard): void {
    this._regard = regard;
  }
}

/**
 * Shared Session singleton.
 */
export const session: Session = Session.getInstance();
