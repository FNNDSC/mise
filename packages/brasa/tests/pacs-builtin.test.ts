import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockGet = jest.fn(async () => null as string | null);
const mockSet = jest.fn(async () => true);
const mockServersList = jest.fn();
const mockStackPop = jest.fn((): { message: string } | undefined => undefined);
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
  chrisContext: { PACSserver_get: mockGet, PACSserver_set: mockSet },
  pacsServers_list: mockServersList,
  errorStack: { stack_pop: mockStackPop },
}));

const mockQuery = jest.fn(async () => ({ status: 'ok', rendered: '' }));
const mockPull = jest.fn(async () => ({ status: 'ok', rendered: '' }));
const mockStatus = jest.fn(async () => ({ status: 'ok', rendered: '' }));
jest.unstable_mockModule('../src/builtins/net/query.js', () => ({ builtin_query: mockQuery }));
jest.unstable_mockModule('../src/builtins/fs/pull.js', () => ({ builtin_pull: mockPull }));
jest.unstable_mockModule('../src/builtins/utils.js', () => ({ error_stripDebugPrefix: (m: string) => m.replace(/^\[[^\]]+\]\s*\|\s*/, '') }));
jest.unstable_mockModule('../src/builtins/net/status.js', () => ({ builtin_pacsStatus: mockStatus }));

// pacs streams its output through the sink line writers.
const mockDataLine = jest.fn();
const mockErrLine = jest.fn();
jest.unstable_mockModule('../src/core/sink.js', () => ({
  sink_dataLine: mockDataLine,
  sink_errLine: mockErrLine,
  sink_get: jest.fn(() => ({ data_write: jest.fn(), err_write: jest.fn(), progress_write: jest.fn() })),
}));

const ok = <T>(value: T) => ({ ok: true as const, value });

const { builtin_pacs } = await import('../src/builtins/net/pacs.js');

beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  mockGet.mockResolvedValue(null);
  mockSet.mockResolvedValue(true);
});

describe('builtin_pacs', () => {
  it('returns help for --help', async () => {
    const env = await builtin_pacs(['--help']);
    expect(env.rendered).toContain('USAGE');
  });

  it('shows the active server with no subcommand', async () => {
    mockGet.mockResolvedValue('PACSDCM');
    await builtin_pacs([]);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('Active PACS server'));
  });

  it('notes when no server is set', async () => {
    mockGet.mockResolvedValue(null);
    await builtin_pacs([]);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('No PACS server set'));
  });

  it('lists servers, marking the active one, on bare connect', async () => {
    mockGet.mockResolvedValue('PACSDCM');
    mockServersList.mockResolvedValue(ok([{ id: 1, identifier: 'PACSDCM' }, { id: 2, identifier: 'ORTHANC' }]));
    await builtin_pacs(['connect']);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('active'));
  });

  it('notes when no servers are registered', async () => {
    mockServersList.mockResolvedValue(ok([]));
    await builtin_pacs(['connect']);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('No PACS servers registered'));
  });

  it('a listing CUBE refused is not an empty one: it says why, says pacs_users, and fails', async () => {
    mockServersList.mockResolvedValue({ ok: false });
    mockStackPop.mockReturnValueOnce({ message: '[pacsServers_list] | Failed to list PACS servers: You do not have permission to perform this action.' });
    const env = await builtin_pacs(['list']);
    expect(env.status).toBe('error');
    expect(process.exitCode).toBe(1);
    expect(mockDataLine).not.toHaveBeenCalledWith(expect.stringContaining('No PACS servers registered'));
    const said: string = mockErrLine.mock.calls.map((c) => String(c[0])).join('\n');
    expect(said).toContain('You do not have permission');
    expect(said).not.toContain('[pacsServers_list]');
    expect(said).toContain('pacs_users');
  });

  it('a listing that failed for another reason says why, without the pacs_users hint', async () => {
    mockServersList.mockResolvedValue({ ok: false });
    mockStackPop.mockReturnValueOnce({ message: 'Not connected to ChRIS. Please log in.' });
    const env = await builtin_pacs(['connect']);
    expect(env.status).toBe('error');
    const said: string = mockErrLine.mock.calls.map((c) => String(c[0])).join('\n');
    expect(said).toContain('Not connected');
    expect(said).not.toContain('pacs_users');
  });

  it('sets the active server', async () => {
    mockSet.mockResolvedValue(true);
    await builtin_pacs(['connect', 'ORTHANC']);
    expect(mockSet).toHaveBeenCalledWith('ORTHANC');
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining("set to 'ORTHANC'"));
  });

  it('reports a failure to set the server', async () => {
    mockSet.mockResolvedValue(false);
    await builtin_pacs(['connect', 'ghost']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('Failed to set'));
    expect(process.exitCode).toBe(1);
  });

  it('disconnects the active server', async () => {
    mockSet.mockResolvedValue(true);
    await builtin_pacs(['disconnect']);
    expect(mockSet).toHaveBeenCalledWith('');
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('cleared'));
  });

  it('reports a failure to disconnect', async () => {
    mockSet.mockResolvedValue(false);
    await builtin_pacs(['disconnect']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('Failed to clear'));
    expect(process.exitCode).toBe(1);
  });

  it('lists servers with the list alias', async () => {
    mockServersList.mockResolvedValue(ok([{ id: 1, identifier: 'PACSDCM' }]));
    await builtin_pacs(['list']);
    expect(mockServersList).toHaveBeenCalled();
  });

  it('routes query to builtin_query', async () => {
    await builtin_pacs(['query', 'PatientID:X']);
    expect(mockQuery).toHaveBeenCalledWith(['PatientID:X']);
  });

  it('routes pull to builtin_pull', async () => {
    await builtin_pacs(['pull', '/net/pacs/queries/x']);
    expect(mockPull).toHaveBeenCalledWith(['/net/pacs/queries/x']);
  });

  it('rejects an unknown subcommand', async () => {
    await builtin_pacs(['frobnicate']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining("Unknown subcommand 'frobnicate'"));
    expect(process.exitCode).toBe(1);
  });
});
