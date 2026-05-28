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
 * Data available to every prompt theme at render time.
 *
 * @property user - Authenticated ChRIS username.
 * @property uri - Full CUBE API URL.
 * @property cwd - Current working directory path.
 * @property pacsserver - Active PACS server identifier, or null if unset.
 * @property physicalMode - Whether physical (non-logical) path mode is active.
 * @property terminalWidth - Current terminal column count.
 */
export interface PromptContext {
  user: string;
  uri: string;
  cwd: string;
  pacsserver: string | null;
  physicalMode: boolean;
  terminalWidth: number;
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
