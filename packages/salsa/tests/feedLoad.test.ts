/**
 * Orchestration tests for feedGraphData_ensure — verifies it reuses a warm cache and runs
 * the visit delta (not a re-crawl) only when the topology was already loaded.
 */
const feedInstances_ensureStarted = jest.fn((): 'ready' | 'pending' => 'ready');
const feedMeta_ensure = jest.fn(async (): Promise<void> => undefined);
const feedVisit_sync = jest.fn(async (): Promise<void> => undefined);
const feedJoins_ensure = jest.fn(async (): Promise<void> => undefined);
const topologyLoaded_has = jest.fn();
const feedInstanceIDs_get = jest.fn((): number[] => []);
const instance_get = jest.fn();

jest.mock('../src/vfs/providers/proc', () => ({ feedInstances_ensureStarted, feedMeta_ensure, feedVisit_sync }));
jest.mock('../src/dag/feedJoins', () => ({ feedJoins_ensure }));
jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  procCache_get: () => ({ topologyLoaded_has, feedInstanceIDs_get, instance_get }),
}));

import { feedGraphData_ensure } from '../src/dag/feedLoad';

beforeEach(() => jest.clearAllMocks());

describe('feedGraphData_ensure', () => {
  it('cold cache: the walk is started and left to run — the answer is pending, nothing else is fetched', async () => {
    topologyLoaded_has.mockReturnValue(false);
    feedInstances_ensureStarted.mockReturnValue('pending');
    await expect(feedGraphData_ensure(5)).resolves.toBe('pending');
    expect(feedInstances_ensureStarted).toHaveBeenCalledWith(5);
    expect(feedMeta_ensure).not.toHaveBeenCalled();
    expect(feedJoins_ensure).not.toHaveBeenCalled();
    expect(feedVisit_sync).not.toHaveBeenCalled();
  });

  it('a landed cold load: meta + joins, no visit delta (the walk carried fresh status)', async () => {
    topologyLoaded_has.mockReturnValue(false);
    feedInstances_ensureStarted.mockReturnValue('ready');
    await expect(feedGraphData_ensure(5)).resolves.toBe('ready');
    expect(feedMeta_ensure).toHaveBeenCalledWith(5);
    expect(feedJoins_ensure).toHaveBeenCalledWith(5);
    expect(feedVisit_sync).not.toHaveBeenCalled();
  });

  it('warm cache: reuses topology and runs the visit delta (which prices itself)', async () => {
    topologyLoaded_has.mockReturnValue(true);
    feedInstances_ensureStarted.mockReturnValue('ready');
    await expect(feedGraphData_ensure(5)).resolves.toBe('ready');
    expect(feedVisit_sync).toHaveBeenCalledWith(5);
    expect(feedJoins_ensure).toHaveBeenCalledWith(5);
  });
});
