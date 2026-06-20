/**
 * @file Unit tests for the pure path tab-completion helpers.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { partialPath_split, completions_build } from '../src/lib/completer/pathComplete.helpers.js';

function item(name: string, type: string) {
  return { name, type, size: 0, owner: 'u', date: '' } as any;
}

describe('partialPath_split', () => {
  it('treats a trailing slash as listing that dir with empty prefix', () => {
    expect(partialPath_split('/home/user/')).toEqual({ dirToList: '/home/user/', prefix: '' });
  });
  it('splits dir and basename prefix', () => {
    expect(partialPath_split('/home/user/fo')).toEqual({ dirToList: '/home/user', prefix: 'fo' });
  });
  it('maps a bare relative prefix to the current dir (empty dirToList)', () => {
    expect(partialPath_split('fo')).toEqual({ dirToList: '', prefix: 'fo' });
  });
});

describe('completions_build', () => {
  const items = [item('PIPELINES', 'dir'), item('plan.txt', 'file'), item('proc', 'vfs'), item('other', 'file')];

  it('preserves the typed partial style and appends / to dir-like hits', () => {
    expect(completions_build(items, 'p', '~/p')).toEqual(['~/plan.txt', '~/proc/']);
  });
  it('completes from an empty prefix', () => {
    expect(completions_build([item('home', 'dir')], '', '~/')).toEqual(['~/home/']);
  });
  it('appends / for dir, vfs, and link types only', () => {
    const mixed = [item('d', 'dir'), item('v', 'vfs'), item('l', 'link'), item('f', 'file')];
    expect(completions_build(mixed, '', '')).toEqual(['d/', 'v/', 'l/', 'f']);
  });
});
