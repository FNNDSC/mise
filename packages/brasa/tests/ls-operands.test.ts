/**
 * @file ls of several operands reads as a shell gives it: files first, then
 * each folder under its own header.
 *
 * @module
 */
import { jest, describe, it, expect } from '@jest/globals';
import { MemoryVfsProvider, VFSDispatcher } from '@fnndsc/fond';

jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: jest.fn(async () => ({ user: 'chris', URL: 'x', folder: '/home/chris' })),
}));
jest.unstable_mockModule('../src/session/index.js', () => ({ session: { getCWD: jest.fn(async () => '/home/chris') } }));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));
const dispatcher: VFSDispatcher = new VFSDispatcher(new MemoryVfsProvider('', {
  '/home/chris/a.txt': 'alpha', '/home/chris/docs/b.txt': 'beta', '/home/chris/data/c.txt': 'gamma',
}));
jest.unstable_mockModule('../src/core/filesystem.js', () => ({
  vfsDispatcher_get: () => dispatcher,
  listingCache_get: () => ({ cache_invalidate: jest.fn() }),
}));
// Each listing renders as the names it holds (a file renders as itself).
jest.unstable_mockModule('../src/lib/vfs/vfs.js', () => ({
  vfs: {
    list: async (target: string) => {
      const listed = await dispatcher.list(target);
      const names: string = listed.ok ? listed.value.map((item) => item.name).join(' ') : target.split('/').pop() ?? '';
      return target.endsWith('missing') ? { status: 'error', rendered: '', renderedErr: `Cannot list ${target}\n` } : { status: 'ok', rendered: `${names}\n` };
    },
    listing_get: async (target: string) => ({ ok: true, value: { path: target, items: [], fresh: true } }),
  },
}));

const { builtin_ls } = await import('../src/builtins/fs/ls.js');

describe('ls of several operands', () => {
  it('lists files first, then each folder under its name as typed, a blank line between', async () => {
    const envelope = await builtin_ls(['docs', 'a.txt', '/home/chris/data']);
    expect(envelope.rendered).toBe('a.txt\n\ndocs:\nb.txt\n\n/home/chris/data:\nc.txt\n');
  });

  it('gives one operand no header, and -d none either', async () => {
    expect((await builtin_ls(['docs'])).rendered).toBe('b.txt\n');
    expect((await builtin_ls(['-d', 'docs', 'data'])).rendered).not.toContain('docs:');
  });

  it('heads no folder that could not be listed', async () => {
    const envelope = await builtin_ls(['docs', 'missing']);
    expect(envelope.rendered).toBe('docs:\nb.txt\n');
    expect(envelope.status).toBe('error');
  });
});
