/**
 * @file ChELL Settings Configuration
 *
 * Manages application-level settings and preferences.
 *
 * @module
 */

import type { ThemeName } from '../core/prompt/index.js';

export interface Settings {
  config: {
    historyFile: string;
    historySize: number;
    /** Prompt theme — 'default' (single-line smart truncation) or 'p10k' (two-line segment bar). */
    promptTheme: ThemeName;
  };
}

export const settings: Settings = {
  config: {
    historyFile: '.chell_history',
    historySize: 1000,
    promptTheme: 'default',
  },
};
