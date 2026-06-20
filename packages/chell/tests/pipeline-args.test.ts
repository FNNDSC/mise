/**
 * @file Unit tests for the pure `pipeline run` argument parser.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { pipelineRunArgs_parse } from '../src/builtins/res/pipeline.args.js';

describe('pipelineRunArgs_parse', () => {
  it('returns undefined overrides when none given', () => {
    expect(pipelineRunArgs_parse(['run', 'myPipe'])).toEqual({ computeOverride: undefined, previousOverride: undefined });
  });
  it('parses --compute and --previous', () => {
    expect(pipelineRunArgs_parse(['run', 'myPipe', '--compute', 'host', '--previous', '42'])).toEqual({
      computeOverride: 'host',
      previousOverride: 42,
    });
  });
  it('ignores a trailing flag with no value', () => {
    expect(pipelineRunArgs_parse(['run', 'myPipe', '--compute'])).toEqual({ computeOverride: undefined, previousOverride: undefined });
  });
});
