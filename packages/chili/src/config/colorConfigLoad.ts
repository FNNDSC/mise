/**
 * @file The color configuration's loader: read once, the file's or the
 * built-in fallback's, and a missing file said once per process.
 *
 * The published package once left `config/colors.yml` out, and every
 * caller that rendered a listing warned again, because only a successful
 * load was cached: one `ls` printed the warning four times (#966). The
 * loader now keeps whichever it got.
 *
 * Free of `import.meta` so it can be tested as it is; `colorConfig.ts`
 * names the file.
 *
 * @module
 */
import yaml from 'js-yaml';
import * as fs from 'fs';

/**
 * Interface for color style configuration.
 */
export interface ColorStyle {
  color: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
}

/**
 * Interface for icon configuration.
 */
export interface IconConfig {
  enabled: boolean;
  dir: string;
  file: string;
  link: string;
  plugin: string;
  pipeline: string;
  vfs: string;
}

/**
 * Interface for the complete color configuration.
 */
export interface ColorConfig {
  icons?: IconConfig;
  fileTypes: {
    dir: ColorStyle;
    file: ColorStyle;
    link: ColorStyle;
    plugin: ColorStyle;
    pipeline: ColorStyle;
    vfs: ColorStyle;
  };
  specialPaths: {
    [path: string]: ColorStyle;
  };
}

/** The colors used when the file cannot be read. */
export const COLOR_CONFIG_FALLBACK: ColorConfig = {
      icons: {
        enabled: true,
        dir: '\uF07C',
        file: '\uF15B',
        link: '\uF0C1',
        plugin: '\uF013',
        pipeline: '\uF013',
        vfs: '\uF0C8'
      },
      fileTypes: {
        dir: { color: 'cyan', bold: true },
        file: { color: 'white', bold: false },
        link: { color: 'magenta', bold: false },
        plugin: { color: 'green', bold: true },
        pipeline: { color: 'magenta', bold: true },
        vfs: { color: 'cyanBright', bold: true }
      },
      specialPaths: {
        '/bin': { color: 'cyan', bold: true },
        '~': { color: 'blue', bold: false }
      }
    };

/**
 * Makes a loader for a color file that reads it once and keeps what it
 * got: the file's configuration, or the fallback after one warning.
 *
 * @param configPath - The color file.
 * @param warn - Told once when the file cannot be read.
 * @returns The loader.
 */
export function colorConfigLoader_make(configPath: string, warn: (message: string) => void): () => ColorConfig {
  let kept: ColorConfig | null = null;
  return (): ColorConfig => {
    if (kept !== null) return kept;
    try {
      kept = yaml.load(fs.readFileSync(configPath, 'utf8')) as ColorConfig;
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      warn(`Warning: Could not load color config: ${msg}`);
      kept = COLOR_CONFIG_FALLBACK;
    }
    return kept;
  };
}
