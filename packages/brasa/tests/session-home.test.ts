/**
 * @file A first session begins at the identity's home, not at `/`.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { cuminMock_install } from './support/cuminMock.js';

const current_get = jest.fn<(context: string) => Promise<string | null>>();
const current_set = jest.fn<(context: string, value: string) => Promise<boolean>>(async () => true);
const connection_init = jest.fn(async () => ({ name: 'connection' }));
const ChRISURL_get = jest.fn<() => Promise<string | null>>(async () => null);
const ChRISuser_get = jest.fn<() => Promise<string | null>>(async () => null);

cuminMock_install(() => ({
  chrisConnection: { name: 'singleton' },
  chrisConnection_init: connection_init,
  NodeStorageProvider: class {},
  Context: { ChRISuser: 'user', ChRISURL: 'url', ChRISfolder: 'folder', ChRISfeed: 'feed', ChRISplugin: 'plugin' },
  chrisContext: { current_get, current_set, ChRISURL_get, ChRISuser_get },
}));
jest.unstable_mockModule('@fnndsc/chili/utils', () => ({
  chrisConnection_init: jest.fn(async () => undefined),
}));

// The prompt, the heartbeat, the fallback, the files and the watch reach
// into the /proc index and CUBE; not what this file is about.
jest.unstable_mockModule('../src/chris/commandFallback.js', () => ({ chrisFallback: {} }));
jest.unstable_mockModule('../src/chris/files.js', () => ({ chrisFiles: {} }));
jest.unstable_mockModule('../src/chris/watch.js', () => ({ chrisWatch: {} }));
jest.unstable_mockModule('../src/chris/filesystem.js', () => ({ chrisFilesystem: {} }));
jest.unstable_mockModule('../src/chris/mounts.js', () => ({ chrisMounts_register: jest.fn() }));
jest.unstable_mockModule('../src/chris/completion.js', () => ({ chrisCompletion: {} }));
jest.unstable_mockModule('@fnndsc/chili/commands/connect/elevation.js', () => ({ elevation_run: jest.fn() }));
jest.unstable_mockModule('../src/chris/promptContext.js', () => ({
  sessionPromptContext_build: jest.fn(),
  procIndex_snapshot: jest.fn(),
}));

const { session, Session } = await import('../src/session/index.js');
const { chrisBackend } = await import('../src/chris/backend.js');
(await import('../src/core/backend.js')).backend_install(chrisBackend);

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

describe('who a ChRIS session is', () => {
  it('is the CUBE user at the CUBE URL when the context names both', async () => {
    ChRISURL_get.mockResolvedValueOnce('https://cube.example.org/api/v1/');
    ChRISuser_get.mockResolvedValueOnce('chris');
    expect(await chrisBackend.session.identity_get()).toEqual({ user: 'chris', where: 'https://cube.example.org/api/v1/', connected: true });
  });

  it('is disconnected@no-cube when it does not, the name a disconnected daemon has always had', async () => {
    ChRISURL_get.mockResolvedValueOnce(null);
    ChRISuser_get.mockResolvedValueOnce('chris');
    expect(await chrisBackend.session.identity_get()).toEqual({ user: 'disconnected', where: 'no-cube', connected: false });
  });
});

describe('the backend under it', () => {
  it('is what the session asks for its home and its directory', async () => {
    const { backend_install, backend_get } = await import('../src/core/backend.js');
    const saved: string[] = [];
    backend_install({
      id: 'test',
      session: {
        init: async (): Promise<void> => undefined,
        identity_get: async () => ({ user: 'disconnected', where: 'no-test', connected: false }),
        home_get: async (): Promise<string> => '/home/test',
        cwd_load: async (): Promise<string | null> => null,
        cwd_save: async (path: string): Promise<void> => { saved.push(path); },
      },
    });
    expect(backend_get().id).toBe('test');
    expect(await session.getCWD()).toBe('/home/test');
    await session.setCWD('/work');
    expect(saved).toEqual(['/work']);
    backend_install(chrisBackend);
  });
});

describe('what a ChRIS prompt and heartbeat read', () => {
  it('is the session prompt context and the /proc index snapshot', async () => {
    const promptContext = await import('../src/chris/promptContext.js');
    expect(chrisBackend.prompt).toBe(promptContext.sessionPromptContext_build);
    expect(chrisBackend.telemetry).toBe(promptContext.procIndex_snapshot);
  });
});
