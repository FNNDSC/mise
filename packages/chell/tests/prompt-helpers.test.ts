/**
 * @file Unit tests for the pure `prompt` builtin helpers.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { promptContext_build, segmentTokens_parse } from '../src/builtins/sys/prompt.helpers.js';

const SEGMENTS = { time: true, duration: false, status: true, pacs: false } as any;

describe('promptContext_build', () => {
  it('uses live context values when online', () => {
    const ctx = promptContext_build(
      { user: 'jdoe', URL: 'http://cube', pacsserver: 'PACS1' } as any,
      '/home/jdoe', false, true, 120, SEGMENTS
    );
    expect(ctx).toMatchObject({ user: 'jdoe', uri: 'http://cube', cwd: '/home/jdoe', pacsserver: 'PACS1', physicalMode: true, terminalWidth: 120 });
    expect(ctx.lastExitCode).toBe(0);
    expect(ctx.p10kSegments).toBe(SEGMENTS);
  });
  it('applies offline fallbacks', () => {
    const ctx = promptContext_build({ user: 'jdoe', URL: 'http://cube' } as any, '/home/jdoe', true, false, 80, SEGMENTS);
    expect(ctx.user).toBe('disconnected');
    expect(ctx.uri).toBe('no-cube');
    expect(ctx.cwd).toBe('/');
  });
  it('falls back to disconnected/no-cube when context fields are missing', () => {
    const ctx = promptContext_build({} as any, '/x', false, false, 80, SEGMENTS);
    expect(ctx.user).toBe('disconnected');
    expect(ctx.uri).toBe('no-cube');
    expect(ctx.pacsserver).toBeNull();
  });
});

describe('segmentTokens_parse', () => {
  it('splits on whitespace and commas, dropping empties', () => {
    expect(segmentTokens_parse('time duration')).toEqual(['time', 'duration']);
    expect(segmentTokens_parse(' time,  status , ')).toEqual(['time', 'status']);
  });
  it('returns empty array for blank input', () => {
    expect(segmentTokens_parse('   ')).toEqual([]);
  });
});
