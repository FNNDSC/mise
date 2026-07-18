/**
 * Boundary-only tests for the internal plugin executors. Real cumin path
 * helpers; stubbed salsa feed_create and plugin_run.
 */
const mockFeedCreate = jest.fn();
const mockPluginRun = jest.fn();

jest.mock('../src/feeds/index', () => ({ feed_create: mockFeedCreate }));
jest.mock('../src/plugins/index', () => ({ plugin_run: mockPluginRun }));

import { errorStack } from '@fnndsc/cumin';
import { plugin_executeNewFeed } from '../src/plugins/internal/plugin_executeNewFeed';
import { plugin_executeContinueFeed } from '../src/plugins/internal/plugin_executeContinueFeed';

beforeEach(() => {
  jest.clearAllMocks();
  errorStack.stack_clear();
});

describe('plugin_executeNewFeed', () => {
  const bin = ['pl-dircopy-v1.0.0'];

  it('creates a feed, runs the plugin, and builds the output path', async () => {
    mockFeedCreate.mockResolvedValue({ id: 123, pluginInstance: { data: { id: 456 } } });
    mockPluginRun.mockResolvedValue({ id: 789, plugin_name: 'pl-x' });

    const r = await plugin_executeNewFeed(
      'pl-x',
      {},
      { feed_title: 'Baseline, repeat: 2', instance_title: 'T' },
      '/home/chris/uploads/d',
      bin,
    );
    expect(mockFeedCreate).toHaveBeenCalledWith(
      ['/home/chris/uploads/d'],
      { title: 'Baseline, repeat: 2' },
    );
    expect(r).toMatchObject({
      feedID: 123,
      dircopyInstanceID: 456,
      pluginInstanceID: 789,
      pluginName: 'pl-x',
      parentID: 456,
      outputPath: '/home/chris/feeds/feed_123/pl-dircopy_456/pl-x_789/data/',
    });
  });

  it('fails when pl-dircopy is not in the bin listing', async () => {
    expect(await plugin_executeNewFeed('pl-x', {}, {}, '/home/chris/uploads/d', [])).toBeNull();
  });

  it('fails when feed creation fails', async () => {
    mockFeedCreate.mockResolvedValue(null);
    expect(await plugin_executeNewFeed('pl-x', {}, {}, '/home/chris/uploads/d', bin)).toBeNull();
  });

  it('fails when the plugin run fails', async () => {
    mockFeedCreate.mockResolvedValue({ id: 1, pluginInstance: { data: { id: 2 } } });
    mockPluginRun.mockResolvedValue(null);
    expect(await plugin_executeNewFeed('pl-x', {}, {}, '/home/chris/uploads/d', bin)).toBeNull();
  });
});

describe('plugin_executeContinueFeed', () => {
  const cwd = '/home/chris/feeds/feed_123/pl-dircopy_456/data/';

  it('runs the plugin within the existing feed and builds the output path', async () => {
    mockPluginRun.mockResolvedValue({ id: 789, plugin_name: 'pl-seg' });
    const r = await plugin_executeContinueFeed('pl-seg', {}, { instance_title: 'T' }, cwd);
    expect(r).toMatchObject({
      pluginInstanceID: 789,
      pluginName: 'pl-seg',
      parentID: 456,
      outputPath: '/home/chris/feeds/feed_123/pl-dircopy_456/pl-seg_789/data/',
    });
  });

  it('fails when no plugin instance id can be extracted', async () => {
    expect(await plugin_executeContinueFeed('pl-seg', {}, {}, '/home/chris/uploads/data')).toBeNull();
  });

  it('fails when no feed id can be extracted', async () => {
    expect(await plugin_executeContinueFeed('pl-seg', {}, {}, '/tmp/pl-a_5/data')).toBeNull();
  });

  it('fails when the plugin run fails', async () => {
    mockPluginRun.mockResolvedValue(null);
    expect(await plugin_executeContinueFeed('pl-seg', {}, {}, cwd)).toBeNull();
  });
});
