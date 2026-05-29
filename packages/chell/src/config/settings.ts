/**
 * @file ChELL Settings Configuration
 *
 * Manages application-level settings and preferences.
 * Config file location follows platform conventions:
 *   Linux:   $XDG_CONFIG_HOME/chell/settings.json  (default ~/.config/chell/settings.json)
 *   macOS:   ~/Library/Application Support/chell/settings.json
 *   Windows: %APPDATA%\chell\settings.json
 *
 * @module
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ThemeName, P10kSegmentConfig } from '../core/prompt/index.js';
import { THEME_NAMES, P10K_OPTIONAL_SEGMENTS } from '../core/prompt/index.js';

export interface Settings {
  config: {
    historyFile: string;
    historySize: number;
    /** Prompt theme — 'default' (single-line smart truncation) or 'p10k' (two-line segment bar). */
    promptTheme: ThemeName;
    /** Which optional p10k segments are enabled. */
    p10kSegments: P10kSegmentConfig;
  };
}

/**
 * Returns the platform-appropriate config directory for chell.
 */
function configDir_get(): string {
  const platform: string = os.platform();
  const home: string = os.homedir();

  let base: string;
  if (platform === 'win32') {
    base = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    base = path.join(home, 'Library', 'Application Support');
  } else {
    base = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  }

  return path.join(base, 'chell');
}

const CONFIG_FILE: string = path.join(configDir_get(), 'settings.json');

export const settings: Settings = {
  config: {
    historyFile: '.chell_history',
    historySize: 1000,
    promptTheme: 'default',
    p10kSegments: { time: false, duration: false, status: false },
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
      if (obj.p10kSegments && typeof obj.p10kSegments === 'object') {
        const segs: Record<string, unknown> = obj.p10kSegments as Record<string, unknown>;
        for (const key of P10K_OPTIONAL_SEGMENTS) {
          if (typeof segs[key] === 'boolean') {
            settings.config.p10kSegments[key] = segs[key] as boolean;
          }
        }
      }
    }
  } catch {
    // No config file yet — use defaults
  }
}

export async function settings_save(): Promise<void> {
  try {
    await fs.promises.mkdir(configDir_get(), { recursive: true });
    const data: Record<string, unknown> = {
      promptTheme: settings.config.promptTheme,
      p10kSegments: settings.config.p10kSegments,
    };
    await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(data, null, 2) + '\n');
  } catch {
    // Silently fail
  }
}
