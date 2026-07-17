/**
 * @file User-visible prompt theme behavior.
 *
 * Exercises the public prompt renderer so path and colour presentation remain
 * consistent across the default and Powerlevel10k-inspired themes.
 *
 * The suite depends on Chalk and temporarily forces truecolor level 3 so ANSI
 * assertions remain deterministic regardless of the test process terminal.
 *
 * @module
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import chalk from 'chalk';
import { prompt_render, type PromptContext, type ThemeName } from '../src/core/prompt/index.js';

const originalColorLevel: typeof chalk.level = chalk.level;

beforeAll((): void => {
  chalk.level = 3;
});

afterAll((): void => {
  chalk.level = originalColorLevel;
});

/**
 * Creates a wide prompt context with deterministic optional segments.
 *
 * @param cwd - Logical working directory shown by the prompt.
 * @returns Prompt context for theme rendering.
 */
function promptContext_create(cwd: string): PromptContext {
  return {
    user: 'rudolphpienaar',
    uri: 'https://cube.example.org/api/v1/',
    cwd,
    pacsserver: null,
    physicalMode: false,
    terminalWidth: 240,
    lastExitCode: 0,
    lastCommandDurationMs: 0,
    p10kSegments: { pacs: false, time: false, duration: false, status: false },
  };
}

describe('prompt home path abbreviation', (): void => {
  for (const theme of ['default', 'p10k'] as const satisfies readonly ThemeName[]) {
    it(`renders the authenticated user's home prefix as ~ in the ${theme} theme`, (): void => {
      const rendered: string = prompt_render(
        theme,
        promptContext_create('/home/rudolphpienaar/src'),
      );

      expect(rendered).toContain('~/src');
      expect(rendered).not.toContain('/home/rudolphpienaar/src');
    });
  }
});

describe('prompt Powerlevel10k-inspired palette', (): void => {
  it('uses vivid truecolor backgrounds for p10k host, user, and directory segments', (): void => {
    const rendered: string = prompt_render(
      'p10k',
      promptContext_create('/home/rudolphpienaar/src'),
    );

    expect(rendered).toContain('\x1b[48;2;0;175;255m');
    expect(rendered).toContain('\x1b[48;2;0;215;135m');
    expect(rendered).toContain('\x1b[48;2;255;215;95m');
  });

  it('uses the matching vivid accents in the default theme', (): void => {
    const rendered: string = prompt_render(
      'default',
      promptContext_create('/home/rudolphpienaar/src'),
    );

    expect(rendered).toContain('\x1b[38;2;0;215;135m');
    expect(rendered).toContain('\x1b[38;2;0;175;255m');
    expect(rendered).toContain('\x1b[38;2;255;215;95m');
  });
});
