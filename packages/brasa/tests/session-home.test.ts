/**
 * @file A first session begins at the identity's home, not at `/`.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const current_get = jest.fn<(context: string) => Promise<string | null>>();
const current_set = jest.fn<(context: string, value: string) => Promise<boolean>>(async () => true);
const connection_init = jest.fn(async () => ({ name: 'connection' }));

jest.unstable_mockModule('@fnndsc/cumin', () => ({
  chrisConnection: { name: 'singleton' },
  chrisConnection_init: connection_init,
  NodeStorageProvider: class {},
  Context: { ChRISuser: 'user', ChRISURL: 'url', ChRISfolder: 'folder', ChRISfeed: 'feed', ChRISplugin: 'plugin' },
  chrisContext: { current_get, current_set },
}));
jest.unstable_mockModule('@fnndsc/chili/utils', () => ({
  chrisConnection_init: jest.fn(async () => undefined),
}));

const { session, Session } = await import('../src/session/index.js');

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

describe('the session around it', () => {
  beforeEach(() => { current_get.mockReset(); current_set.mockClear(); });

  it('is one instance', () => {
    expect(Session.getInstance()).toBe(session);
  });

  it('moves through the context, and remembers where it was for cd -', async () => {
    current_get.mockImplementation(async (context: string) => (context === 'folder' ? '/home/chris' : 'chris'));
    await session.directory_change('/home/chris/data');
    expect(current_set).toHaveBeenCalledWith('folder', '/home/chris/data');
    expect(session.previousCWD_get()).toBe('/home/chris');
    // Moving to where it already is remembers nothing new.
    await session.directory_change('/home/chris');
    expect(session.previousCWD_get()).toBe('/home/chris');
    await session.setCWD('/tmp');
    expect(current_set).toHaveBeenLastCalledWith('folder', '/tmp');
  });

  it('initialises the connection once and hands it back, the singleton standing in before', async () => {
    expect(session.connection).toEqual({ name: 'singleton' });
    await session.init();
    expect(connection_init).toHaveBeenCalledTimes(1);
    expect(session.connection).toEqual({ name: 'connection' });
  });

  it('carries the modes and the regard', () => {
    session.offline = true;
    expect(session.offline).toBe(true);
    session.physicalMode_set(true);
    expect(session.physicalMode_get()).toBe(true);
    session.timingEnabled_set(true);
    expect(session.timingEnabled_get()).toBe(true);
    expect(session.regard_get()).toBeNull();
    session.regard_set({ address: '/home/chris/x', modelKind: 'fs.file' } as never);
    expect(session.regard_get()).toEqual({ address: '/home/chris/x', modelKind: 'fs.file' });
  });
});
