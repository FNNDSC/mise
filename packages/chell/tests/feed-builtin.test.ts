import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// builtins/utils deps (for real commandArgs_process).
jest.unstable_mockModule('@fnndsc/salsa', () => ({ context_getSingle: jest.fn() }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({}));
jest.unstable_mockModule('../src/session/index.js', () => ({ session: {} }));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));
jest.unstable_mockModule('@fnndsc/chili/models/feed.js', () => ({}));

// chell entry (chiliCommand_run) — mocked so the whole shell isn't loaded.
const mockChiliRun = jest.fn();
jest.unstable_mockModule('../src/chell.js', () => ({ chiliCommand_run: mockChiliRun }));

const mockFeedsList = jest.fn();
const mockFeedFields = jest.fn();
const mockFeedCreate = jest.fn();
const mockCommentsList = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/feeds/list.js', () => ({ feeds_fetchList: mockFeedsList }));
jest.unstable_mockModule('@fnndsc/chili/commands/feeds/fields.js', () => ({ feedFields_fetch: mockFeedFields }));
jest.unstable_mockModule('@fnndsc/chili/commands/feed/create.js', () => ({ feed_create: mockFeedCreate }));
jest.unstable_mockModule('@fnndsc/chili/commands/feed/note.js', () => ({ feed_noteGet: jest.fn(), feed_noteUpdate: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/feed/comments.js', () => ({
  feed_commentsList: mockCommentsList,
  feed_commentCreate: jest.fn(),
  feed_commentDelete: jest.fn(),
  feed_commentUpdate: jest.fn(),
}));
jest.unstable_mockModule('@fnndsc/chili/views/feed.js', () => ({
  feedList_render: jest.fn(() => 'FEED_LIST'),
  feedCreate_render: jest.fn(() => 'FEED_CREATED'),
  feedNote_render: jest.fn(),
  feedComments_render: jest.fn(() => 'FEED_COMMENTS'),
}));
jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({ table_display: jest.fn() }));
jest.unstable_mockModule('../src/builtins/res/feed.notes.js', () => ({
  noteEditBody_format: jest.fn(),
  noteEditBody_parse: jest.fn(),
}));

const { builtin_feed } = await import('../src/builtins/res/feed.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('builtin_feed', () => {
  it('prints usage with no subcommand', async () => {
    await builtin_feed([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: feed'));
  });

  it('lists feeds', async () => {
    mockFeedsList.mockResolvedValue({ feeds: [{ id: 1 }], selectedFields: ['id'], totalCount: 1 });
    await builtin_feed(['list']);
    expect(logSpy).toHaveBeenCalledWith('FEED_LIST');
  });

  it('creates a feed and renders the result', async () => {
    mockFeedCreate.mockResolvedValue({ id: 5, name: 'f' });
    await builtin_feed(['create', '--dirs', '/a']);
    expect(logSpy).toHaveBeenCalledWith('FEED_CREATED');
  });

  it('inspects fields', async () => {
    mockFeedFields.mockResolvedValue(['id', 'name']);
    await builtin_feed(['inspect']);
    // table_display is called via feedInspect_handle; success == no throw
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('lists comments for a feed', async () => {
    mockCommentsList.mockResolvedValue({ ok: true, value: [{ id: 1 }] });
    await builtin_feed(['comments', '3']);
    expect(logSpy).toHaveBeenCalledWith('FEED_COMMENTS');
  });

  it('rejects a non-numeric comments feed id', async () => {
    await builtin_feed(['comments', 'abc']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: feed comments'));
  });

  it('delegates an unknown subcommand to chili', async () => {
    await builtin_feed(['frobnicate']);
    expect(mockChiliRun).toHaveBeenCalledWith('feeds', expect.arrayContaining(['-s']));
  });

  it('reports an error from a handler', async () => {
    mockFeedsList.mockRejectedValue(new Error('boom'));
    await builtin_feed(['list']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
