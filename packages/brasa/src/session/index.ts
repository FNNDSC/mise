/**
 * @file Session Management.
 *
 * Maintains the global state of the shell, including connection and context.
 *
 * @module
 */
import { chrisConnection, chrisConnection_init, NodeStorageProvider, chrisContext, Context } from '@fnndsc/cumin';

/**
 * Manages the shell session state (Connection, Context).
 */
export class Session {
  private static instance: Session;
  private _connection: typeof chrisConnection | undefined;
  private _offline: boolean = false;
  private _physicalMode: boolean = false;
  private _timingEnabled: boolean = false;
  private _previousCWD: string | undefined;

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
   * Initialize the session (load config/token).
   */
  async init(): Promise<void> {
    const nodeStorageProvider: NodeStorageProvider = new NodeStorageProvider();
    // Initialize the connection singleton which also initializes config
    this._connection = await chrisConnection_init(nodeStorageProvider);

    try {
      // Also initialize chili's duplicate copy of the connection singleton to align monorepo package boundaries
      const { chrisConnection_init: chiliConnection_init } = await import('@fnndsc/chili/utils');
      await chiliConnection_init(nodeStorageProvider);
    } catch (e: unknown) {
      // Fail silently if chili utilities connection initialization is not needed/available
    }
  }

  /**
   * Get Current Working Directory from Context.
   */
  async getCWD(): Promise<string> {
    return await chrisContext.current_get(Context.ChRISfolder) || '/';
  }

  /**
   * Set Current Working Directory.
   * Cache invalidation is handled automatically by cumin's chrisContext.
   */
  async setCWD(path: string): Promise<void> {
    await chrisContext.current_set(Context.ChRISfolder, path);
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
   * Access the underlying ChRIS Connection singleton.
   */
  get connection() {
    return this._connection || chrisConnection;
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
}

/**
 * Shared Session singleton.
 */
export const session: Session = Session.getInstance();
