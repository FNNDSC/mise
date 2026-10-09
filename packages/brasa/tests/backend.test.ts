/**
 * @file The session cannot run without a backend, and says so.
 */
import { describe, it, expect } from '@jest/globals';

const { backend_get } = await import('../src/core/backend.js');

describe('the installed backend', () => {
  it('is refused by name when nothing is installed', () => {
    expect(() => backend_get()).toThrow('no backend installed');
  });
});
