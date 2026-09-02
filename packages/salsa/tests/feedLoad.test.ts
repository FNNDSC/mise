/**
 * Orchestration tests for feedGraphData_ensure — verifies it reuses a warm cache and runs
 * the visit delta (not a re-crawl) only when the topology was already loaded.
 */
const feedInstances_ensureLoaded = jest.fn(async (): Promise<void> => undefined);
const feedMeta_ensure = jest.fn(async (): Promise<void> => undefined);
const feedVisit_sync = jest.fn(async (): Promise<void> => undefined);
const feedJoins_ensure = jest.fn(async (): Promise<void> => undefined);
const topologyLoaded_has = jest.fn();
const feedInstanceIDs_get = jest.fn((): number[] => []);
const instance_get = jest.fn();

jest.mock('../src/vfs/providers/proc', () => ({ feedInstances_ensureLoaded, feedMeta_ensure, feedVisit_sync }));
jest.mock('../src/dag/feedJoins', () => ({ feedJoins_ensure }));
jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  procCache_get: () => ({ topologyLoaded_has, feedInstanceIDs_get, instance_get }),
}));

import { feedGraphData_ensure } from '../src/dag/feedLoad';

beforeEach(() => jest.clearAllMocks());

describe('feedGraphData_ensure', () => {
  it('cold cache: loads topology + meta + joins, no visit delta', async () => {
    topologyLoaded_has.mockReturnValue(false);
    await feedGraphData_ensure(5);
    expect(feedInstances_ensureLoaded).toHaveBeenCalledWith(5);
    expect(feedMeta_ensure).toHaveBeenCalledWith(5);
    expect(feedJoins_ensure).toHaveBeenCalledWith(5);
    expect(feedVisit_sync).not.toHaveBeenCalled(); // cold load already carried status
  });

  it('warm cache: reuses topology and runs the visit delta (which prices itself)', async () => {
    topologyLoaded_has.mockReturnValue(true);
    await feedGraphData_ensure(5);
    expect(feedInstances_ensureLoaded).toHaveBeenCalledWith(5);
    expect(feedVisit_sync).toHaveBeenCalledWith(5);
    expect(feedJoins_ensure).toHaveBeenCalledWith(5);
  });
});
