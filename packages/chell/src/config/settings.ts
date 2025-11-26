/**
 * @file Application Settings
 * Singleton configuration store.
 */
import * as os from 'os';
import * as path from 'path';

/**
 * Settings for the ChELL application.
 */
export interface ChellSettings {
  promptStyle: string;
  historySize: number;
  historyFile: string;
}

/**
 * Singleton class to manage ChELL application settings.
 */
class Settings {
  private static instance: Settings;
  public config: ChellSettings;

  /**
   * Initializes default settings.
   */
  private constructor() {
    this.config = {
      promptStyle: 'default',
      historySize: 1000,
      historyFile: path.join(os.homedir(), '.chell_history'),
    };
  }

  /**
   * Returns the singleton instance of the Settings.
   * @returns The Settings instance.
   */
  public static getInstance(): Settings {
    if (!Settings.instance) {
      Settings.instance = new Settings();
    }
    return Settings.instance;
  }
}

export const settings = Settings.getInstance();
