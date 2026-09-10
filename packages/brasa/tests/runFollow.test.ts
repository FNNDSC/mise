/**
 * @file A run just started is followed until it settles.
 *
 * The defect this exists for: a new feed entered the cache with its jobs
 * SCHEDULED, which is what they are at the instant of creation, and nothing
 * ever revisited them. The operator's own run never turned over to running
 * and never turned over to finished, so the lab's pulse in the header
 * counted it as scheduled for as long as the cache lived. One header read
 * `SCHEDULED 90` with nothing running at all — not a gauge, a tally of
 * everything that identity had ever started.
 *
 * The sampler already knew when to stop. What was missing was anyone
 * starting it when the operator was not looking at a pane.
 *
 * @module
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const feedAdd = jest.fn();
const instanceAdd = jest.fn();
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  procCache_get: (): unknown => ({ feed_add: feedAdd, instance_add: instanceAdd }),
}));
const watchAdd = jest.fn(() => 'live');
jest.unstable_mockModule('../src/builtins/procWatch.js', () => ({ procWatch_add: watchAdd }));

const { newFeed_cacheAdd, run_follow, RUN_WATCH_OWNER } = await import('../src/builtins/feedCreation.js');

/** Lets the lazily-imported sampler resolve before asserting. */
const settled = async (): Promise<void> => { await new Promise((resolve): void => { setTimeout(resolve, 0); }); };

beforeEach((): void => { jest.clearAllMocks(); });

describe('a run just started', () => {
  it('is watched, so the header stops counting it as scheduled forever', async () => {
    run_follow(4465);
    await settled();
    expect(watchAdd).toHaveBeenCalledWith(4465, RUN_WATCH_OWNER);
  });

  it('is followed by the run, never by the cache write', async () => {
    // Recording a feed is a cache write and nothing more. A helper that
    // quietly began visiting a remote service would surprise every caller,
    // and when it was tried every test that records a feed started a
    // sampler — which is how this line came to be here.
    newFeed_cacheAdd({ feedID: 4465, title: 'SAG-anon', ownerUsername: 'me', rootInstanceID: 590411 });
    await settled();
    expect(watchAdd).not.toHaveBeenCalled();
    expect(feedAdd).toHaveBeenCalledTimes(1);
    expect(instanceAdd).toHaveBeenCalledTimes(1);
  });

  it('counts its child as scheduled work, which is what the pulse reads', async () => {
    newFeed_cacheAdd({
      feedID: 4465, title: 'SAG-anon', ownerUsername: 'me', rootInstanceID: 590411,
      child: { id: 590412, pluginName: 'pl-dcm2niix' },
    });
    await settled();
    expect(feedAdd.mock.calls[0]?.[0]).toMatchObject({ id: 4465, scheduledJobs: 2 });
    expect(instanceAdd).toHaveBeenCalledTimes(2);
  });

  it('is followed by the run itself, not by a pane, so nobody has to be looking', async () => {
    run_follow(1);
    await settled();
    expect(RUN_WATCH_OWNER).toBe('kernel:run');
    expect(watchAdd).toHaveBeenCalledWith(1, 'kernel:run');
  });
});
