import { feed_create, feeds_list } from '../src/feeds/index';
import { ChRISFeed, ChRISFeedGroup } from '@fnndsc/cumin';

// Mock the whole cumin library
jest.mock('@fnndsc/cumin');

describe('feeds', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('feed_create should call ChRISFeed.createFromDirs', async () => {
    const mockCreateFromDirs = jest.fn().mockResolvedValue({ id: 1, name: 'test-feed' });
    
    // Mock implementation of ChRISFeed
    (ChRISFeed as jest.Mock).mockImplementation(() => {
      return {
        createFromDirs: mockCreateFromDirs,
      };
    });

    const dirs = ['/tmp/data'];
    const params = { name: 'test-feed' };

    const result = await feed_create(dirs, params);

    expect(ChRISFeed).toHaveBeenCalledTimes(1);
    expect(mockCreateFromDirs).toHaveBeenCalledWith('/tmp/data', params);
    expect(result).toEqual({ id: 1, name: 'test-feed' });
  });

  it('feed_create should handle array of dirs by joining them (if that is the logic)', async () => {
     const mockCreateFromDirs = jest.fn().mockResolvedValue(null);
      (ChRISFeed as jest.Mock).mockImplementation(() => ({
        createFromDirs: mockCreateFromDirs
      }));

      const dirs = ['/a', '/b'];
      await feed_create(dirs);

      expect(mockCreateFromDirs).toHaveBeenCalledWith('/a,/b', {});
  });

  it('feeds_list should call ChRISFeedGroup.resources_listAndFilterByOptions', async () => {
    const mockFilteredData = {
      tableData: [
        { id: 875, name: 'Brain MRI Analysis', creation_date: '2025-05-18T17:21:19.000000Z' }
      ],
      count: 1,
      limit: 1,
      offset: 0
    };
    const mockListAndFilter = jest.fn().mockResolvedValue(mockFilteredData);

    (ChRISFeedGroup as jest.Mock).mockImplementation(() => ({
      asset: {
        resources_listAndFilterByOptions: mockListAndFilter
      }
    }));

    const options = { id: 875, limit: 1 };
    const result = await feeds_list(options);

    expect(ChRISFeedGroup).toHaveBeenCalledTimes(1);
    expect(mockListAndFilter).toHaveBeenCalledWith(options);
    expect(result).toEqual(mockFilteredData);
  });

  it('feeds_list should return null when no feeds found', async () => {
    const mockListAndFilter = jest.fn().mockResolvedValue(null);

    (ChRISFeedGroup as jest.Mock).mockImplementation(() => ({
      asset: {
        resources_listAndFilterByOptions: mockListAndFilter
      }
    }));

    const result = await feeds_list({ id: 999 });

    expect(mockListAndFilter).toHaveBeenCalledWith({ id: 999 });
    expect(result).toBeNull();
  });

  it('feeds_list should handle multiple feeds', async () => {
    const mockFilteredData = {
      tableData: [
        { id: 1, name: 'Feed 1' },
        { id: 2, name: 'Feed 2' },
        { id: 3, name: 'Feed 3' }
      ],
      count: 3,
      limit: 10,
      offset: 0
    };
    const mockListAndFilter = jest.fn().mockResolvedValue(mockFilteredData);

    (ChRISFeedGroup as jest.Mock).mockImplementation(() => ({
      asset: {
        resources_listAndFilterByOptions: mockListAndFilter
      }
    }));

    const options = { limit: 10 };
    const result = await feeds_list(options);

    expect(mockListAndFilter).toHaveBeenCalledWith(options);
    expect(result?.tableData).toHaveLength(3);
  });
});
