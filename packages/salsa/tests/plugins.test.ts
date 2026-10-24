/**
 * @file Unit tests for pure plugin helpers.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { dictionary_formatAsCLI } from '../src/plugins/index';

describe('dictionary_formatAsCLI', () => {
  it('renders --key value pairs', () => {
    expect(dictionary_formatAsCLI({ a: 1, b: 'x' })).toBe('--a 1 --b x');
  });
  it('skips null and undefined values', () => {
    expect(dictionary_formatAsCLI({ a: 1, b: null as unknown as string, c: undefined as unknown as string })).toBe('--a 1');
  });
  it('returns empty string for no params', () => {
    expect(dictionary_formatAsCLI({})).toBe('');
  });
});
