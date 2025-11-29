/**
 * @file ChELL Settings Configuration
 *
 * Manages application-level settings and preferences.
 *
 * @module
 */

export interface Settings {
  config: {
    historyFile: string;
    historySize: number;
  };
}

export const settings: Settings = {
  config: {
    historyFile: '.chell_history',
    historySize: 1000
  }
};
