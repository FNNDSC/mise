/**
 * @file `/proc/tags`: the user's tags as folders, each listing the feeds that
 * wear it as links into /proc/jobs; mkdir makes a tag, rmdir deletes one,
 * mv renames one; nothing inside a tag folder is written here (setfattr
 * tags a feed). The dispatcher routes the three verbs and refuses them by
 * name where a projection makes no folders.
 */
const tagsIndex = jest.fn();
const tagCreate = jest.fn();
const tagDelete = jest.fn();
const tagRename = jest.fn();
jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  tags_index: (...a: unknown[]) => tagsIndex(...a),
  tag_create: (...a: unknown[]) => tagCreate(...a),
  tag_delete: (...a: unknown[]) => tagDelete(...a),
  tag_rename: (...a: unknown[]) => tagRename(...a),
}));

import { vfsRefusal_text } from '@fnndsc/fond';
import { errorStack, Ok } from '@fnndsc/cumin';
import { ProcTagsVfsProvider } from '../src/vfs/providers/procTags';
import { vfsDispatcher } from '../src/vfs/dispatcher';

const index = new Map([
  ['urgent', { id: 1, name: 'urgent', color: '#888888', feeds: [12, 13] }],
  ['spare', { id: 2, name: 'spare', color: '#888888', feeds: [] }],
]);

beforeEach(() => {
  jest.clearAllMocks();
  while (errorStack.stack_pop() !== undefined) { /* drain */ }
  tagsIndex.mockResolvedValue(Ok(index));
  tagCreate.mockResolvedValue(Ok(true));
  tagDelete.mockResolvedValue(Ok(true));
  tagRename.mockResolvedValue(Ok(true));
});

describe('ProcTagsVfsProvider', () => {
  const provider = new ProcTagsVfsProvider();

  it('lists every tag as a folder, an unworn one too', async () => {
    const result = await provider.list('/proc/tags');
    expect(result.ok && result.value.map((item) => [item.name, item.type, item.size])).toEqual([['urgent', 'dir', 2], ['spare', 'dir', 0]]);
  });

  it("lists a tag's feeds as links to /proc/jobs, and refuses an unknown tag or a deeper path", async () => {
    const result = await provider.list('/proc/tags/urgent/');
    expect(result.ok && result.value.map((item) => [item.name, item.type, item.target])).toEqual([
      ['feed_12', 'link', '/proc/jobs/feed_12'],
      ['feed_13', 'link', '/proc/jobs/feed_13'],
    ]);
    expect((await provider.list('/proc/tags/nope')).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain('/proc/tags/nope: No such file or directory');
    expect((await provider.list('/proc/tags/urgent/feed_12')).ok).toBe(false);
  });

  it('makes, deletes and renames a tag through the folders', async () => {
    expect((await provider.mkdir('/proc/tags/qc')).ok).toBe(true);
    expect(tagCreate).toHaveBeenCalledWith('qc');
    expect((await provider.rmdir('/proc/tags/spare')).ok).toBe(true);
    expect(tagDelete).toHaveBeenCalledWith('spare');
    expect((await provider.rename('/proc/tags/urgent', '/proc/tags/URGENT')).ok).toBe(true);
    expect(tagRename).toHaveBeenCalledWith('urgent', 'URGENT');
  });

  it('refuses a verb on the tags folder itself or on a feed inside a tag, by name', async () => {
    const rootRefused = await provider.rmdir('/proc/tags');
    expect(rootRefused.ok === false && rootRefused.reason).toContain('rmdir: /proc/tags: Operation not permitted (the tags folder itself)');
    const feedRefused = await provider.mkdir('/proc/tags/urgent/feed_14');
    expect(feedRefused.ok === false && feedRefused.reason).toContain('setfattr tags and untags a feed');
    expect((await provider.cp('/proc/tags/a', '/proc/tags/b', {})).ok).toBe(false);
    expect(tagCreate).not.toHaveBeenCalled();
  });
});

describe('removal under /proc/tags', () => {
  const provider = new ProcTagsVfsProvider();
  it('names the verb that does the job: setfattr untags a feed, rmdir deletes a tag', async () => {
    expect(await provider.rm('/proc/tags/urgent/feed_12')).toEqual({ ok: false, errno: 'EPERM', reason: 'Operation not permitted (setfattr -x tag -v urgent feed_12 untags the feed)' });
    expect(await provider.rmTree('/proc/tags/urgent')).toEqual({ ok: false, errno: 'EISDIR', reason: 'Is a directory (rmdir deletes a tag no feed wears)' });
    expect(await provider.rm('/proc/tags')).toEqual({ ok: false, errno: 'EISDIR', reason: 'Is a directory (rmdir deletes a tag no feed wears)' });
  });
});

describe('the dispatcher routes mkdir, rmdir and mv', () => {
  it('to /proc/tags, and refuses them by name in a projection that makes no folders', async () => {
    expect((await vfsDispatcher.mkdir('/proc/tags/qc')).ok).toBe(true);
    expect(tagCreate).toHaveBeenCalledWith('qc');
    expect((await vfsDispatcher.rmdir('/proc/tags/spare')).ok).toBe(true);
    expect((await vfsDispatcher.rename('/proc/tags/a', '/proc/tags/b')).ok).toBe(true);
    const made = await vfsDispatcher.mkdir('/proc/jobs/feed_12/x');
    expect(made.ok).toBe(false);
    if (!made.ok) expect(vfsRefusal_text('mkdir', made, '/proc/jobs/feed_12/x')).toBe("mkdir: cannot create directory '/proc/jobs/feed_12/x': Read-only file system");
    const moved = await vfsDispatcher.rename('/proc/tags/a', '/proc/jobs/b');
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(vfsRefusal_text('rename', moved, '/proc/tags/a', '/proc/jobs/b')).toContain('Invalid cross-device link');
  });

  it('lists /proc as jobs and tags, and no longer answers /tags', () => {
    expect(vfsDispatcher.path_isVirtual('/proc/tags/urgent')).toBe(true);
    expect(vfsDispatcher.provider_get('/tags').prefix).toBe('');
  });
});
