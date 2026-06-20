/**
 * @file Unit tests for peer-store search helpers.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { storeName_extractFromUrl } from '../src/plugins/peer_search';

describe('storeName_extractFromUrl', () => {
  it('returns the hostname of a URL', () => {
    expect(storeName_extractFromUrl('http://cube.chrisproject.org/api/v1/')).toBe('cube.chrisproject.org');
  });
  it('drops the port', () => {
    expect(storeName_extractFromUrl('https://example.org:8000/api/v1/')).toBe('example.org');
  });
  it('returns the raw input when not a valid URL', () => {
    expect(storeName_extractFromUrl('not a url')).toBe('not a url');
  });
});
