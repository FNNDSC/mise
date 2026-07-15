import {
  path_isInFeed,
  path_extractPluginInstanceID,
  path_extractFeedID,
  path_findLatestDircopy,
} from '../src/path/chrisPath';

describe('path_isInFeed()', () => {
  it('returns true for a path inside a feed directory', () => {
    expect(path_isInFeed('/home/chris/feeds/feed_123/pl-dircopy_456/data/')).toBe(true);
  });

  it('returns true when the feed segment is anywhere in the path', () => {
    expect(path_isInFeed('/x/feeds/feed_1/')).toBe(true);
  });

  it('returns false for a non-feed path', () => {
    expect(path_isInFeed('/home/chris/uploads/data/')).toBe(false);
  });

  it('returns false when feed_ has no numeric id', () => {
    expect(path_isInFeed('/home/chris/feeds/feed_abc/')).toBe(false);
  });

  it('returns false when the trailing slash is missing', () => {
    expect(path_isInFeed('/home/chris/feeds/feed_123')).toBe(false);
  });
});

describe('path_extractPluginInstanceID()', () => {
  it('extracts the id from a deep subdirectory', () => {
    expect(
      path_extractPluginInstanceID('/home/chris/feeds/feed_123/pl-dircopy_456/data/sub/dir/')
    ).toBe(456);
  });

  it('extracts the id from the data directory (nearest ancestor wins)', () => {
    expect(
      path_extractPluginInstanceID('/home/chris/feeds/feed_123/pl-dcm2niix_789/data/')
    ).toBe(789);
  });

  it('returns the nearest instance dir when several are ancestors', () => {
    expect(
      path_extractPluginInstanceID('/feeds/feed_1/pl-a_10/pl-b_20/data/')
    ).toBe(20);
  });

  it('returns null when no ancestor matches the instance pattern', () => {
    expect(path_extractPluginInstanceID('/home/chris/uploads/data/')).toBeNull();
  });

  it('returns null at the filesystem root', () => {
    expect(path_extractPluginInstanceID('/')).toBeNull();
  });
});

describe('path_extractFeedID()', () => {
  it('extracts the feed id', () => {
    expect(path_extractFeedID('/home/chris/feeds/feed_123/pl-dircopy_456/data/')).toBe(123);
  });

  it('extracts a feed id from any feed directory segment', () => {
    expect(path_extractFeedID('/proc/jobs/feed_123')).toBe(123);
    expect(path_extractFeedID('/proc/jobs/feed_123/pl-dircopy_456')).toBe(123);
    expect(path_extractFeedID('/home/chris/feeds/feed_123')).toBe(123);
  });

  it('returns null when there is no feed segment', () => {
    expect(path_extractFeedID('/home/chris/uploads/data/')).toBeNull();
  });

  it('returns null when feed_ has no numeric id', () => {
    expect(path_extractFeedID('/home/chris/feeds/feed_x/')).toBeNull();
  });
});

describe('path_findLatestDircopy()', () => {
  it('returns null when no dircopy plugin is present', () => {
    expect(path_findLatestDircopy(['pl-other-v1.0.0', 'pl-foo-v2.0.0'])).toBeNull();
  });

  it('returns the sole dircopy plugin when only one exists', () => {
    expect(path_findLatestDircopy(['pl-dircopy-v1.0.0', 'pl-other-v1.0.0'])).toBe(
      'pl-dircopy-v1.0.0'
    );
  });

  it('returns the highest version across major/minor/patch', () => {
    const plugins = [
      'pl-dircopy-v1.0.0',
      'pl-dircopy-v2.1.0',
      'pl-dircopy-v2.1.5',
      'pl-dircopy-v2.0.9',
      'pl-other-v9.9.9',
    ];
    expect(path_findLatestDircopy(plugins)).toBe('pl-dircopy-v2.1.5');
  });

  it('compares minor when majors tie, patch when minors tie', () => {
    expect(
      path_findLatestDircopy(['pl-dircopy-v3.2.1', 'pl-dircopy-v3.4.0', 'pl-dircopy-v3.4.1'])
    ).toBe('pl-dircopy-v3.4.1');
  });

  it('falls back to the first when every version string is unparseable', () => {
    // Both start with pl-dircopy-v (so they pass the filter) but neither matches
    // the strict X.Y.Z version pattern -> version parsing yields nothing.
    const plugins = ['pl-dircopy-v1.0', 'pl-dircopy-vbeta'];
    expect(path_findLatestDircopy(plugins)).toBe('pl-dircopy-v1.0');
  });
});
