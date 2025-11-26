/**
 * @file Application Settings
 * Singleton configuration store.
 */

/**
 * Settings for the ChELL application.
 */
export interface ChellSettings {
  promptStyle: string;
  historySize: number;
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
