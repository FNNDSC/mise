import { feed_create } from '../src/feeds/index';
import { ChRISFeed } from '@fnndsc/cumin';

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
});
