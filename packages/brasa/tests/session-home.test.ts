/**
 * @file A first session begins at the identity's home, not at `/`.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const current_get = jest.fn<(context: string) => Promise<string | null>>();

jest.unstable_mockModule('@fnndsc/cumin', () => ({
  chrisConnection: {},
  chrisConnection_init: jest.fn(),
  NodeStorageProvider: class {},
  Context: { ChRISuser: 'user', ChRISURL: 'url', ChRISfolder: 'folder', ChRISfeed: 'feed', ChRISplugin: 'plugin' },
  chrisContext: { current_get, current_set: jest.fn() },
}));

const { session } = await import('../src/session/index.js');

describe('where a session begins', () => {
  beforeEach(() => { current_get.mockReset(); });

  it('is the stored directory when the identity has one', async () => {
    current_get.mockImplementation(async (context: string) => (context === 'folder' ? '/home/chris/data' : 'chris'));
    expect(await session.getCWD()).toBe('/home/chris/data');
  });

  it('is the home directory when nothing is stored yet', async () => {
    current_get.mockImplementation(async (context: string) => (context === 'folder' ? null : 'chris'));
    expect(await session.getCWD()).toBe('/home/chris');
  });

  it('honours a stored root: the operator put it there', async () => {
    current_get.mockImplementation(async (context: string) => (context === 'folder' ? '/' : 'chris'));
    expect(await session.getCWD()).toBe('/');
  });

  it('falls back to the root only when there is no identity at all', async () => {
    current_get.mockImplementation(async () => null);
    expect(await session.getCWD()).toBe('/');
  });
});
