/**
 * @file Tests for ChRISEmbeddedResourceGroup creation and the module's own
 * context_split export. Connection mocked at the client boundary.
 */

jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import {
  ChRISEmbeddedResourceGroup,
  ChRISContextSpecError,
  context_split,
} from '../src/resources/chrisEmbeddedResourceGroup';
import { errorStack } from '../src/error/errorStack';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;

let pushSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  pushSpy = jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  pushSpy.mockRestore();
  errSpy.mockRestore();
});

describe('context_split (module export)', () => {
  it('splits on the first delimiter only', () => {
    expect(context_split('folder:/pacs/queries/2601_AccessionNumber:12345678'))
      .toEqual({ type: 'folder', value: '/pacs/queries/2601_AccessionNumber:12345678' });
  });

  it('throws for non-strings and missing delimiters', () => {
    expect(() => context_split(42)).toThrow(ChRISContextSpecError);
    expect(() => context_split('nodelimiter')).toThrow(ChRISContextSpecError);
  });
});

describe('ChRISEmbeddedResourceGroup.create', () => {
  it('binds a folder context', async () => {
    const folder: Record<string, jest.Mock> = { getFiles: jest.fn() };
    mockClientGet.mockResolvedValue({ getFileBrowserFolderByPath: jest.fn(async () => folder) });
    const group = await ChRISEmbeddedResourceGroup.create('Files', 'getFiles', 'folder:/home/chris');
    expect(group).not.toBeNull();
    expect(group?.context).toBe('folder:/home/chris');
    expect(group?.chrisContextObj).toBe(folder);
  });

  it('binds plugin and feed contexts', async () => {
    const plugin: Record<string, jest.Mock> = { getPluginParameters: jest.fn() };
    const feed: Record<string, jest.Mock> = { getComments: jest.fn() };
    mockClientGet.mockResolvedValue({
      getPlugin: jest.fn(async () => plugin),
      getFeed: jest.fn(async () => feed),
    });
    expect(await ChRISEmbeddedResourceGroup.create('Params', 'getPluginParameters', 'plugin:12')).not.toBeNull();
    expect(await ChRISEmbeddedResourceGroup.create('Comments', 'getComments', 'feed:9')).not.toBeNull();
  });

  it('returns null for an unknown context type', async () => {
    mockClientGet.mockResolvedValue({});
    expect(await ChRISEmbeddedResourceGroup.create('X', 'getX', 'orbit:5')).toBeNull();
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Unknown context type: orbit'));
  });

  it('returns null when the context object cannot be fetched', async () => {
    mockClientGet.mockResolvedValue({
      getFileBrowserFolderByPath: jest.fn(async () => { throw new Error('404'); }),
    });
    expect(await ChRISEmbeddedResourceGroup.create('Files', 'getFiles', 'folder:/ghost')).toBeNull();
  });

  it('returns null when the context object is empty', async () => {
    mockClientGet.mockResolvedValue({ getFileBrowserFolderByPath: jest.fn(async () => null) });
    expect(await ChRISEmbeddedResourceGroup.create('Files', 'getFiles', 'folder:/ghost')).toBeNull();
    expect(pushSpy).toHaveBeenCalledWith('warning', expect.stringContaining('could not initialize'));
  });

  it('returns null when not connected', async () => {
    mockClientGet.mockResolvedValue(null);
    expect(await ChRISEmbeddedResourceGroup.create('Files', 'getFiles', 'folder:/x')).toBeNull();
  });

  it('returns null for a malformed context string', async () => {
    mockClientGet.mockResolvedValue({});
    expect(await ChRISEmbeddedResourceGroup.create('Files', 'getFiles', 'nodelimiter')).toBeNull();
  });
});
