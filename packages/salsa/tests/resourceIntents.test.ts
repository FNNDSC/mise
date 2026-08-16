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
const groupMembersGetAll = jest.fn();
const groupUserAdd = jest.fn();
const groupUserRemove = jest.fn();
const errorPop = jest.fn();

jest.mock('@fnndsc/cumin', () => {
  const Group = jest.fn().mockImplementation(() => ({ asset }));
  return {
    ChRISTagGroup: Group,
    ChRISGroupGroup: Group,
    ChRISComputeResourceGroup: Group,
    ChRISWorkflowGroup: Group,
    ChRISPluginMetaGroup: Group,
    ChRISPluginInstanceGroup: Group,
    groupMembers_getAll: groupMembersGetAll,
    groupUser_add: groupUserAdd,
    groupUser_remove: groupUserRemove,
    errorStack: { stack_pop: errorPop },
  };
});

import { tags_list, tags_listAll, tagFields_get } from '../src/tags/index';
import {
  groups_list,
  groups_listAll,
  groupFields_get,
  groupReference_resolve,
  groupMembers_getAll,
  groupUser_add,
  groupUser_remove,
} from '../src/groups/index';
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
  groupMembersGetAll.mockReset();
  groupUserAdd.mockReset();
  groupUserRemove.mockReset();
  errorPop.mockReset();
});

describe('group membership intents', () => {
  it('resolves an exact group name to its numeric CUBE ID', async (): Promise<void> => {
    asset.resources_getAll.mockResolvedValue({
      tableData: [{ id: 7, name: 'pacs_users' }, { id: 9, name: 'research' }],
      selectedFields: ['id', 'name'],
    });

    await expect(groupReference_resolve('pacs_users')).resolves.toEqual({
      ok: true,
      value: { id: 7, name: 'pacs_users' },
    });
  });

  it('preserves a numeric group ID and rejects an unknown exact name', async (): Promise<void> => {
    asset.resources_getAll.mockResolvedValue({
      tableData: [{ id: 7, name: 'pacs_users' }],
      selectedFields: ['id', 'name'],
    });

    await expect(groupReference_resolve('7')).resolves.toEqual({
      ok: true,
      value: { id: 7, name: 'pacs_users' },
    });
    await expect(groupReference_resolve('no_such_group')).resolves.toEqual({
      ok: false,
      error: "No group named 'no_such_group'.",
    });
  });

  it('never guesses when an exact group name is ambiguous', async (): Promise<void> => {
    asset.resources_getAll.mockResolvedValue({
      tableData: [{ id: 7, name: 'pacs_users' }, { id: 9, name: 'pacs_users' }],
      selectedFields: ['id', 'name'],
    });

    await expect(groupReference_resolve('pacs_users')).resolves.toEqual({
      ok: false,
      error: "Group name 'pacs_users' is ambiguous: pacs_users (7), pacs_users (9). Use a numeric ID.",
    });
  });

  it('presents successful membership operations', async () => {
    groupMembersGetAll.mockResolvedValue({
      ok: true,
      value: [{ id: 12, username: 'peter.hong' }],
    });
    groupUserAdd.mockResolvedValue({ ok: true, value: { id: 12, username: 'peter.hong' } });
    groupUserRemove.mockResolvedValue({ ok: true, value: true });

    await expect(groupMembers_getAll(7)).resolves.toEqual({
      ok: true,
      value: [{ id: 12, username: 'peter.hong' }],
    });
    await expect(groupUser_add(7, 'peter.hong')).resolves.toEqual({
      ok: true,
      value: { id: 12, username: 'peter.hong' },
    });
    await expect(groupUser_remove(7, 'peter.hong')).resolves.toEqual({ ok: true, value: true });
  });

  it('carries the CUBE error across the Salsa boundary', async () => {
    groupUserAdd.mockResolvedValue({ ok: false });
    errorPop.mockReturnValue({ message: 'Request failed with status code 403' });

    await expect(groupUser_add(7, 'peter.hong')).resolves.toEqual({
      ok: false,
      error: 'Request failed with status code 403',
    });
  });
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
