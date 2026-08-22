/**
 * Tests for the chili ls command core: parallel dirs/files/links assembly,
 * item mapping (chrislink stripping, path normalization, defaults), partial
 * failure reporting, feed and plugin-instance title enrichment (including its
 * deliberate cosmetic absorption), and sort/reverse handling.
 */
const mockListAll = jest.fn();
const mockFeedsList = jest.fn();
const mockInstancesList = jest.fn();
jest.mock('@fnndsc/salsa', () => ({
  files_listAll: (...args: unknown[]) => mockListAll(...args),
  feeds_list: (...args: unknown[]) => mockFeedsList(...args),
  pluginInstances_list: (...args: unknown[]) => mockInstancesList(...args),
}));
jest.mock('../src/utils/cli', () => ({
  path_resolveChrisFs: jest.fn(async (p: string) => p || '/home/chris'),
}));

import { files_list } from '../src/commands/fs/ls';
import { errorStack } from '@fnndsc/cumin';

/** Routes files_listAll by asset name. */
function listByAsset(map: Record<string, unknown>): void {
  mockListAll.mockImplementation(async (_o: unknown, asset: string) => {
    const entry = map[asset];
    if (entry instanceof Error) throw entry;
    return entry ?? null;
  });
}

let pushSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  pushSpy = jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
  mockFeedsList.mockResolvedValue(null);
  mockInstancesList.mockResolvedValue(null);
});
afterEach(() => {
  pushSpy.mockRestore();
});

describe('files_list assembly and mapping', () => {
  it('merges dirs, files, and links with normalized fields', async () => {
    listByAsset({
      dirs: { tableData: [{ fname: 'sub', owner_username: 'chris', creation_date: 'd1' }] },
      files: { tableData: [{ fname: 'nested/path/a.txt', fsize: 42, path: 'home/chris/a.txt' }] },
      links: { tableData: [{ fname: 'shortcut.chrislink', path: 'target/dir' }] },
    });
    const items = await files_list({});
    const byType = Object.fromEntries(items.map((i) => [i.type, i]));

    expect(byType.dir).toMatchObject({ name: 'sub', owner: 'chris', date: 'd1' });
    expect(byType.file).toMatchObject({ name: 'a.txt', size: 42, target: '/home/chris/a.txt' });
    expect(byType.link).toMatchObject({ name: 'shortcut', target: '/target/dir' });
  });

  it('defaults missing size, owner, and date', async () => {
    listByAsset({ dirs: { tableData: [{ fname: 'bare' }] }, files: null, links: null });
    const [item] = await files_list({});
    expect(item).toMatchObject({ size: 0, owner: 'unknown', date: '' });
  });

  it('reports each failed asset listing without dropping the others', async () => {
    listByAsset({
      dirs: new Error('dirs down'),
      files: { tableData: [{ fname: 'ok.txt' }] },
      links: new Error('links down'),
    });
    const items = await files_list({});
    expect(items.map((i) => i.name)).toEqual(['ok.txt']);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('directories'));
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('links'));
  });

  it('sorts by name by default and honours reverse', async () => {
    listByAsset({
      dirs: null,
      files: { tableData: [{ fname: 'b.txt' }, { fname: 'a.txt' }, { fname: 'c.txt' }] },
      links: null,
    });
    const asc = await files_list({});
    expect(asc.map((i) => i.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    const desc = await files_list({ reverse: true });
    expect(desc.map((i) => i.name)).toEqual(['c.txt', 'b.txt', 'a.txt']);
  });
});

describe('title enrichment', () => {
  it('titles feed_N directories from the feed name', async () => {
    listByAsset({ dirs: { tableData: [{ fname: 'feed_12' }] }, files: null, links: null });
    mockFeedsList.mockResolvedValue({ tableData: [{ name: 'Brain run' }] });
    const [item] = await files_list({});
    expect(mockFeedsList).toHaveBeenCalledWith({ id: 12, limit: 1 });
    expect(item.title).toBe('Brain run');
  });

  it('titles pl-name_N directories from the instance plugin and version', async () => {
    listByAsset({ dirs: { tableData: [{ fname: 'pl-dircopy_44' }] }, files: null, links: null });
    mockInstancesList.mockResolvedValue({ tableData: [{ plugin_name: 'pl-dircopy', plugin_version: '2.1.2' }] });
    const [item] = await files_list({});
    expect(mockInstancesList).toHaveBeenCalledWith({ id: 44, limit: 1 });
    expect(item.title).toBe('pl-dircopy v2.1.2');
  });

  it('omits the version suffix when the instance has none', async () => {
    listByAsset({ dirs: { tableData: [{ fname: 'pl-fshack_9' }] }, files: null, links: null });
    mockInstancesList.mockResolvedValue({ tableData: [{ plugin_name: 'pl-fshack' }] });
    const [item] = await files_list({});
    expect(item.title).toBe('pl-fshack');
  });

  it('leaves the raw name when an enrichment lookup fails (deliberate absorption)', async () => {
    listByAsset({ dirs: { tableData: [{ fname: 'feed_12' }, { fname: 'pl-x_3' }] }, files: null, links: null });
    mockFeedsList.mockRejectedValue(new Error('cube down'));
    mockInstancesList.mockRejectedValue(new Error('cube down'));
    const items = await files_list({});
    expect(items.map((i) => i.name).sort()).toEqual(['feed_12', 'pl-x_3']);
    expect(items.every((i) => i.title === undefined)).toBe(true);
  });

  it('does not enrich non-directory items or non-matching names', async () => {
    listByAsset({
      dirs: { tableData: [{ fname: 'plain-dir' }] },
      files: { tableData: [{ fname: 'feed_12' }] },
      links: null,
    });
    await files_list({});
    expect(mockFeedsList).not.toHaveBeenCalled();
    expect(mockInstancesList).not.toHaveBeenCalled();
  });
});
