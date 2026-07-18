/**
 * @file Contract tests for token-preserving executable argument parsing.
 *
 * These tests cover the shared plugin and pipeline option-value grammar.
 *
 * @module
 */
import { describe, expect, it } from '@jest/globals';
import { executableArguments_parse } from '../src/builtins/argumentTokens.js';

describe('executableArguments_parse', () => {
  it('preserves shell tokens, negative values, booleans, equals, and last-value precedence', () => {
    expect(executableArguments_parse([
      '--message', 'hello world',
      '--offset', '-1',
      '--enabled',
      '--threshold=0.5',
      '--enabled=false',
    ])).toEqual({
      message: 'hello world',
      offset: -1,
      enabled: false,
      threshold: 0.5,
    });
  });

  it('accepts bare key=value context assignments used after the plugin delimiter', () => {
    expect(executableArguments_parse(['feed_title=Brain MRI', 'cpu_limit=2']))
      .toEqual({ feed_title: 'Brain MRI', cpu_limit: 2 });
  });
});
