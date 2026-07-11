/**
 * Scaffold smoke test.
 *
 * Confirms the brasa package barrel loads. Real engine tests arrive as the
 * engine is lifted out of the chell package.
 */

import * as brasa from '../src/index.js';

describe('brasa package scaffold', (): void => {
  it('exposes an importable barrel', (): void => {
    expect(brasa).toBeDefined();
  });
});
