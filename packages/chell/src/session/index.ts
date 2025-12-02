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
    const nodeStorageProvider = new NodeStorageProvider();
    // Initialize the connection singleton which also initializes config
    this._connection = await chrisConnection_init(nodeStorageProvider);
  }

  /**
   * Get Current Working Directory from Context.
   */
  async getCWD(): Promise<string> {
    return await chrisContext.current_get(Context.ChRISfolder) || '/';
  }

  /**
   * Set Current Working Directory.
   */
  async setCWD(path: string): Promise<void> {
    await chrisContext.current_set(Context.ChRISfolder, path);
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
}

export const session = Session.getInstance();
