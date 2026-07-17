/**
 * @file Prompt rendering tests for deterministic `/proc` warm-up progress.
 *
 * @module
 */
import { describe, expect, it } from '@jest/globals';
import { prompt_render, type PromptContext } from '../src/core/prompt/index.js';

function promptContext_createWithProgress(loaded: number, total: number): PromptContext {
  return {
    user: 'chris',
    uri: 'https://cube.example.org/api/v1/',
    cwd: '/proc/jobs',
    pacsserver: null,
    physicalMode: false,
    terminalWidth: 160,
    lastExitCode: 0,
    lastCommandDurationMs: 0,
    p10kSegments: { pacs: false, time: false, duration: false, status: false },
    procWarmup: { loaded, total },
  };
}

describe('prompt /proc progress', () => {
  it('renders loaded, total, and percentage in the default prompt', () => {
    const rendered: string = prompt_render('default', promptContext_createWithProgress(25, 100));
    expect(rendered).toContain('proc: 25/100 25%');
  });

  it('renders the same progress semantics in the p10k prompt', () => {
    const rendered: string = prompt_render('p10k', promptContext_createWithProgress(25, 100));
    expect(rendered).toContain('proc: 25/100 25%');
  });

  it('does not show 100% while warm-up remains active', () => {
    const rendered: string = prompt_render('default', promptContext_createWithProgress(100, 100));
    expect(rendered).toContain('proc: 100/100 99%');
  });

  it('marks restored data as usable while reconciliation continues', () => {
    const context: PromptContext = promptContext_createWithProgress(25, 100);
    context.procWarmup = { loaded: 25, total: 100, restored: true };
    expect(prompt_render('default', context)).toContain('proc: cached, syncing 25/100 25%');
    expect(prompt_render('p10k', context)).toContain('proc: cached, syncing 25/100 25%');
  });
});
