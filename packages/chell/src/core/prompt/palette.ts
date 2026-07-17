/**
 * @file Shared high-contrast prompt colour palette.
 *
 * Provides vivid Powerlevel10k-inspired truecolor accents for both the compact
 * default prompt and the background-filled powerline theme.
 *
 * Prompt themes consume these values through Chalk, which preserves truecolor
 * where supported and performs any terminal-level colour downgrade.
 *
 * @module
 */

/** CSS-style hexadecimal colour accepted by Chalk's `hex` methods. */
export type HexColor = `#${string}`;

/** Foreground/background colours for one powerline segment. */
export interface PromptColorPair {
  bg: HexColor;
  fg: HexColor;
}

/** Complete colour vocabulary shared by ChELL prompt themes. */
export interface PromptPalette {
  HOST: PromptColorPair;
  PACS: PromptColorPair;
  USER: PromptColorPair;
  DIR: PromptColorPair;
  PHYSICAL: PromptColorPair;
  TIME: PromptColorPair;
  DURATION: PromptColorPair;
  STATUS: PromptColorPair;
  SUCCESS: HexColor;
  ERROR: HexColor;
  WARMUP: HexColor;
}

/** Vivid truecolor palette modelled after Powerlevel10k's rainbow style. */
export const PROMPT_PALETTE: PromptPalette = {
  HOST:     { bg: '#00AFFF', fg: '#001018' },
  PACS:     { bg: '#875FFF', fg: '#FFFFFF' },
  USER:     { bg: '#00D787', fg: '#00140C' },
  DIR:      { bg: '#FFD75F', fg: '#201800' },
  PHYSICAL: { bg: '#FF5F5F', fg: '#1B0000' },
  TIME:     { bg: '#5F5F87', fg: '#FFFFFF' },
  DURATION: { bg: '#FF8700', fg: '#201000' },
  STATUS:   { bg: '#FF005F', fg: '#FFFFFF' },
  SUCCESS:  '#00D787',
  ERROR:    '#FF005F',
  WARMUP:   '#AF87FF',
};

/**
 * Selects the prompt accent for the previous command's exit status.
 *
 * @param exitCode - Previous command's process exit code.
 * @returns Success colour for zero; error colour otherwise.
 */
export function statusColor_get(exitCode: number): HexColor {
  return exitCode === 0 ? PROMPT_PALETTE.SUCCESS : PROMPT_PALETTE.ERROR;
}
