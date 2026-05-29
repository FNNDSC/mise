/**
 * @file ChELL Settings Configuration
 *
 * Manages application-level settings and preferences.
 *
 * @module
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ThemeName } from '../core/prompt/index.js';
import { THEME_NAMES } from '../core/prompt/index.js';

export interface Settings {
  config: {
    historyFile: string;
    historySize: number;
    /** Prompt theme — 'default' (single-line smart truncation) or 'p10k' (two-line segment bar). */
    promptTheme: ThemeName;
  };
}

const CONFIG_FILE: string = path.join(os.homedir(), '.chell_config.json');

export const settings: Settings = {
  config: {
    historyFile: '.chell_history',
    historySize: 1000,
    promptTheme: 'default',
  },
};

export async function settings_load(): Promise<void> {
  try {
    const raw: string = await fs.promises.readFile(CONFIG_FILE, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const obj: Record<string, unknown> = parsed as Record<string, unknown>;
      if (typeof obj.promptTheme === 'string' && THEME_NAMES.includes(obj.promptTheme as ThemeName)) {
        settings.config.promptTheme = obj.promptTheme as ThemeName;
      }
    }
  } catch {
    // No config file yet — use defaults
  }
}

export async function settings_save(): Promise<void> {
  try {
    const data: Record<string, unknown> = {
      promptTheme: settings.config.promptTheme,
    };
    await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(data, null, 2) + '\n');
  } catch {
    // Silently fail
  }
}
