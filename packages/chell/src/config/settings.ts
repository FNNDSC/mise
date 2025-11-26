/**
 * @file Application Settings
 * Singleton configuration store.
 */

export interface ChellSettings {
  promptStyle: string;
  historySize: number;
}

class Settings {
  private static instance: Settings;
  public config: ChellSettings;

  private constructor() {
    this.config = {
      promptStyle: 'default',
      historySize: 1000,
    };
  }

  public static getInstance(): Settings {
    if (!Settings.instance) {
      Settings.instance = new Settings();
    }
    return Settings.instance;
  }
}

export const settings = Settings.getInstance();
