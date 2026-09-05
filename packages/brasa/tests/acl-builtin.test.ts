/**
 * @file Unit tests for the `setfacl` / `getfacl` builtins.
 *
 * The kernel is mocked, as it is for every other builtin here.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockFeedShare = jest.fn<(feedID: number, username: string) => Promise<{ ok: boolean; value?: boolean }>>();
const mockFeedSharesList = jest.fn<(feedID: number) => Promise<{ ok: boolean; value?: string[] }>>();
const mockStackPop = jest.fn<() => { type: string; message: string } | undefined>();

jest.unstable_mockModule('@fnndsc/cumin', () => ({
  feed_share: mockFeedShare,
  feedShares_list: mockFeedSharesList,
  errorStack: { stack_pop: mockStackPop },
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string) => ({ status: 'error', rendered }),
  CommandEnvelope: class {},
}));

const { builtin_setfacl, builtin_getfacl } = await import('../src/builtins/fs/acl.js');

describe('setfacl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStackPop.mockReturnValue(undefined);
    mockFeedShare.mockResolvedValue({ ok: true, value: true });
    mockFeedSharesList.mockResolvedValue({ ok: true, value: [] });
  });

  it('grants read on a feed named by path', async () => {
    const envelope = await builtin_setfacl(['-m', 'u:someone:r', '/home/me/feeds/feed_12']);
    expect(mockFeedShare).toHaveBeenCalledWith(12, 'someone');
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toBe('someone granted read on feed_12');
  });

  it('grants on several targets in one invocation', async () => {
    await builtin_setfacl(['-m', 'u:someone:r', 'feed_1', 'feed_2']);
    expect(mockFeedShare).toHaveBeenCalledTimes(2);
  });

  it('refuses an entry that grants no read, since that is what a share is', async () => {
    const envelope = await builtin_setfacl(['-m', 'u:someone:w', 'feed_1']);
    expect(envelope.status).toBe('error');
    expect(mockFeedShare).not.toHaveBeenCalled();
  });

  it('refuses -x by name rather than appearing to revoke', async () => {
    const envelope = await builtin_setfacl(['-x', 'u:someone', 'feed_1']);
    expect(envelope.status).toBe('error');
    expect(envelope.rendered).toContain('cannot revoke');
  });

  it('refuses a path that names no feed', async () => {
    const envelope = await builtin_setfacl(['-m', 'u:someone:r', '/home/me/uploads']);
    expect(envelope.status).toBe('error');
    expect(envelope.rendered).toContain('does not name a feed');
  });

  it('reports the kernel\'s own words when a grant is refused', async () => {
    mockFeedShare.mockResolvedValue({ ok: false });
    mockStackPop.mockReturnValue({ type: 'error', message: 'CUBE refused: not the owner' });
    const envelope = await builtin_setfacl(['-m', 'u:someone:r', 'feed_12']);
    expect(envelope.rendered).toBe('CUBE refused: not the owner');
  });
});

describe('getfacl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStackPop.mockReturnValue(undefined);
    mockFeedSharesList.mockResolvedValue({ ok: true, value: ['ann', 'bo'] });
  });

  it('renders the access list in getfacl\'s shape', async () => {
    const envelope = await builtin_getfacl(['/home/me/feeds/feed_12']);
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('# file: home/me/feeds/feed_12');
    expect(envelope.rendered).toContain('user:ann:r--');
    expect(envelope.rendered).toContain('user:bo:r--');
  });

  it('asks for a path rather than guessing', async () => {
    expect((await builtin_getfacl([])).status).toBe('error');
  });

  it('reports a failed read', async () => {
    mockFeedSharesList.mockResolvedValue({ ok: false });
    mockStackPop.mockReturnValue({ type: 'error', message: 'feed 12 not found' });
    expect((await builtin_getfacl(['feed_12'])).rendered).toBe('feed 12 not found');
  });
});
