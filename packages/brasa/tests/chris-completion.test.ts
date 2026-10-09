/**
 * @file What the ChRIS session completes at the root.
 *
 * @module
 */
import { jest, describe, it, expect } from '@jest/globals';

jest.unstable_mockModule('@fnndsc/salsa', () => ({ plugins_listAll: jest.fn(), pipelineManifest_get: jest.fn() }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({ listCache_get: jest.fn() }));

const { chrisCompletion } = await import('../src/chris/completion.js');

describe('ChRIS root completion', () => {
  it('offers only names that list at the root: /bin (ChRIS) and /usr (the core), never a /pacs that is not there', () => {
    expect(chrisCompletion.rootWords).toEqual(['bin', 'usr']);
  });
});
