/**
 * View-layer tests for fs, ls and file renderers (pure formatting).
 */
jest.mock('../src/config/colorConfig', () => ({
  fileSystemItem_colorize: (name: string) => name,
}));
jest.mock('../src/screen/screen', () => ({
  screen: { table_output: jest.fn(() => 'TABLE_OUTPUT') },
}));

import {
  mkdir_render, touch_render, upload_render, cat_render, cp_render, mv_render, rm_render,
} from '../src/views/fs';
import { size_format, items_sort, grid_render, long_render, json_render } from '../src/views/ls';
import { fileList_render } from '../src/views/file';
import type { ListingItem } from '../src/models/listing';

function item(over: Partial<ListingItem> = {}): ListingItem {
  return { name: 'f', type: 'file', size: 0, owner: 'chris', date: '2026-01-01T12:00:00Z', ...over } as ListingItem;
}

describe('fs views', () => {
  it('render success and failure', () => {
    expect(mkdir_render('/d', true)).toContain('Created directory');
    expect(mkdir_render('/d', false)).toContain('Failed to create directory');
    expect(touch_render('/f', true)).toContain('Created file');
    expect(touch_render('/f', false)).toContain('Failed to create file');
    expect(upload_render('/l', '/r', true)).toContain('Successfully uploaded');
    expect(upload_render('/l', '/r', false)).toContain('Failed to upload');
    expect(cat_render('body', '/f')).toBe('body');
    expect(cat_render(null, '/f')).toContain('File not found');
    expect(cp_render('/a', '/b', true)).toContain('Copied');
    expect(cp_render('/a', '/b', false)).toContain('Failed to copy');
    expect(mv_render('/a', '/b', true)).toContain('Moved');
    expect(mv_render('/a', '/b', false)).toContain('Failed to move');
    expect(rm_render({ success: true, path: '/f', type: 'file' })).toContain('Removed file');
    expect(rm_render({ success: false, path: '/f', type: null, error: 'nope' })).toContain('nope');
    expect(rm_render({ success: false, path: '/f', type: null })).toContain('Failed to remove');
  });
});

describe('ls size_format', () => {
  it.each([
    [0, '0 B'],
    [1024, '1 KB'],
    [1024 * 1024, '1 MB'],
    [1536, '1.5 KB'],
  ])('%i bytes -> %s', (bytes, expected) => {
    expect(size_format(bytes)).toBe(expected);
  });
});

describe('ls items_sort', () => {
  const items = [item({ name: 'b', size: 2, owner: 'z', date: '2026-02' }), item({ name: 'a', size: 1, owner: 'a', date: '2026-01' })];
  it('sorts by each field and reverses', () => {
    expect(items_sort(items, 'name').map((i) => i.name)).toEqual(['a', 'b']);
    expect(items_sort(items, 'size').map((i) => i.size)).toEqual([1, 2]);
    expect(items_sort(items, 'owner').map((i) => i.owner)).toEqual(['a', 'z']);
    expect(items_sort(items, 'date').map((i) => i.date)).toEqual(['2026-01', '2026-02']);
    expect(items_sort(items, 'name', true).map((i) => i.name)).toEqual(['b', 'a']);
  });
});

describe('ls grid_render', () => {
  it('returns empty for no items', () => {
    expect(grid_render([])).toBe('');
  });
  it('one item per line with oneColumn', () => {
    const out = grid_render([item({ name: 'a' }), item({ name: 'b' })], { oneColumn: true });
    expect(out.split('\n')).toEqual(['a', 'b']);
  });
  it('appends a version suffix', () => {
    const out = grid_render([item({ name: 'p', type: 'plugin', version: '1.0' })], { oneColumn: true });
    expect(out).toContain('(1.0)');
  });
  it('packs items into a multi-column grid', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((n) => item({ name: n }));
    const out = grid_render(items);
    expect(out).toContain('a');
    expect(out).toContain('e');
  });
  it('applies the deprecated sort option', () => {
    const out = grid_render([item({ name: 'b' }), item({ name: 'a' })], { oneColumn: true, sort: 'name' });
    expect(out.split('\n')).toEqual(['a', 'b']);
  });
});

describe('ls long_render', () => {
  it('renders type chars, sizes, dates, titles and link targets', () => {
    const out = long_render([
      item({ name: 'dir1', type: 'dir', size: 4096 }),
      item({ name: 'ln', type: 'link', target: '/target' }),
      item({ name: 'job1', type: 'job', status: 'finishedSuccessfully', title: 'My Feed' }),
    ], { human: true });
    const lines = out.split('\n');
    expect(lines[0].startsWith('d ')).toBe(true);
    expect(lines[1]).toContain('-> /target');
    expect(lines[2].startsWith('j ')).toBe(true);
    expect(lines[2]).toContain('finishedSuccessfully');
    expect(lines[2]).toContain('My Feed');
  });
  it('applies the deprecated sort option and non-human byte sizes', () => {
    const out = long_render([item({ name: 'b', size: 20 }), item({ name: 'a', size: 10 })], { sort: 'name' });
    expect(out.split('\n')[0]).toContain('a');
  });
  it('returns empty for no items', () => {
    expect(long_render([])).toBe('');
  });
});

describe('ls json_render', () => {
  it('pretty-prints the items', () => {
    const out = json_render([item({ name: 'x' })]);
    expect(JSON.parse(out)[0].name).toBe('x');
  });
});

describe('file view', () => {
  const files = [{ id: 1, fname: '/a.txt', fsize: 100, owner_username: 'chris', creation_date: '2026-01-01T00:00:00.000Z' }] as never[];
  it('empty / default / csv / table', () => {
    expect(fileList_render([], [])).toContain('No files found');
    expect(fileList_render(files, [])).toContain('/a.txt');
    expect(fileList_render(files, ['id', 'fname'], { csv: true }).split('\n')[0]).toBe('"ID","FNAME"');
    expect(fileList_render(files, ['id'], { table: true })).toBe('TABLE_OUTPUT');
  });
});
