/**
 * @file Unit tests for the `share` builtin.
 *
 * The kernel is mocked, as it is for every other builtin here: the engine
 * graph cannot be loaded under jest.
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

const { builtin_share } = await import('../src/builtins/fs/share.js');

describe('builtin_share', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStackPop.mockReturnValue(undefined);
    mockFeedShare.mockResolvedValue({ ok: true, value: true });
    mockFeedSharesList.mockResolvedValue({ ok: true, value: [] });
  });

  it('grants an identity access to a feed', async () => {
    const envelope = await builtin_share(['feed_12', 'with', 'someone']);
    expect(mockFeedShare).toHaveBeenCalledWith(12, 'someone');
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toBe('feed 12 shared with someone');
  });

  it('resolves a feed from any path that names one, including a shared one', async () => {
    await builtin_share(['/SHARED/someone/feeds/feed_4299', 'me']);
    expect(mockFeedShare).toHaveBeenCalledWith(4299, 'me');
  });

  it('reads back who holds access when no identity is named', async () => {
    mockFeedSharesList.mockResolvedValue({ ok: true, value: ['ann', 'bo'] });
    const envelope = await builtin_share(['feed_12']);
    expect(mockFeedShare).not.toHaveBeenCalled();
    expect(envelope.rendered).toBe('feed 12 is shared with ann bo');
  });

  it('says so plainly when a feed is shared with nobody', async () => {
    const envelope = await builtin_share(['feed_12']);
    expect(envelope.rendered).toBe('feed 12 is shared with nobody');
  });

  it('refuses what names no feed', async () => {
    const envelope = await builtin_share(['/home/me/uploads', 'someone']);
    expect(envelope.status).toBe('error');
    expect(envelope.rendered).toContain('does not name a feed');
    expect(mockFeedShare).not.toHaveBeenCalled();
  });

  it('asks for a target rather than guessing', async () => {
    const envelope = await builtin_share([]);
    expect(envelope.status).toBe('error');
    expect(envelope.rendered).toContain('usage');
  });

  it('reports the kernel\'s own words when a grant is refused', async () => {
    mockFeedShare.mockResolvedValue({ ok: false });
    mockStackPop.mockReturnValue({ type: 'error', message: 'CUBE refused: not the owner' });
    const envelope = await builtin_share(['feed_12', 'someone']);
    expect(envelope.status).toBe('error');
    expect(envelope.rendered).toBe('CUBE refused: not the owner');
  });

  it('reports a failed read of the shares too', async () => {
    mockFeedSharesList.mockResolvedValue({ ok: false });
    mockStackPop.mockReturnValue({ type: 'error', message: 'feed 12 not found' });
    const envelope = await builtin_share(['feed_12']);
    expect(envelope.status).toBe('error');
    expect(envelope.rendered).toBe('feed 12 not found');
  });
});
