/**
 * Boundary-only tests for the feeds intents. Partial mock of cumin: real
 * Ok/Err/errorStack; stubbed ChRISFeedGroup, ChRISFeed and the feed_* helpers.
 */
const mockFeedAsset = {
  resources_listAndFilterByOptions: jest.fn(),
  resources_getAll: jest.fn(),
  resourceFields_get: jest.fn(),
};
const mockCreateFromDirs = jest.fn();
const mockMakePublic = jest.fn();
const mockMakePrivate = jest.fn();
const mockFeedDelete = jest.fn();

jest.mock('@fnndsc/cumin', () => {
  const actual = jest.requireActual('@fnndsc/cumin');
  return {
    ...actual,
    ChRISFeedGroup: jest.fn().mockImplementation(() => ({ asset: mockFeedAsset })),
    ChRISFeed: jest.fn().mockImplementation(() => ({ createFromDirs: mockCreateFromDirs })),
    feed_makePublic: mockMakePublic,
    feed_makePrivate: mockMakePrivate,
    feed_delete: mockFeedDelete,
  };
});

import { Ok, Err, errorStack } from '@fnndsc/cumin';
import {
  feeds_list,
  feeds_listAll,
  feedFields_get,
  feed_create,
  feeds_share,
  feed_delete,
} from '../src/feeds/index';

beforeEach(() => {
  jest.clearAllMocks();
  errorStack.stack_clear();
});

describe('feeds list/fields', () => {
  it('feeds_list delegates to the group asset', async () => {
    mockFeedAsset.resources_listAndFilterByOptions.mockResolvedValue('DATA');
    expect(await feeds_list({ limit: 1, offset: 0 } as never)).toBe('DATA');
  });

  it('feeds_listAll delegates to resources_getAll', async () => {
    mockFeedAsset.resources_getAll.mockResolvedValue('ALL');
    expect(await feeds_listAll()).toBe('ALL');
  });

  it('feedFields_get returns the fields, or null', async () => {
    mockFeedAsset.resourceFields_get.mockResolvedValue({ fields: ['id', 'title'] });
    expect(await feedFields_get()).toEqual(['id', 'title']);
    mockFeedAsset.resourceFields_get.mockResolvedValue(null);
    expect(await feedFields_get()).toBeNull();
  });
});

describe('feed_create', () => {
  it('joins an array of dirs and forwards params', async () => {
    mockCreateFromDirs.mockResolvedValue({ id: 1 });
    expect(await feed_create(['/a', '/b'], { name: 'f' })).toEqual({ id: 1 });
    expect(mockCreateFromDirs).toHaveBeenCalledWith('/a,/b', { name: 'f' });
  });

  it('passes a non-array dirs argument through unchanged', async () => {
    mockCreateFromDirs.mockResolvedValue({ id: 2 });
    await feed_create('/single' as unknown as string[]);
    expect(mockCreateFromDirs).toHaveBeenCalledWith('/single', {});
  });
});

describe('feeds_share', () => {
  it('makes a feed public', async () => {
    mockMakePublic.mockResolvedValue(Ok(true));
    expect(await feeds_share(5, { is_public: true })).toBe(true);
    expect(mockMakePublic).toHaveBeenCalledWith(5);
  });

  it('makes a feed private', async () => {
    mockMakePrivate.mockResolvedValue(Ok(true));
    expect(await feeds_share(5, { is_public: false })).toBe(true);
  });

  it('returns false and records an error with no valid option', async () => {
    expect(await feeds_share(5, {})).toBe(false);
    expect(errorStack.stack_search('No valid sharing option').length).toBeGreaterThan(0);
  });

  it('returns false when the underlying op errors', async () => {
    mockMakePublic.mockResolvedValue(Err());
    expect(await feeds_share(5, { is_public: true })).toBe(false);
  });
});

describe('feed_delete', () => {
  it('returns true on success and false on failure', async () => {
    mockFeedDelete.mockResolvedValue(Ok(true));
    expect(await feed_delete(9)).toBe(true);
    mockFeedDelete.mockResolvedValue(Err());
    expect(await feed_delete(9)).toBe(false);
  });
});
