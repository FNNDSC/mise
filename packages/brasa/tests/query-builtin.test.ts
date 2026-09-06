import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

const mockPush = jest.fn();
const mockPop = jest.fn();
const mockGetAll = jest.fn(() => [] as unknown[]);
const mockCurrentGet = jest.fn(async () => null as string | null);
const mockUserGet = jest.fn(async () => null as string | null);
const mockQueryGet = jest.fn();
const mockDecode = jest.fn();
const mockCreate = jest.fn();
const mockServersList = jest.fn();
const mockIndexFind = jest.fn(() => null as unknown);
const mockIndexNote = jest.fn();
const mockIndexDrop = jest.fn();
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  seriesStorage_resolve: jest.fn(async () => ({ ok: false })),
  tag_extractValue: (v) => (v && typeof v === 'object' && 'value' in v ? String(v.value ?? '') : String(v ?? '')),
  studies_extractFromDecoded: jest.fn(() => []),
  series_extractFromStudy: jest.fn(() => []),
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
  errorStack: { stack_push: mockPush, stack_pop: mockPop, stack_getAll: mockGetAll },
  chrisContext: { current_get: mockCurrentGet, ChRISuser_get: mockUserGet },
  Context: { PACSserver: 'PACSserver', ChRISuser: 'ChRISuser' },
  pacsQuery_get: mockQueryGet,
  pacsQuery_resultDecode: mockDecode,
  pacsQueries_create: mockCreate,
  listCache_get: () => ({ cache_invalidate: jest.fn(), cache_invalidateTree: jest.fn() }),
  queryIndex_get: () => ({ entry_note: mockIndexNote, entry_find: mockIndexFind, entry_drop: mockIndexDrop }),
  pacsServers_list: mockServersList,
}));

const mockTable = jest.fn(() => 'TABLE_OUT');
jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({ screen: { table_output: mockTable } }));
jest.unstable_mockModule('../src/lib/spinner.js', () => ({
  spinner: { start: jest.fn(), stop: jest.fn(), updateMessage: jest.fn() },
}));

const ok = <T>(value: T) => ({ ok: true as const, value });
const err = () => ({ ok: false as const });

const { pacsQuery_createAndWait, builtin_query } = await import('../src/builtins/net/query.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  mockCurrentGet.mockResolvedValue(null);
  mockIndexFind.mockReturnValue(null);
  mockUserGet.mockResolvedValue(null);
  mockServersList.mockResolvedValue(ok([{ id: 1, identifier: 'PACSDCM' }]));
  mockGetAll.mockReturnValue([]);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
});

const studyPayload = [{
  StudyDescription: 'Brain Study',
  PatientName: { value: 'DOE^JANE' },
  PatientID: '1234',
  StudyDate: '20240101',
  ModalitiesInStudy: 'MR',
  AccessionNumber: 'A100',
  series: [
    { SeriesDescription: 'T1 MPRAGE', Modality: 'MR', NumberOfSeriesRelatedInstances: { value: '176' } },
  ],
}];

describe('pacsQuery_createAndWait', () => {
  it('rejects an invalid query expression', async () => {
    expect(await pacsQuery_createAndWait('nocolon', 'T', 'PACSDCM')).toBeNull();
    expect(mockPush).toHaveBeenCalledWith('error', expect.stringContaining('Invalid expression'));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns null when the query create fails', async () => {
    mockCreate.mockResolvedValue(err());
    expect(await pacsQuery_createAndWait('PatientID:X', 'T', 'PACSDCM')).toBeNull();
  });

  it('resolves with the query id, VFS path and decoded payload', async () => {
    mockCreate.mockResolvedValue(ok({ id: 9, owner_username: 'chris' }));
    mockQueryGet.mockResolvedValue(ok({ status: 'working' }));
    mockDecode.mockResolvedValue(ok({ json: {} }));
    const onStatus = jest.fn();
    const result = await pacsQuery_createAndWait('PatientID:X', 'T', 'PACSDCM', onStatus);
    expect(result).toEqual({
      queryId: 9,
      vfsPath: '/net/pacs/queries/PatientID:X_qid:9_chris',
      decoded: { json: {} },
    });
    expect(mockCreate).toHaveBeenCalledWith('PACSDCM', { title: 'T', query: JSON.stringify({ PatientID: 'X' }) });
    expect(onStatus).toHaveBeenCalledWith('Query 9 — working');
  });

  it('reports a pending status while the query record is unreadable', async () => {
    mockCreate.mockResolvedValue(ok({ id: 3 }));
    mockQueryGet.mockResolvedValue(err());
    mockDecode.mockResolvedValue(ok({ json: [] }));
    const onStatus = jest.fn();
    await pacsQuery_createAndWait('PatientID:X', 'T', 'PACSDCM', onStatus);
    expect(onStatus).toHaveBeenCalledWith('Query 3 — pending');
  });

  it('times out when the result never populates', async () => {
    jest.useFakeTimers();
    mockCreate.mockResolvedValue(ok({ id: 5 }));
    mockQueryGet.mockResolvedValue(ok({ status: 'working' }));
    mockDecode.mockResolvedValue(ok({}));
    const pending = pacsQuery_createAndWait('PatientID:X', 'T', 'PACSDCM');
    await jest.advanceTimersByTimeAsync(61_000);
    expect(await pending).toBeNull();
    expect(mockPush).toHaveBeenCalledWith('error', expect.stringContaining('Timed out waiting for query 5'));
  });

  it('pops the transient decode error pushed by each poll probe', async () => {
    jest.useFakeTimers();
    mockCreate.mockResolvedValue(ok({ id: 5 }));
    mockQueryGet.mockResolvedValue(ok({ status: 'working' }));
    mockDecode
      .mockResolvedValueOnce(err())
      .mockResolvedValueOnce(err())
      .mockResolvedValue(ok({ json: [] }));
    const pending = pacsQuery_createAndWait('PatientID:X', 'T', 'PACSDCM');
    await jest.advanceTimersByTimeAsync(5_000);
    expect(await pending).not.toBeNull();
    expect(mockPop).toHaveBeenCalledTimes(2);
  });

  it('completes with an empty result when the query succeeds with no matches', async () => {
    jest.useFakeTimers();
    mockCreate.mockResolvedValue(ok({ id: 6 }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    mockDecode.mockResolvedValue(err());
    const pending = pacsQuery_createAndWait('PatientID:ghost', 'T', 'PACSDCM');
    await jest.advanceTimersByTimeAsync(5_000);
    const result = await pending;
    expect(result).not.toBeNull();
    expect(result?.decoded.json).toBeUndefined();
    expect(mockPush).not.toHaveBeenCalledWith('error', expect.stringContaining('Timed out'));
  });
});

describe('builtin_query', () => {
  it('shows help for --help', async () => {
    const envelope = await builtin_query(['--help']);
    expect(envelope.rendered).toContain('USAGE');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('requires a query expression', async () => {
    const envelope = await builtin_query([]);
    expect(envelope.renderedErr).toContain('Missing query expression');
    expect(process.exitCode).toBe(1);
  });

  it('rejects an invalid expression before creating anything', async () => {
    const envelope = await builtin_query(['nocolon']);
    expect(envelope.renderedErr).toContain('Invalid expression');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('errors when no PACS server can be resolved', async () => {
    mockServersList.mockResolvedValue(ok([]));
    const envelope = await builtin_query(['PatientID:X']);
    expect(envelope.renderedErr).toContain('No PACS server available');
    expect(process.exitCode).toBe(1);
  });

  it('defaults to the first registered server when no context is set', async () => {
    mockServersList.mockResolvedValue(ok([{ id: 4, identifier: 'PACSDCM' }]));
    mockCreate.mockResolvedValue(ok({ id: 9 }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    mockDecode.mockResolvedValue(ok({ json: studyPayload }));
    await builtin_query(['PatientID:X']);
    expect(mockCreate).toHaveBeenCalledWith('4', expect.anything());
  });

  it('renders the study/series summary and prints the VFS path', async () => {
    mockCurrentGet.mockResolvedValue('PACSDCM');
    mockCreate.mockResolvedValue(ok({ id: 9, owner_username: 'chris' }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    mockDecode.mockResolvedValue(ok({ json: studyPayload }));
    const { rendered: output } = await builtin_query(['PatientID:X']);
    expect(output).toContain('Query 9 complete');
    expect(output).toContain('Brain Study');
    expect(output).toContain('T1 MPRAGE');
    expect(output).toContain('/net/pacs/queries/PatientID:X_qid:9_chris');
  });

  it('renders a table with --table', async () => {
    mockCurrentGet.mockResolvedValue('PACSDCM');
    mockCreate.mockResolvedValue(ok({ id: 9 }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    mockDecode.mockResolvedValue(ok({ json: studyPayload }));
    const envelope = await builtin_query(['PatientID:X', '--table', '--title', 'My Query']);
    expect(mockTable).toHaveBeenCalledWith(
      [expect.objectContaining({ Description: 'T1 MPRAGE', Modality: 'MR', Files: '176' })],
      expect.anything(),
    );
    expect(envelope.rendered).toContain('TABLE_OUT');
    expect(mockCreate).toHaveBeenCalledWith('PACSDCM', expect.objectContaining({ title: 'My Query' }));
  });

  it('honours a --pacsserver override', async () => {
    mockCreate.mockResolvedValue(ok({ id: 9 }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    mockDecode.mockResolvedValue(ok({ json: studyPayload }));
    await builtin_query(['PatientID:X', '--pacsserver', '5']);
    expect(mockCreate).toHaveBeenCalledWith('5', expect.anything());
    // The override settles the server, so the context is never asked for
    // one. It IS asked who is asking, which the replay lookup is keyed on.
    expect(mockCurrentGet).not.toHaveBeenCalledWith('PACSserver');
  });

  it('warns without browse hints when the query completes with no studies', async () => {
    mockCurrentGet.mockResolvedValue('PACSDCM');
    mockCreate.mockResolvedValue(ok({ id: 9 }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    mockDecode.mockResolvedValue(ok({ json: null }));
    const { rendered: output } = await builtin_query(['PatientID:X']);
    expect(output).toContain('no studies found');
    expect(output).not.toContain('VFS path');
    expect(output).not.toContain('pull /net/pacs');
  });

  it('reports a generic failure when the error stack is empty', async () => {
    mockCurrentGet.mockResolvedValue('PACSDCM');
    mockCreate.mockResolvedValue(err());
    const envelope = await builtin_query(['PatientID:X']);
    expect(envelope.renderedErr).toContain('query: Failed');
    expect(process.exitCode).toBe(1);
  });

  it('prints the stacked errors on failure', async () => {
    mockCurrentGet.mockResolvedValue('PACSDCM');
    mockCreate.mockResolvedValue(err());
    mockGetAll.mockReturnValue([{ message: 'PACS server refused the query' }]);
    const envelope = await builtin_query(['PatientID:X']);
    expect(envelope.renderedErr).toContain('PACS server refused the query');
    expect(process.exitCode).toBe(1);
  });
});

describe('replay', () => {
  /** An index entry for a question already answered. */
  const held = (overrides: Record<string, unknown> = {}) => ({
    queryId: 2661,
    server: 'PACSDCM',
    criteria: { PatientID: 'X' },
    owner: 'someone',
    answeredAt: new Date(Date.now() - 3 * 86400 * 1000).toISOString(),
    hasResult: true,
    ...overrides,
  });

  beforeEach(() => {
    mockCurrentGet.mockResolvedValue('PACSDCM');
    // The asking identity comes from the authenticated login, not from a
    // per-session context snapshot a surface may not have.
    mockUserGet.mockResolvedValue('someone');
    mockServersList.mockResolvedValue(ok([{ id: 1, identifier: 'PACSDCM' }]));
  });

  it('serves a stored answer without troubling the PACS, and says how old it is', async () => {
    mockIndexFind.mockReturnValue(held());
    mockDecode.mockResolvedValue(ok({ json: [{ uid: 's1' }] }));
    const { rendered: output } = await builtin_query(['PatientID:X']);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(output).toContain('answered');
    expect(output).toContain('days ago');
    expect(output).toContain('--fresh');
  });

  it('puts provenance on the model so every surface says the same thing', async () => {
    // One entry, held: the helper stamps a fresh `now` on every call.
    const entry = held();
    mockIndexFind.mockReturnValue(entry);
    mockDecode.mockResolvedValue(ok({ json: [{ uid: 's1' }] }));
    const envelope = await builtin_query(['PatientID:X']);
    const model = (envelope as { model?: { data?: { provenance?: { replayed?: boolean; answeredAt?: string } } } }).model;
    expect(model?.data?.provenance?.replayed).toBe(true);
    expect(model?.data?.provenance?.answeredAt).toBe(entry.answeredAt);
  });

  it('marks a freshly queried answer as not replayed', async () => {
    mockIndexFind.mockReturnValue(null);
    mockCreate.mockResolvedValue(ok({ id: 9, owner_username: 'someone' }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    mockDecode.mockResolvedValue(ok({ json: [{ uid: 'fresh' }] }));
    const envelope = await builtin_query(['PatientID:X']);
    const model = (envelope as { model?: { data?: { provenance?: { replayed?: boolean } } } }).model;
    expect(model?.data?.provenance?.replayed).toBe(false);
  });

  it('never replays a query that found nothing: an absence decays', async () => {
    mockIndexFind.mockReturnValue(held({ hasResult: false }));
    mockCreate.mockResolvedValue(ok({ id: 9, owner_username: 'someone' }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    mockDecode.mockResolvedValue(ok({ json: [{ uid: 'fresh' }] }));
    await builtin_query(['PatientID:X']);
    expect(mockCreate).toHaveBeenCalled();
  });

  it('--fresh asks the PACS even when a stored answer exists', async () => {
    mockIndexFind.mockReturnValue(held());
    mockCreate.mockResolvedValue(ok({ id: 9, owner_username: 'someone' }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    mockDecode.mockResolvedValue(ok({ json: [{ uid: 'fresh' }] }));
    const { rendered: output } = await builtin_query(['PatientID:X', '--fresh']);
    expect(mockCreate).toHaveBeenCalled();
    expect(output).not.toContain('answered');
  });

  it('falls through and forgets the entry when the stored answer is gone', async () => {
    mockIndexFind.mockReturnValue(held());
    // The index promised a payload CUBE no longer has.
    mockDecode
      .mockResolvedValueOnce(err())
      .mockResolvedValue(ok({ json: [{ uid: 'fresh' }] }));
    mockCreate.mockResolvedValue(ok({ id: 9, owner_username: 'someone' }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    await builtin_query(['PatientID:X']);
    expect(mockIndexDrop).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
  });

  it('keys the lookup on the authenticated login, not a session context snapshot', async () => {
    // A surface attached to a running calypso has no ChRISuser context;
    // keying on it made every stored answer unreachable from argus while
    // chell found them all.
    mockCurrentGet.mockResolvedValue(null);
    mockUserGet.mockResolvedValue('someone');
    mockIndexFind.mockReturnValue(held());
    mockDecode.mockResolvedValue(ok({ json: [{ uid: 's1' }] }));
    await builtin_query(['PatientID:X']);
    expect(mockIndexFind).toHaveBeenCalledWith({ PatientID: 'X' }, 'PACSDCM', 'someone');
  });

  it('files a fresh query under the asking identity when CUBE names no owner', async () => {
    mockIndexFind.mockReturnValue(null);
    mockCreate.mockResolvedValue(ok({ id: 9 }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    mockDecode.mockResolvedValue(ok({ json: [{ uid: 'fresh' }] }));
    await builtin_query(['PatientID:X']);
    expect(mockIndexNote).toHaveBeenCalledWith(expect.objectContaining({
      queryId: 9,
      owner: 'someone',
      server: 'PACSDCM',
    }));
  });

  it('asks the PACS when the question is new to the index', async () => {
    mockIndexFind.mockReturnValue(null);
    mockCreate.mockResolvedValue(ok({ id: 9, owner_username: 'someone' }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    mockDecode.mockResolvedValue(ok({ json: [{ uid: 'fresh' }] }));
    await builtin_query(['PatientID:X']);
    expect(mockCreate).toHaveBeenCalled();
  });
});
