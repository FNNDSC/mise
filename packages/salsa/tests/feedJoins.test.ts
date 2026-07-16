/**
 * Unit tests for lazy topological-join (ts) edge resolution. Real ProcCache; the
 * chrisapi client (getPluginInstance -> getParameters) is stubbed.
 */
const mockClientGet = jest.fn();
jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  chrisConnection: { client_get: mockClientGet },
}));

import { procCache_get, ProcCache, ProcInstance } from '@fnndsc/cumin';
import { feedJoins_ensure, nodeJoins_resolve } from '../src/dag/feedJoins';

const cache: ProcCache = procCache_get();

function add(
  id: number, parentID: number | null, pluginName: string,
  pluginType?: string,
): void {
  const inst: ProcInstance = {
    id, feedID: 5, parentID, pluginName, params: null, status: 'finishedSuccessfully', pluginType,
  };
  cache.instance_add(inst);
}

/** Fake client whose ts node reports plugininstances "10,20" (anchor 10 + source 20). */
function client_withParams(value: string, getParameters = jest.fn()) {
  getParameters.mockResolvedValue({
    data: [
      { param_name: 'plugininstances', value },
      { param_name: 'groupByInstance', value: true },
    ],
  });
  return { getPluginInstance: jest.fn().mockResolvedValue({ getParameters }) };
}

beforeEach(() => {
  cache.cache_clear();
  jest.clearAllMocks();
});

describe('nodeJoins_resolve', () => {
  it('records the overlay as sources minus the anchor parent', async () => {
    add(10, null, 'pl-root');
    add(30, 10, 'pl-topologicalcopy', 'ts');
    mockClientGet.mockResolvedValue(client_withParams('10,20'));

    await nodeJoins_resolve(30);
    expect(cache.joinParents_get(30)).toEqual([20]);
  });

  it('skips a non-join node without any API call', async () => {
    add(11, 10, 'pl-dcm2niix', 'ds');
    const client = client_withParams('10,20');
    mockClientGet.mockResolvedValue(client);

    await nodeJoins_resolve(11);
    expect(client.getPluginInstance).not.toHaveBeenCalled();
    expect(cache.joinParents_get(11)).toEqual([]);
  });

  it('skips an already-resolved node', async () => {
    add(30, 10, 'pl-topologicalcopy', 'ts');
    cache.joinParents_update(30, [20]);
    const client = client_withParams('10,20,99');
    mockClientGet.mockResolvedValue(client);

    await nodeJoins_resolve(30);
    expect(client.getPluginInstance).not.toHaveBeenCalled();
    expect(cache.joinParents_get(30)).toEqual([20]);
  });

  it('falls back to a name match when pluginType is absent', async () => {
    add(30, 10, 'pl-topologicalcopy'); // no pluginType
    mockClientGet.mockResolvedValue(client_withParams('10,42'));

    await nodeJoins_resolve(30);
    expect(cache.joinParents_get(30)).toEqual([42]);
  });

  it('records an empty overlay when no plugininstances param exists', async () => {
    add(30, 10, 'pl-topologicalcopy', 'ts');
    const getParameters = jest.fn().mockResolvedValue({ data: [{ param_name: 'other', value: 'x' }] });
    mockClientGet.mockResolvedValue({ getPluginInstance: jest.fn().mockResolvedValue({ getParameters }) });

    await nodeJoins_resolve(30);
    expect(cache.joinParents_get(30)).toEqual([]);
  });

  it('records an empty overlay when the instance resource is missing', async () => {
    add(30, 10, 'pl-topologicalcopy', 'ts');
    mockClientGet.mockResolvedValue({ getPluginInstance: jest.fn().mockResolvedValue(null) });

    await nodeJoins_resolve(30);
    expect(cache.joinParents_get(30)).toEqual([]);
  });

  it('is a no-op when disconnected', async () => {
    add(30, 10, 'pl-topologicalcopy', 'ts');
    mockClientGet.mockResolvedValue(null);

    await nodeJoins_resolve(30);
    expect(cache.instance_get(30)?.joinParentIDs).toBeUndefined();
  });
});

describe('feedJoins_ensure', () => {
  it('resolves every unresolved ts node in the feed', async () => {
    cache.feed_add({
      id: 5, title: 'f', ownerUsername: '', public: false, creationDate: '', finishedJobs: 0, erroredJobs: 0,
      startedJobs: 0, scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0,
    });
    add(10, null, 'pl-root');
    add(11, 10, 'pl-dcm2niix', 'ds');
    add(30, 10, 'pl-topologicalcopy', 'ts');
    mockClientGet.mockResolvedValue(client_withParams('10,20'));

    await feedJoins_ensure(5);
    expect(cache.joinParents_get(30)).toEqual([20]);
    expect(cache.joinParents_get(11)).toEqual([]);
  });
});
