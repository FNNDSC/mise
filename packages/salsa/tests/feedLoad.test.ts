/**
 * Orchestration tests for feedGraphData_ensure — verifies it reuses a warm cache and only
 * does a cheap status refresh when the topology was already loaded.
 */
const feedInstances_ensureLoaded = jest.fn(async (): Promise<void> => undefined);
const feedMeta_ensure = jest.fn(async (): Promise<void> => undefined);
const feedStatus_refresh = jest.fn(async (): Promise<void> => undefined);
const feedJoins_ensure = jest.fn(async (): Promise<void> => undefined);
const topologyLoaded_has = jest.fn();

jest.mock('../src/vfs/providers/proc', () => ({ feedInstances_ensureLoaded, feedMeta_ensure, feedStatus_refresh }));
jest.mock('../src/dag/feedJoins', () => ({ feedJoins_ensure }));
jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  procCache_get: () => ({ topologyLoaded_has }),
}));

import { feedGraphData_ensure } from '../src/dag/feedLoad';

beforeEach(() => jest.clearAllMocks());

describe('feedGraphData_ensure', () => {
  it('cold cache: loads topology + meta + joins, no status refresh', async () => {
    topologyLoaded_has.mockReturnValue(false);
    await feedGraphData_ensure(5);
    expect(feedInstances_ensureLoaded).toHaveBeenCalledWith(5);
    expect(feedMeta_ensure).toHaveBeenCalledWith(5);
    expect(feedJoins_ensure).toHaveBeenCalledWith(5);
    expect(feedStatus_refresh).not.toHaveBeenCalled(); // cold load already carried status
  });

  it('warm cache: reuses topology and does a cheap status refresh', async () => {
    topologyLoaded_has.mockReturnValue(true);
    await feedGraphData_ensure(5);
    expect(feedStatus_refresh).toHaveBeenCalledWith(5);
    expect(feedJoins_ensure).toHaveBeenCalledWith(5);
  });
});
