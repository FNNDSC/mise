/**
 * @file A page older than its server's build knows the failure for what
 * it is: a chunk of the old build the server no longer has.
 */
import { describe, it, expect } from '@jest/globals';
import { stalePage_is } from '../../src/app/stalePage.js';

describe('stalePage_is', () => {
  it('knows a failed on-demand chunk load in each browser\'s words', () => {
    expect(stalePage_is(new TypeError('Failed to fetch dynamically imported module: http://x/s/k/assets/cornerstoneEngine-bNIs8OPH.js'))).toBe(true);
    expect(stalePage_is(new TypeError('error loading dynamically imported module: http://x/assets/a.js'))).toBe(true);
    expect(stalePage_is(new TypeError('Importing a module script failed.'))).toBe(true);
  });

  it('leaves every other failure alone', () => {
    expect(stalePage_is(new Error('Failed to fetch'))).toBe(false);
    expect(stalePage_is('socket closed')).toBe(false);
    expect(stalePage_is(undefined)).toBe(false);
  });
});
