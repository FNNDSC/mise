/**
 * @file Tests for the ChRISResource spine driven directly: list fetching
 * with retry and client-side filtering, pagination in resources_getAll,
 * item deletion, field selection and dictionary conversion.
 */

jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { ListResource } from '@fnndsc/chrisapi';
import { chrisConnection } from '../src/connect/chrisConnection';
import {
  ChRISResource,
  resourceFields_get,
  Item,
  FilteredResourceData,
  Dictionary,
} from '../src/resources/chrisResources';
import { listResource_make } from './fixtures';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;

const rows_make = (count: number, offset: number = 0): Array<Record<string, unknown>> =>
  Array.from({ length: count }, (_v: unknown, i: number) => ({
    id: offset + i + 1,
    name: `item-${offset + i + 1}`,
  }));

let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
});

describe('client access', () => {
  it('fetches and caches the shared client', async () => {
    mockClientGet.mockResolvedValue({ me: true });
    const resource: ChRISResource = new ChRISResource();
    expect(await resource.client_get()).toEqual({ me: true });
    expect(await resource.client_get()).toEqual({ me: true });
    expect(mockClientGet).toHaveBeenCalledTimes(1);
  });
});

describe('resources_getList', () => {
  it('returns bare params when no fetch method is bound', async () => {
    const resource: ChRISResource = new ChRISResource();
    expect(await resource.resources_getList({ limit: 5 })).toMatchObject({ limit: 5 });
  });

  it('logs and returns params when the method yields nothing', async () => {
    const resource: ChRISResource = new ChRISResource();
    resource.resourceName = 'Ghosts';
    resource.binding_applyGet({}, jest.fn(async () => null) as never);
    await resource.resources_getList();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Ghosts resource list returned 'undefined' or 'null'"));
  });

  it('retries with simplified params and filters client-side', async () => {
    const fetch = jest.fn()
      .mockRejectedValueOnce(new Error('400 unknown query param'))
      .mockResolvedValue(listResource_make(rows_make(3)));
    const resource: ChRISResource = new ChRISResource();
    resource.binding_applyGet({}, fetch as never, 'Filtered');
    await resource.resources_getList({ name: 'item-2' });
    const fields = await resource.resourceFields_get();
    expect(fields?.items).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith({ limit: 20, offset: 0 });
  });

  it('filters by exact id match client-side', async () => {
    const fetch = jest.fn()
      .mockRejectedValueOnce(new Error('400'))
      .mockResolvedValue(listResource_make(rows_make(12)));
    const resource: ChRISResource = new ChRISResource();
    resource.binding_applyGet({}, fetch as never);
    await resource.resources_getList({ id: '1' });
    const fields = await resource.resourceFields_get();
    // exact match: only id 1, not 10/11/12
    expect(fields?.items).toHaveLength(1);
  });

  it('warns when the client-side filter matches nothing', async () => {
    const fetch = jest.fn()
      .mockRejectedValueOnce(new Error('400'))
      .mockResolvedValue(listResource_make(rows_make(2)));
    const resource: ChRISResource = new ChRISResource();
    resource.binding_applyGet({}, fetch as never);
    await resource.resources_getList({ name: 'zzz' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No items match'));
  });

  it('rethrows when the simplified retry also fails', async () => {
    const fetch = jest.fn().mockRejectedValue(new Error('hard down'));
    const resource: ChRISResource = new ChRISResource();
    resource.binding_applyGet({}, fetch as never);
    await expect(resource.resources_getList({ name: 'x' })).rejects.toThrow('hard down');
  });

  it('resolves a lazy binding before fetching', async () => {
    const obj = { getThings: jest.fn(async () => listResource_make(rows_make(1))) };
    const resource: ChRISResource = new ChRISResource();
    resource.binding_applyLazy(async () => obj, 'getThings', 'Things');
    await resource.resources_getList();
    expect(obj.getThings).toHaveBeenCalled();
  });

  it('reports a lazy method that does not exist', async () => {
    const resource: ChRISResource = new ChRISResource();
    resource.binding_applyLazy(async () => ({}), 'getMissing');
    await resource.resources_getList();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('getMissing not found'));
  });
});

describe('resources_getAll', () => {
  it('walks pages until a short page arrives', async () => {
    const fetch = jest.fn(async (params: { offset?: number }) =>
      (params.offset ?? 0) === 0
        ? listResource_make(rows_make(100), 'resources', true)
        : listResource_make(rows_make(5, 100)),
    );
    const resource: ChRISResource = new ChRISResource();
    resource.binding_applyGet({}, fetch as never);
    const all: FilteredResourceData | null = await resource.resources_getAll();
    expect(all?.tableData).toHaveLength(105);
    expect(all?.totalCount).toBe(105);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('stops when the API reports no next page', async () => {
    const fetch = jest.fn(async () => listResource_make(rows_make(100), 'resources', false));
    const resource: ChRISResource = new ChRISResource();
    resource.binding_applyGet({}, fetch as never);
    const all: FilteredResourceData | null = await resource.resources_getAll();
    expect(all?.tableData).toHaveLength(100);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when nothing is found', async () => {
    const fetch = jest.fn(async () => listResource_make([]));
    const resource: ChRISResource = new ChRISResource();
    resource.binding_applyGet({}, fetch as never);
    expect(await resource.resources_getAll()).toBeNull();
  });
});

describe('resourceItem_delete and resources_getItems', () => {
  it('deletes an item from the current collection', async () => {
    const del = jest.fn(async () => undefined);
    const list: ListResource = listResource_make(rows_make(1));
    Object.defineProperty(list, 'getItem', { value: () => ({ _delete: del }) });
    const resource: ChRISResource = new ChRISResource();
    resource.binding_applyGet({}, jest.fn(async () => list) as never);
    await resource.resources_getList();
    expect(await resource.resourceItem_delete(1)).toBe(true);
    expect(del).toHaveBeenCalled();
  });

  it('returns false when the delete throws or no collection exists', async () => {
    const list: ListResource = listResource_make(rows_make(1));
    Object.defineProperty(list, 'getItem', {
      value: () => ({ _delete: jest.fn(async () => { throw new Error('403'); }) }),
    });
    const resource: ChRISResource = new ChRISResource();
    resource.binding_applyGet({}, jest.fn(async () => list) as never);
    await resource.resources_getList();
    expect(await resource.resourceItem_delete(1)).toBe(false);

    expect(await new ChRISResource().resourceItem_delete(1)).toBe(false);
  });

  it('returns the item resources after a list fetch', async () => {
    const resource: ChRISResource = new ChRISResource();
    resource.binding_applyGet({}, jest.fn(async () => listResource_make(rows_make(2))) as never);
    await resource.resources_getList();
    const items = await resource.resources_getItems();
    expect(items).toHaveLength(2);
  });

  it('returns null from getItems without a bound method', async () => {
    expect(await new ChRISResource().resources_getItems()).toBeNull();
  });
});

describe('field selection and dictionary conversion', () => {
  it('honours a fields option over the full field set', async () => {
    const resource: ChRISResource = new ChRISResource();
    resource.binding_applyGet({}, jest.fn(async () => listResource_make(rows_make(1))) as never);
    const filtered: FilteredResourceData | null =
      await resource.resources_listAndFilterByOptions({ fields: 'name' });
    expect(filtered?.selectedFields).toEqual(['name']);
    expect(filtered?.tableData[0]).toEqual({ id: '1', name: 'item-1' });
  });

  it('resolves a field filter argument when options carry none', () => {
    const resource: ChRISResource = new ChRISResource();
    expect(resource.fieldSpec_resolve('a, b')).toEqual(['a', 'b']);
    expect(resource.fieldSpec_resolve(undefined, { fields: 'c' })).toEqual(['c']);
    expect(resource.fieldSpec_resolve()).toEqual([]);
  });

  it('converts items to dictionaries', () => {
    const resource: ChRISResource = new ChRISResource();
    const items: Item[] = [{
      data: [{ name: 'id', value: 1 }, { name: 'name', value: 'x' }],
      href: 'https://cube/api/v1/things/1/',
      links: [],
    }];
    const dicts: Dictionary[] = resource.resourceItems_toDicts(items);
    expect(dicts).toEqual([{ id: 1, name: 'x' }]);
  });

  it('builds null from a collection-less resource', () => {
    const resource: ChRISResource = new ChRISResource();
    expect(resource.resourceItems_buildFromCollection(null)).toBeNull();
  });
});

describe('resourceFields_get (module helper)', () => {
  it('extracts selected fields from a single resource', () => {
    const list: ListResource = listResource_make([{ id: 7, name: 'solo', extra: 'e' }]);
    expect(resourceFields_get(list, ['name'])).toEqual({ id: '7', name: 'solo' });
  });

  it('yields no record for a resource without items', () => {
    const list: ListResource = listResource_make([]);
    expect(resourceFields_get(list, ['name'])).toBeUndefined();
  });
});
