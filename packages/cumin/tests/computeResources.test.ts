/**
 * @file Tests for compute resource validation and listing, with the
 * connection mocked at the client boundary.
 */

jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import {
  computeResources_validate,
  computeResources_getAll,
  computeResourceNames_parse,
  ComputeResource,
} from '../src/compute/computeResources';
import { errorStack } from '../src/error/errorStack';
import { Result } from '../src/utils/result';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;

const resources: ComputeResource[] = [
  { id: 1, name: 'host', compute_url: 'http://pfcon-host/' },
  { id: 2, name: 'gpu', compute_url: 'http://pfcon-gpu/' },
];

let pushSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  pushSpy = jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
});
afterEach(() => {
  pushSpy.mockRestore();
});

describe('computeResources_validate', () => {
  it('accepts names that all exist', async () => {
    mockClientGet.mockResolvedValue({ getComputeResources: jest.fn(async () => ({ data: resources })) });
    const result: Result<string[]> = await computeResources_validate(['host', 'gpu']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(['host', 'gpu']);
  });

  it('rejects unknown names and reports the available set', async () => {
    mockClientGet.mockResolvedValue({ getComputeResources: jest.fn(async () => ({ data: resources })) });
    expect((await computeResources_validate(['host', 'moon'])).ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Invalid compute resource(s): moon'));
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Available compute resources: host, gpu'));
  });

  it('errors when not connected', async () => {
    mockClientGet.mockResolvedValue(null);
    expect((await computeResources_validate(['host'])).ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Not connected'));
  });

  it('errors when the client call throws', async () => {
    mockClientGet.mockResolvedValue({ getComputeResources: jest.fn(async () => { throw new Error('down'); }) });
    expect((await computeResources_validate(['host'])).ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('down'));
  });
});

describe('computeResources_getAll', () => {
  it('returns all compute resources', async () => {
    mockClientGet.mockResolvedValue({ getComputeResources: jest.fn(async () => ({ data: resources })) });
    const result: Result<ComputeResource[]> = await computeResources_getAll();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
  });

  it('errors when not connected', async () => {
    mockClientGet.mockResolvedValue(null);
    expect((await computeResources_getAll()).ok).toBe(false);
  });

  it('errors when the client call throws', async () => {
    mockClientGet.mockResolvedValue({ getComputeResources: jest.fn(async () => { throw new Error('x'); }) });
    expect((await computeResources_getAll()).ok).toBe(false);
  });
});

describe('computeResourceNames_parse', () => {
  it('splits and trims a comma-separated string', () => {
    expect(computeResourceNames_parse('host, gpu ,remote')).toEqual(['host', 'gpu', 'remote']);
  });

  it('trims an array input', () => {
    expect(computeResourceNames_parse([' host ', 'gpu'])).toEqual(['host', 'gpu']);
  });
});
