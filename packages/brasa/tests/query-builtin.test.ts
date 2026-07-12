import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

const mockPush = jest.fn();
const mockPop = jest.fn();
const mockGetAll = jest.fn(() => [] as unknown[]);
const mockCurrentGet = jest.fn(async () => null as string | null);
const mockQueryGet = jest.fn();
const mockDecode = jest.fn();
const mockCreate = jest.fn();
const mockServersList = jest.fn();
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  errorStack: { stack_push: mockPush, stack_pop: mockPop, stack_getAll: mockGetAll },
  chrisContext: { current_get: mockCurrentGet },
  Context: { PACSserver: 'PACSserver' },
  pacsQuery_get: mockQueryGet,
  pacsQuery_resultDecode: mockDecode,
  pacsQueries_create: mockCreate,
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
    await builtin_query(['--help']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('USAGE'));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('requires a query expression', async () => {
    await builtin_query([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Missing query expression'));
    expect(process.exitCode).toBe(1);
  });

  it('rejects an invalid expression before creating anything', async () => {
    await builtin_query(['nocolon']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid expression'));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('errors when no PACS server can be resolved', async () => {
    mockServersList.mockResolvedValue(ok([]));
    await builtin_query(['PatientID:X']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('No PACS server available'));
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
    await builtin_query(['PatientID:X']);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
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
    await builtin_query(['PatientID:X', '--table', '--title', 'My Query']);
    expect(mockTable).toHaveBeenCalledWith(
      [expect.objectContaining({ Description: 'T1 MPRAGE', Modality: 'MR', Files: '176' })],
      expect.anything(),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('TABLE_OUT'));
    expect(mockCreate).toHaveBeenCalledWith('PACSDCM', expect.objectContaining({ title: 'My Query' }));
  });

  it('honours a --pacsserver override', async () => {
    mockCreate.mockResolvedValue(ok({ id: 9 }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    mockDecode.mockResolvedValue(ok({ json: studyPayload }));
    await builtin_query(['PatientID:X', '--pacsserver', '5']);
    expect(mockCreate).toHaveBeenCalledWith('5', expect.anything());
    expect(mockCurrentGet).not.toHaveBeenCalled();
  });

  it('warns without browse hints when the query completes with no studies', async () => {
    mockCurrentGet.mockResolvedValue('PACSDCM');
    mockCreate.mockResolvedValue(ok({ id: 9 }));
    mockQueryGet.mockResolvedValue(ok({ status: 'succeeded' }));
    mockDecode.mockResolvedValue(ok({ json: null }));
    await builtin_query(['PatientID:X']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('no studies found'));
    const output: string = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).not.toContain('VFS path');
    expect(output).not.toContain('pull /net/pacs');
  });

  it('reports a generic failure when the error stack is empty', async () => {
    mockCurrentGet.mockResolvedValue('PACSDCM');
    mockCreate.mockResolvedValue(err());
    await builtin_query(['PatientID:X']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('query: Failed'));
    expect(process.exitCode).toBe(1);
  });

  it('prints the stacked errors on failure', async () => {
    mockCurrentGet.mockResolvedValue('PACSDCM');
    mockCreate.mockResolvedValue(err());
    mockGetAll.mockReturnValue([{ message: 'PACS server refused the query' }]);
    await builtin_query(['PatientID:X']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('PACS server refused the query'));
    expect(process.exitCode).toBe(1);
  });
});
