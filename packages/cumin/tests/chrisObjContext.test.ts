/**
 * @file Tests for the object-context factory, with the embedded resource
 * group mocked at its creation seam.
 */

jest.mock('../src/resources/chrisEmbeddedResourceGroup', () => ({
  ChRISEmbeddedResourceGroup: { create: jest.fn() },
}));

import { ChRISEmbeddedResourceGroup } from '../src/resources/chrisEmbeddedResourceGroup';
import { objContext_create } from '../src/resources/chrisObjContext';
import { errorStack } from '../src/error/errorStack';

const mockCreate: jest.Mock = ChRISEmbeddedResourceGroup.create as unknown as jest.Mock;

let pushSpy: jest.SpyInstance;
let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  pushSpy = jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  pushSpy.mockRestore();
  logSpy.mockRestore();
  errSpy.mockRestore();
});

describe('objContext_create', () => {
  it('creates a context group through the configured factory', async () => {
    const group: object = { bound: true };
    mockCreate.mockResolvedValue(group);
    expect(await objContext_create('ParametersOfPlugin', 'plugin:12')).toBe(group);
    expect(mockCreate).toHaveBeenCalledWith('ParametersOfPlugin', 'getPluginParameters', 'plugin:12');
  });

  it('caches per context key and skips a second creation', async () => {
    mockCreate.mockResolvedValue({ bound: true });
    await objContext_create('ChRISFilesContext', 'folder:/home/chris');
    await objContext_create('ChRISFilesContext', 'folder:/home/chris');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('passes a null creation result through uncached', async () => {
    mockCreate.mockResolvedValue(null);
    expect(await objContext_create('ChRISDirsContext', 'folder:/ghost')).toBeNull();
    expect(await objContext_create('ChRISDirsContext', 'folder:/ghost')).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('wraps creation failures in an ObjContextCreationError', async () => {
    mockCreate.mockRejectedValue(new Error('deep failure'));
    await expect(objContext_create('ChRISFeedGroup', 'feed:9'))
      .rejects.toThrow('Failed to create Feed: deep failure');
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('deep failure'));
  });

  it('throws for an unknown context type', async () => {
    await expect(objContext_create('Nonsense', 'plugin:1'))
      .rejects.toThrow('Unknown object context type: Nonsense');
    expect(errSpy).toHaveBeenCalled();
  });
});
