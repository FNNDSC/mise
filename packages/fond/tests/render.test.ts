import chalk from 'chalk';
import {
  grid_render,
  long_render,
  listingItems_sort,
  size_format,
  LISTING_CORE_KINDS,
  LISTING_LOOK_PLAIN,
  type ListingLook,
} from '../src/vfs/render';
import { VFSItem } from '../src/vfs/provider';

const item = (name: string, type: string, extra: Partial<VFSItem> = {}): VFSItem =>
  ({ name, type, size: 0, owner: 'chris', date: '2026-01-02T03:04:05.000Z', ...extra });

const plain = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');

describe('a listing with the plain look', () => {
  beforeEach(() => { process.stdout.columns = 80; });

  it('lays names out in columns, a folder ending in /', () => {
    expect(plain(grid_render([item('data', 'dir'), item('a.txt', 'file')]))).toBe('data/  a.txt');
  });

  it('puts one name on each line for -1, and nothing for no items', () => {
    expect(plain(grid_render([item('a', 'file'), item('b', 'file')], { oneColumn: true }))).toBe('a\nb');
    expect(grid_render([])).toBe('');
    expect(long_render([])).toBe('');
  });

  it('shows the long view with a mark, owner, size and date, and a link its target', () => {
    const lines: string[] = plain(long_render([
      item('data', 'dir'),
      item('big.bin', 'file', { size: 1536 }),
      item('public', 'link', { target: '/home/x/public' }),
      item('odd', 'thing'),
    ], { human: true })).split('\n');
    expect(lines[0]).toMatch(/^d chris\s+0 B\s+2026-01-02 03:04:05 data\//);
    expect(lines[1]).toMatch(/^- chris\s+1\.5 KB/);
    expect(lines[2]).toMatch(/^l .* public\s+-> \/home\/x\/public$/);
    expect(lines[3]).toMatch(/^- chris/);
  });

  it('carries a title, tags and a version', () => {
    const line: string = plain(long_render([item('feed_9', 'dir', { title: 'Brain', tags: ['mri', 'qc'], version: '1.0' })]));
    expect(line).toContain('feed_9/ (1.0)');
    expect(line).toContain('Brain    #mri #qc');
  });
});

describe('a listing with a backend look', () => {
  const look: ListingLook = {
    kinds: [...LISTING_CORE_KINDS, { type: 'job', mark: 'j', container: true, sizeColumn: (it: VFSItem): string | null => (it.status ? `<${it.status}>` : null) }],
    name_colorize: (name: string, type: string): string => (type === 'job' ? chalk.yellow(name) : name),
  };

  it('uses its kinds: their marks, containers and size column', () => {
    const lines: string[] = plain(long_render([item('pl_1', 'job', { status: 'started' }), item('pl_2', 'job', { size: 4 })], {}, look)).split('\n');
    expect(lines[0]).toMatch(/^j chris\s+<started> 2026/);
    expect(lines[1]).toMatch(/^j chris\s+4\s+2026/);
    expect(lines[0]).toContain('pl_1/');
  });

  it('colours names its way', () => {
    chalk.level = 1;
    expect(grid_render([item('pl_1', 'job')], {}, look)).toContain(chalk.yellow('pl_1'));
    expect(LISTING_LOOK_PLAIN.name_colorize('x', 'dir')).toBe('x');
  });
});

describe('listingItems_sort', () => {
  const items: VFSItem[] = [item('b', 'file', { size: 2 }), item('a', 'file', { size: 2 }), item('c', 'file', { size: 1 })];

  it('sorts by a field, and leaves the order alone without one', () => {
    expect(listingItems_sort(items, 'name').map((it: VFSItem): string => it.name)).toEqual(['a', 'b', 'c']);
    expect(listingItems_sort(items)).toBe(items);
  });

  it('reverses each comparison, so equal items keep their order', () => {
    expect(listingItems_sort(items, 'size', true).map((it: VFSItem): string => it.name)).toEqual(['b', 'a', 'c']);
  });

  it('puts an item missing the field last', () => {
    const titled: VFSItem[] = [item('x', 'file'), item('y', 'file', { title: 'Y' })];
    expect(listingItems_sort(titled, 'title').map((it: VFSItem): string => it.name)).toEqual(['y', 'x']);
  });
});

describe('size_format', () => {
  it('says bytes for people', () => {
    expect(size_format(0)).toBe('0 B');
    expect(size_format(1536)).toBe('1.5 KB');
    expect(size_format(5 * 1024 * 1024)).toBe('5 MB');
  });
});
