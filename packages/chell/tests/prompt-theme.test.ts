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
  it('orders PACS, CUBE, user, path, and proc segments from left to right', (): void => {
    const context: PromptContext = promptContext_create('/home/rudolphpienaar/src');
    context.pacsserver = 'orthanc';
    context.p10kSegments.pacs = true;
    context.procWarmup = { loaded: 25, total: 100 };

    const rendered: string = prompt_render('p10k', context);
    const pacsIndex: number = rendered.indexOf('orthanc');
    const cubeIndex: number = rendered.indexOf('cube.example.org');
    const userIndex: number = rendered.indexOf('rudolphpienaar');
    const pathIndex: number = rendered.indexOf('~/src');
    const procIndex: number = rendered.indexOf('proc');

    expect(pacsIndex).toBeGreaterThanOrEqual(0);
    expect(pacsIndex).toBeLessThan(cubeIndex);
    expect(cubeIndex).toBeLessThan(userIndex);
    expect(userIndex).toBeLessThan(pathIndex);
    expect(pathIndex).toBeLessThan(procIndex);
  });

  it('places proc immediately after the path and before command telemetry', (): void => {
    const context: PromptContext = promptContext_create('/home/rudolphpienaar/src');
    context.lastExitCode = 7;
    context.lastCommandDurationMs = 4_000;
    context.p10kSegments = { pacs: false, time: true, duration: true, status: true };
    context.procWarmup = { loaded: 25, total: 100 };

    const rendered: string = prompt_render('p10k', context);
    const pathIndex: number = rendered.indexOf('~/src');
    const procIndex: number = rendered.indexOf('proc');
    const timeIndex: number = rendered.indexOf('\uf017');
    const durationIndex: number = rendered.indexOf('4s');
    const statusIndex: number = rendered.indexOf(' 7 ');

    expect(pathIndex).toBeLessThan(procIndex);
    expect(procIndex).toBeLessThan(timeIndex);
    expect(timeIndex).toBeLessThan(durationIndex);
    expect(durationIndex).toBeLessThan(statusIndex);
  });

  it('keeps physical mode after the requested PACS, CUBE, user, path, proc order', (): void => {
    const context: PromptContext = promptContext_create('/home/rudolphpienaar/src');
    context.pacsserver = 'orthanc';
    context.p10kSegments.pacs = true;
    context.physicalMode = true;
    context.procWarmup = { loaded: 25, total: 100 };

    const rendered: string = prompt_render('p10k', context);
    const orderedLabels: readonly string[] = [
      'orthanc',
      'cube.example.org',
      'rudolphpienaar',
      '~/src',
      'proc',
      'PHYSICAL',
    ];
    const indices: number[] = orderedLabels.map((label: string): number => rendered.indexOf(label));

    expect(indices.every((index: number): boolean => index >= 0)).toBe(true);
    expect(indices).toEqual([...indices].sort((a: number, b: number): number => a - b));
  });

  it('marks a cold proc index with a snowflake and warm warning colour', (): void => {
    const context: PromptContext = promptContext_create('/home/rudolphpienaar/src');
    context.procWarmup = { loaded: 25, total: 100, restored: false };

    const rendered: string = prompt_render('p10k', context);

    expect(rendered).toContain('\x1b[48;2;255;135;0m');
    expect(rendered).toContain('\uf2dc proc cold: 25/100 25%');
  });

  it('marks checkpoint reconciliation with a refresh icon and cached label', (): void => {
    const context: PromptContext = promptContext_create('/home/rudolphpienaar/src');
    context.procWarmup = { loaded: 25, total: 100, restored: true };

    const rendered: string = prompt_render('p10k', context);

    expect(rendered).toContain('\x1b[48;2;95;95;135m');
    expect(rendered).toContain('\uf021 proc cached, refreshing: 25/100 25%');
  });

  it('keeps a failed proc refresh visible with a warning segment', (): void => {
    const context: PromptContext = promptContext_create('/home/rudolphpienaar/src');
    context.procWarmup = { loaded: 25, total: 100, restored: true, state: 'failed' };

    const rendered: string = prompt_render('p10k', context);

    expect(rendered).toContain('\x1b[48;2;255;0;95m');
    expect(rendered).toContain('\uf071 proc failed: 25/100 25%');
  });

  it('renders the CUBE with a contrasting Font Awesome cube icon', (): void => {
    const rendered: string = prompt_render(
      'p10k',
      promptContext_create('/home/rudolphpienaar/src'),
    );

    expect(rendered).toContain(
      '\x1b[38;2;0;16;24m\x1b[48;2;0;175;255m \uf1b2 cube.example.org ',
    );
  });

  it('uses Font Awesome glyphs across every p10k segment', (): void => {
    const context: PromptContext = promptContext_create('/home/rudolphpienaar/src');
    context.pacsserver = 'orthanc';
    context.physicalMode = true;
    context.terminalWidth = 400;
    context.lastExitCode = 7;
    context.lastCommandDurationMs = 4_000;
    context.p10kSegments = { pacs: true, time: true, duration: true, status: true };
    context.procWarmup = { loaded: 25, total: 100 };

    const rendered: string = prompt_render('p10k', context);
    const fontAwesomeGlyphs: readonly string[] = [
      '\uf1b2', // cube
      '\uf1c0', // database
      '\uf610', // microscope
      '\uf007', // user
      '\uf07c', // folder-open
      '\uf017', // clock
      '\uf0e7', // bolt
      '\uf057', // circle-xmark
      '\uf2dc', // snowflake (cold proc index)
    ];
    const legacyEmoji: readonly string[] = ['🌐', '🗄️', '🔬', '👤', '📂', '⏱', '⚡', '✖', '⚙'];

    for (const glyph of fontAwesomeGlyphs) expect(rendered).toContain(glyph);
    for (const emoji of legacyEmoji) expect(rendered).not.toContain(emoji);
  });

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
