/**
 * @file With no backend, the core numbers files and folders and answers `${cwd}` alone.
 */
import { describe, it, expect } from '@jest/globals';

const { answerKinds_get, verbTakes_get } = await import('../src/core/answerKinds.js');
const { reference_isReserved } = await import('../src/core/expansion.js');

describe('the core without a backend', () => {
  it('numbers files and folders', () => {
    expect(answerKinds_get().map((kind) => kind.code)).toEqual(['FIL', 'DIR']);
  });

  it('knows what its own verbs take, and lets every other verb take anything', () => {
    expect(verbTakes_get('cat')).toEqual(['FIL']);
    expect(verbTakes_get('cd')).toEqual(['DIR']);
    expect(verbTakes_get('image')).toBeUndefined();
  });

  it('answers cwd and nothing a backend would', () => {
    expect(reference_isReserved('cwd')).toBe(true);
    expect(reference_isReserved('feed')).toBe(false);
    expect(reference_isReserved('gather.first')).toBe(false);
  });
});
