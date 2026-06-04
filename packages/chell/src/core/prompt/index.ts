/**
 * @file Prompt theme registry.
 *
 * Defines the PromptContext data bag and PromptTheme interface, and wires
 * named themes to the theme registry used by the REPL.
 *
 * @module
 */

import { ThemeDefault } from './theme_default.js';
import { ThemeP10k } from './theme_p10k.js';

/**
 * Which optional p10k segments are enabled.
 *
 * @property pacs - Show PACS server segment (when a server is set in context).
 * @property time - Show current time (HH:MM).
 * @property duration - Show last command duration when ≥3s.
 * @property status - Show last exit code when non-zero.
 */
export interface P10kSegmentConfig {
  pacs: boolean;
  time: boolean;
  duration: boolean;
  status: boolean;
}

/**
 * Data available to every prompt theme at render time.
 *
 * @property user - Authenticated ChRIS username.
 * @property uri - Full CUBE API URL.
 * @property cwd - Current working directory path.
 * @property pacsserver - Active PACS server identifier, or null if unset.
 * @property physicalMode - Whether physical (non-logical) path mode is active.
 * @property terminalWidth - Current terminal column count.
 * @property lastExitCode - Exit code of the last command (0 = success).
 * @property lastCommandDurationMs - Wall-clock duration of the last command in ms.
 * @property p10kSegments - Which optional p10k segments are enabled.
 */
export interface PromptContext {
  user: string;
  uri: string;
  cwd: string;
  pacsserver: string | null;
  physicalMode: boolean;
  terminalWidth: number;
  lastExitCode: number;
  lastCommandDurationMs: number;
  p10kSegments: P10kSegmentConfig;
  /** Present while /proc topology warm-up is in progress. */
  procWarmup?: { loaded: number; total: number };
}

/**
 * Contract every prompt theme must satisfy.
 */
export interface PromptTheme {
  /**
   * Renders the full prompt string passed to readline.setPrompt().
   * May contain a single `\n` to produce a two-line prompt; readline
   * uses only the last line's visible width for cursor positioning.
   *
   * @param ctx - Current prompt context.
   * @returns Prompt string (ANSI codes allowed).
   */
  render(ctx: PromptContext): string;
}

export type ThemeName = 'default' | 'p10k';

/** All registered theme names, in the order they appear in the registry. */
export const THEME_NAMES: readonly ThemeName[] = ['default', 'p10k'] as const;

/** Names of optional p10k segments the user can toggle. */
export const P10K_OPTIONAL_SEGMENTS: readonly (keyof P10kSegmentConfig)[] =
  ['pacs', 'time', 'duration', 'status'] as const;

const registry: Record<ThemeName, PromptTheme> = {
  default: new ThemeDefault(),
  p10k: new ThemeP10k(),
};

/**
 * Renders the prompt using the named theme.
 *
 * @param theme - Theme identifier; falls back to 'default' if unknown.
 * @param ctx - Current prompt context.
 * @returns Prompt string ready for readline.setPrompt().
 */
export function prompt_render(theme: ThemeName, ctx: PromptContext): string {
  return (registry[theme] ?? registry.default).render(ctx);
}
