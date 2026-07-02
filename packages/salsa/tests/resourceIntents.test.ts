/**
 * Boundary-only tests for the thin salsa resource-intent wrappers. Each wraps a
 * cumin ChRIS*Group: `new Group().asset.<method>(...)`. We mock cumin so every
 * group exposes one shared `asset` of jest mocks and assert the wrapper
 * delegates + maps correctly.
 */
const asset = {
  resources_listAndFilterByOptions: jest.fn(),
  resources_getAll: jest.fn(),
  resourceFields_get: jest.fn(),
};

jest.mock('@fnndsc/cumin', () => {
  const Group = jest.fn().mockImplementation(() => ({ asset }));
  return {
    ChRISTagGroup: Group,
    ChRISGroupGroup: Group,
    ChRISComputeResourceGroup: Group,
    ChRISWorkflowGroup: Group,
    ChRISPluginMetaGroup: Group,
    ChRISPluginInstanceGroup: Group,
  };
});

import { tags_list, tags_listAll, tagFields_get } from '../src/tags/index';
import { groups_list, groups_listAll, groupFields_get } from '../src/groups/index';
import {
  computeResources_list,
  computeResources_listAll,
  computeResourceFields_get,
} from '../src/compute/index';
import { workflows_list, workflows_listAll, workflowFields_get } from '../src/workflows/index';
import {
  pluginMetas_list,
  pluginMetas_listAll,
  pluginMetaFields_get,
} from '../src/pluginmetas/index';
import {
  pluginInstances_listAll,
  pluginInstanceFields_get,
} from '../src/plugininstances/index';

const DATA = { tableData: [{ a: 1 }], selectedFields: ['a'] } as unknown;

beforeEach(() => {
  asset.resources_listAndFilterByOptions.mockReset();
  asset.resources_getAll.mockReset();
  asset.resourceFields_get.mockReset();
});

describe.each([
  ['tags', tags_list, tags_listAll, tagFields_get],
  ['groups', groups_list, groups_listAll, groupFields_get],
  ['compute', computeResources_list, computeResources_listAll, computeResourceFields_get],
  ['workflows', workflows_list, workflows_listAll, workflowFields_get],
  ['pluginmetas', pluginMetas_list, pluginMetas_listAll, pluginMetaFields_get],
])('%s intent wrappers', (_name, list, listAll, fields) => {
  it('list delegates to resources_listAndFilterByOptions', async () => {
    asset.resources_listAndFilterByOptions.mockResolvedValue(DATA);
    expect(await list({ limit: 10, offset: 0 } as never)).toBe(DATA);
    expect(asset.resources_listAndFilterByOptions).toHaveBeenCalledWith({ limit: 10, offset: 0 });
  });

  it('listAll delegates to resources_getAll', async () => {
    asset.resources_getAll.mockResolvedValue(DATA);
    expect(await listAll()).toBe(DATA);
  });

  it('fields_get returns the fields array', async () => {
    asset.resourceFields_get.mockResolvedValue({ fields: ['x', 'y'] });
    expect(await fields()).toEqual(['x', 'y']);
  });

  it('fields_get returns null when there is no result', async () => {
    asset.resourceFields_get.mockResolvedValue(null);
    expect(await fields()).toBeNull();
  });
});

describe('plugininstances wrappers', () => {
  it('listAll delegates to resources_getAll', async () => {
    asset.resources_getAll.mockResolvedValue(DATA);
    expect(await pluginInstances_listAll()).toBe(DATA);
  });

  it('fields_get returns the fields array, or null', async () => {
    asset.resourceFields_get.mockResolvedValue({ fields: ['id'] });
    expect(await pluginInstanceFields_get()).toEqual(['id']);
    asset.resourceFields_get.mockResolvedValue(null);
    expect(await pluginInstanceFields_get()).toBeNull();
  });
});
