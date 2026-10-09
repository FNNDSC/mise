/**
 * @file Unit tests for the `setfattr` / `getfattr` builtins. The kernel is mocked.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { cuminMock_install } from './support/cuminMock.js';

type Tags = { ok: boolean; value?: Array<{ id: number; name: string; color: string }> };
const mockList = jest.fn<(feedId: number) => Promise<Tags>>();
const mockAdd = jest.fn<(feedId: number, name: string) => Promise<{ ok: boolean; value?: boolean }>>();
const mockRemove = jest.fn<(feedId: number, name: string) => Promise<{ ok: boolean; value?: boolean }>>();
const mockStackPop = jest.fn<() => { type: string; message: string } | undefined>();

cuminMock_install(() => ({
  feedTags_list: mockList,
  feedTag_add: mockAdd,
  feedTag_remove: mockRemove,
  errorStack: { stack_pop: mockStackPop, stack_search: () => [] },
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string) => ({ status: 'error', rendered }),
  CommandEnvelope: class {},
}));

jest.unstable_mockModule('../src/builtins/utils.js', () => ({
  error_stripDebugPrefix: (message: string): string => message.replace(/^\[[^\]]*\]\s*\|\s*/, ''),
}));

const { builtin_getfattr, builtin_setfattr } = await import('../src/builtins/fs/xattr.js');

const tag = (name: string) => ({ id: 1, name, color: '#888888' });

beforeEach(() => {
  jest.clearAllMocks();
  mockStackPop.mockReturnValue(undefined);
  mockList.mockResolvedValue({ ok: true, value: [] });
  mockAdd.mockResolvedValue({ ok: true, value: true });
  mockRemove.mockResolvedValue({ ok: true, value: true });
});

describe('getfattr', () => {
  it("dumps each feed's tags with a model", async () => {
    mockList.mockResolvedValueOnce({ ok: true, value: [tag('urgent'), tag('review')] }).mockResolvedValueOnce({ ok: true, value: [] });
    const envelope = await builtin_getfattr(['feed_12', '/proc/jobs/feed_13']);
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toBe('# file: feed_12\ntag="urgent"\ntag="review"\n\n# file: /proc/jobs/feed_13\n');
    expect(mockList.mock.calls.map((c) => c[0])).toEqual([12, 13]);
    expect((envelope as { model?: { kind: string } }).model?.kind).toBe('fs.xattr');
  });

  it('refuses a path that names no feed, a bad invocation, and says the kernel\'s words on failure', async () => {
    expect((await builtin_getfattr(['nowhere'])).rendered).toBe("getfattr: 'nowhere' does not name a feed\n");
    expect((await builtin_getfattr([])).rendered).toMatch(/usage/);
    mockList.mockResolvedValueOnce({ ok: false });
    mockStackPop.mockReturnValueOnce({ type: 'error', message: 'Not connected to ChRIS.' });
    expect((await builtin_getfattr(['feed_12'])).rendered).toBe('Not connected to ChRIS.\n');
  });
});

describe('setfattr', () => {
  it('hangs a tag on every feed named, silently', async () => {
    const envelope = await builtin_setfattr(['-n', 'tag', '-v', 'urgent', 'feed_12', '13']);
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toBe('');
    expect(mockAdd.mock.calls).toEqual([[12, 'urgent'], [13, 'urgent']]);
  });

  it('takes one tag off, and refuses a value the feed does not wear', async () => {
    expect((await builtin_setfattr(['-x', 'tag', '-v', 'urgent', 'feed_12'])).status).toBe('ok');
    expect(mockRemove).toHaveBeenCalledWith(12, 'urgent');
    mockRemove.mockResolvedValueOnce({ ok: true, value: false });
    expect((await builtin_setfattr(['-x', 'tag', '-v', 'absent', 'feed_12'])).rendered).toBe('setfattr: feed_12: tag="absent": No such attribute value\n');
  });

  it('takes every tag off with -x tag alone', async () => {
    mockList.mockResolvedValueOnce({ ok: true, value: [tag('a'), tag('b')] });
    expect((await builtin_setfattr(['-x', 'tag', 'feed_12'])).status).toBe('ok');
    expect(mockRemove.mock.calls).toEqual([[12, 'a'], [12, 'b']]);
  });

  it("refuses a bad target, a bad invocation, and passes the kernel's refusal on", async () => {
    expect((await builtin_setfattr(['-n', 'tag', '-v', 'x', 'nowhere'])).rendered).toBe("setfattr: 'nowhere' does not name a feed\n");
    expect((await builtin_setfattr(['-n', 'color', '-v', 'x', 'feed_12'])).rendered).toMatch(/Operation not supported/);
    mockAdd.mockResolvedValueOnce({ ok: false });
    expect((await builtin_setfattr(['-n', 'tag', '-v', 'x', 'feed_12'])).rendered).toBe('setfattr: feed_12: could not add tag x\n');
    // A tag that is not in the vocabulary: the kernel's words, the cure named.
    mockAdd.mockResolvedValueOnce({ ok: false });
    mockStackPop.mockReturnValueOnce({ type: 'error', message: '[feedTag_add      ] | x: No such tag (mkdir /proc/tags/x)' });
    expect((await builtin_setfattr(['-n', 'tag', '-v', 'x', 'feed_12'])).rendered).toBe('setfattr: feed_12: x: No such tag (mkdir /proc/tags/x)\n');
    mockList.mockResolvedValueOnce({ ok: false });
    expect((await builtin_setfattr(['-x', 'tag', 'feed_12'])).rendered).toBe('setfattr: could not read the tags of feed 12\n');
  });
});
