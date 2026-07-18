/**
 * @file Contract tests for plugin executable selector normalization.
 *
 * These tests keep direct plugin execution and PACS attachment on one selector grammar.
 *
 * @module
 */
import { describe, expect, it } from '@jest/globals';
import { pluginSelector_normalize } from '../src/builtins/pluginSelector.js';

describe('pluginSelector_normalize', () => {
  it('normalizes an unversioned executable name to an exact-name selector', () => {
    expect(pluginSelector_normalize('pl-dcm2niix')).toBe('name_exact:pl-dcm2niix');
  });

  it('normalizes a versioned executable name to exact name and version', () => {
    expect(pluginSelector_normalize('pl-dcm2niix-v1.2.0'))
      .toBe('name_exact:pl-dcm2niix,version:1.2.0');
  });
});
