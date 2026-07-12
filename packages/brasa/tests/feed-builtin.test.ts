import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// builtins/utils deps (for real commandArgs_process).
jest.unstable_mockModule('@fnndsc/salsa', () => ({ context_getSingle: jest.fn() }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({}));
jest.unstable_mockModule('../src/session/index.js', () => ({ session: {} }));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));
jest.unstable_mockModule('@fnndsc/chili/models/feed.js', () => ({}));

// chell entry (chiliCommand_run) — mocked so the whole shell isn't loaded.
const mockChiliRun = jest.fn();
jest.unstable_mockModule('../src/core/chiliDelegate.js', () => ({ chiliCommand_run: mockChiliRun }));

const mockFeedsList = jest.fn();
const mockFeedFields = jest.fn();
const mockFeedCreate = jest.fn();
const mockCommentsList = jest.fn();
const mockNoteGet = jest.fn();
const mockNoteUpdate = jest.fn();
const mockCommentCreate = jest.fn();
const mockCommentDelete = jest.fn();
const mockCommentUpdate = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/feeds/list.js', () => ({ feeds_fetchList: mockFeedsList }));
jest.unstable_mockModule('@fnndsc/chili/commands/feeds/fields.js', () => ({ feedFields_fetch: mockFeedFields }));
jest.unstable_mockModule('@fnndsc/chili/commands/feed/create.js', () => ({ feed_create: mockFeedCreate }));
jest.unstable_mockModule('@fnndsc/chili/commands/feed/note.js', () => ({
  feed_noteGet: mockNoteGet,
  feed_noteUpdate: mockNoteUpdate,
}));
jest.unstable_mockModule('@fnndsc/chili/commands/feed/comments.js', () => ({
  feed_commentsList: mockCommentsList,
  feed_commentCreate: mockCommentCreate,
  feed_commentDelete: mockCommentDelete,
  feed_commentUpdate: mockCommentUpdate,
}));
jest.unstable_mockModule('@fnndsc/chili/views/feed.js', () => ({
  feedList_render: jest.fn(() => 'FEED_LIST'),
  feedCreate_render: jest.fn(() => 'FEED_CREATED'),
  feedNote_render: jest.fn(() => 'FEED_NOTE'),
  feedComments_render: jest.fn(() => 'FEED_COMMENTS'),
}));
const mockTableDisplay = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({ table_display: mockTableDisplay }));
jest.unstable_mockModule('../src/builtins/res/feed.notes.js', () => ({
  noteEditBody_format: jest.fn(() => 'ORIGINAL BODY'),
  noteEditBody_parse: jest.fn(() => ({ title: 'Parsed', content: 'Body' })),
}));
const mockSpawnSync = jest.fn(() => ({}));
jest.unstable_mockModule('child_process', () => ({ spawnSync: mockSpawnSync }));

const { writeFileSync } = await import('fs');
const { builtin_feed } = await import('../src/builtins/res/feed.js');

const ok = <T>(value: T) => ({ ok: true as const, value });
const err = () => ({ ok: false as const });

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  mockSpawnSync.mockReset().mockReturnValue({});
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

  it('hints at pagination when the listing is truncated', async () => {
    mockFeedsList.mockResolvedValue({ feeds: [{ id: 1 }], selectedFields: ['id'], totalCount: 5 });
    await builtin_feed(['list']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('showing 1 of 5'));
  });

  it('routes search to a filtered list', async () => {
    mockFeedsList.mockResolvedValue({ feeds: [], selectedFields: [], totalCount: 0 });
    await builtin_feed(['search', 'brain']);
    expect(mockFeedsList).toHaveBeenCalledWith(expect.objectContaining({ search: 'brain' }));
  });

  it('reports empty inspect results', async () => {
    mockFeedFields.mockResolvedValue(null);
    await builtin_feed(['inspect']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No fields found'));
  });

  it('shows a feed note', async () => {
    mockNoteGet.mockResolvedValue(ok({ title: 'T', content: 'C' }));
    await builtin_feed(['note', '5']);
    expect(logSpy).toHaveBeenCalledWith('FEED_NOTE');
  });

  it('updates a note from flags', async () => {
    mockNoteUpdate.mockResolvedValue(ok(true));
    await builtin_feed(['note', '5', '--title', 'New']);
    expect(mockNoteUpdate).toHaveBeenCalledWith(5, { title: 'New', content: undefined });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Note updated on feed 5'));
  });

  it('rejects malformed note commands and reports failures', async () => {
    await builtin_feed(['note', 'abc']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: feed note'));

    mockNoteGet.mockResolvedValue(err());
    await builtin_feed(['note', '5']);
    expect(process.exitCode).toBe(1);
  });

  it('edits a note through the editor and saves changes', async () => {
    mockNoteGet.mockResolvedValue(ok({ title: 'T', content: 'old' }));
    mockSpawnSync.mockImplementation((_editor: unknown, argv: unknown) => {
      writeFileSync((argv as string[])[0], 'EDITED BODY', 'utf8');
      return {};
    });
    mockNoteUpdate.mockResolvedValue(ok(true));
    await builtin_feed(['note', 'edit', '5']);
    expect(mockNoteUpdate).toHaveBeenCalledWith(5, { title: 'Parsed', content: 'Body' });
  });

  it('reports no changes when the editor leaves the note untouched', async () => {
    mockNoteGet.mockResolvedValue(ok({ title: 'T', content: 'old' }));
    // default spawnSync leaves the temp file as formatted
    await builtin_feed(['note', 'edit', '5']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('(no changes)'));
    expect(mockNoteUpdate).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric note edit id and reports a failed fetch', async () => {
    await builtin_feed(['note', 'edit', 'abc']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: feed note edit'));

    mockNoteGet.mockResolvedValue(err());
    await builtin_feed(['note', 'edit', '5']);
    expect(process.exitCode).toBe(1);
  });

  it('adds, edits and deletes comments', async () => {
    mockCommentCreate.mockResolvedValue(ok({ id: 3 }));
    await builtin_feed(['comment', 'add', '5', '--content', 'hi']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Comment added (id: 3)'));

    mockCommentUpdate.mockResolvedValue(ok(true));
    await builtin_feed(['comment', 'edit', '5', '3', '--content', 'edit']);
    expect(mockCommentUpdate).toHaveBeenCalledWith(5, 3, { title: undefined, content: 'edit' });

    mockCommentDelete.mockResolvedValue(ok(true));
    await builtin_feed(['comment', 'delete', '5', '3']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Comment 3 deleted'));
  });

  it('rejects malformed and unknown comment operations', async () => {
    await builtin_feed(['comment', 'add', 'abc']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: feed comment'));

    await builtin_feed(['comment', 'delete', '5', 'abc']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: feed comment delete'));

    await builtin_feed(['comment', 'edit', '5', 'abc']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: feed comment edit'));

    await builtin_feed(['comment', 'frob', '5']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown comment op'));
    expect(process.exitCode).toBe(1);
  });

  it('reports failed comment mutations', async () => {
    mockCommentCreate.mockResolvedValue(err());
    await builtin_feed(['comment', 'add', '5']);
    expect(process.exitCode).toBe(1);

    mockCommentsList.mockResolvedValue(err());
    await builtin_feed(['comments', '5']);
    expect(process.exitCode).toBe(1);
  });
});
