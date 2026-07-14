import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// builtins/utils deps (for real commandArgs_process).
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: jest.fn(),
  procCache_refresh: jest.fn(),
  feedJoins_ensure: jest.fn(),
  feedGraph_build: jest.fn(),
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),}));
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
const mockTableRender = jest.fn(() => 'FIELDS_TABLE');
jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({ table_display: mockTableDisplay, table_render: mockTableRender }));
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
  it('renders usage with no subcommand', async () => {
    const env = await builtin_feed([]);
    expect(env.rendered).toContain('Usage: feed');
  });

  it('lists feeds', async () => {
    mockFeedsList.mockResolvedValue({ feeds: [{ id: 1 }], selectedFields: ['id'], totalCount: 1 });
    const env = await builtin_feed(['list']);
    expect(env.rendered).toContain('FEED_LIST');
  });

  it('creates a feed and renders the result', async () => {
    mockFeedCreate.mockResolvedValue({ id: 5, name: 'f' });
    const env = await builtin_feed(['create', '--dirs', '/a']);
    expect(env.rendered).toContain('FEED_CREATED');
  });

  it('inspects fields', async () => {
    mockFeedFields.mockResolvedValue(['id', 'name']);
    const env = await builtin_feed(['inspect']);
    expect(env.rendered).toContain('FIELDS_TABLE');
    expect(env.renderedErr).toBeUndefined();
  });

  it('lists comments for a feed', async () => {
    mockCommentsList.mockResolvedValue({ ok: true, value: [{ id: 1 }] });
    const env = await builtin_feed(['comments', '3']);
    expect(env.rendered).toContain('FEED_COMMENTS');
  });

  it('rejects a non-numeric comments feed id', async () => {
    const env = await builtin_feed(['comments', 'abc']);
    expect(env.renderedErr).toContain('Usage: feed comments');
  });

  it('returns an error envelope for an unknown subcommand', async () => {
    const env = await builtin_feed(['frobnicate']);
    expect(mockChiliRun).not.toHaveBeenCalled();
    expect(env.renderedErr).toContain('Unknown subcommand');
  });

  it('reports an error from a handler', async () => {
    mockFeedsList.mockRejectedValue(new Error('boom'));
    const env = await builtin_feed(['list']);
    expect(env.renderedErr).toContain('boom');
  });

  it('hints at pagination when the listing is truncated', async () => {
    mockFeedsList.mockResolvedValue({ feeds: [{ id: 1 }], selectedFields: ['id'], totalCount: 5 });
    const env = await builtin_feed(['list']);
    expect(env.rendered).toContain('showing 1 of 5');
  });

  it('routes search to a filtered list', async () => {
    mockFeedsList.mockResolvedValue({ feeds: [], selectedFields: [], totalCount: 0 });
    await builtin_feed(['search', 'brain']);
    expect(mockFeedsList).toHaveBeenCalledWith(expect.objectContaining({ search: 'brain' }));
  });

  it('reports empty inspect results', async () => {
    mockFeedFields.mockResolvedValue(null);
    const env = await builtin_feed(['inspect']);
    expect(env.rendered).toContain('No fields found');
  });

  it('shows a feed note', async () => {
    mockNoteGet.mockResolvedValue(ok({ title: 'T', content: 'C' }));
    const env = await builtin_feed(['note', '5']);
    expect(env.rendered).toContain('FEED_NOTE');
  });

  it('updates a note from flags', async () => {
    mockNoteUpdate.mockResolvedValue(ok(true));
    const env = await builtin_feed(['note', '5', '--title', 'New']);
    expect(mockNoteUpdate).toHaveBeenCalledWith(5, { title: 'New', content: undefined });
    expect(env.rendered).toContain('Note updated on feed 5');
  });

  it('rejects malformed note commands and reports failures', async () => {
    const usage = await builtin_feed(['note', 'abc']);
    expect(usage.renderedErr).toContain('Usage: feed note');

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
    const env = await builtin_feed(['note', 'edit', '5']);
    expect(env.rendered).toContain('(no changes)');
    expect(mockNoteUpdate).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric note edit id and reports a failed fetch', async () => {
    const usage = await builtin_feed(['note', 'edit', 'abc']);
    expect(usage.renderedErr).toContain('Usage: feed note edit');

    mockNoteGet.mockResolvedValue(err());
    await builtin_feed(['note', 'edit', '5']);
    expect(process.exitCode).toBe(1);
  });

  it('adds, edits and deletes comments', async () => {
    mockCommentCreate.mockResolvedValue(ok({ id: 3 }));
    const added = await builtin_feed(['comment', 'add', '5', '--content', 'hi']);
    expect(added.rendered).toContain('Comment added (id: 3)');

    mockCommentUpdate.mockResolvedValue(ok(true));
    await builtin_feed(['comment', 'edit', '5', '3', '--content', 'edit']);
    expect(mockCommentUpdate).toHaveBeenCalledWith(5, 3, { title: undefined, content: 'edit' });

    mockCommentDelete.mockResolvedValue(ok(true));
    const deleted = await builtin_feed(['comment', 'delete', '5', '3']);
    expect(deleted.rendered).toContain('Comment 3 deleted');
  });

  it('rejects malformed and unknown comment operations', async () => {
    const add = await builtin_feed(['comment', 'add', 'abc']);
    expect(add.renderedErr).toContain('Usage: feed comment');

    const del = await builtin_feed(['comment', 'delete', '5', 'abc']);
    expect(del.renderedErr).toContain('Usage: feed comment delete');

    const edit = await builtin_feed(['comment', 'edit', '5', 'abc']);
    expect(edit.renderedErr).toContain('Usage: feed comment edit');

    const frob = await builtin_feed(['comment', 'frob', '5']);
    expect(frob.renderedErr).toContain('Unknown comment op');
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
