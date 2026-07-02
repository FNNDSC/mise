import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Real commandArgs helpers (path_resolve) run; stub the load-time boundary.
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: jest.fn(async () => ({ user: 'chris', folder: '/home/chris' })),
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({}));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));

const mockClientGet = jest.fn(async () => ({}) as unknown);
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { getCWD: jest.fn(async () => '/home/chris'), connection: { client_get: mockClientGet } },
}));

// pacsUtils does the CUBE/PACS work; stub it so we exercise cubepath's own logic.
const mockServerResolve = jest.fn();
const mockSeriesCollect = jest.fn();
const mockCubePathGet = jest.fn();
jest.unstable_mockModule('../src/builtins/net/pacsUtils.js', () => ({
  pacsServer_resolve: mockServerResolve,
  pacs_seriesCollect: mockSeriesCollect,
  series_cubePathGet: mockCubePathGet,
}));

const { builtin_cubepath } = await import('../src/builtins/net/cubepath.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  mockClientGet.mockResolvedValue({});
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('builtin_cubepath', () => {
  it('shows help for --help', async () => {
    await builtin_cubepath(['--help']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('USAGE'));
  });

  it('requires at least one path', async () => {
    await builtin_cubepath([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Missing path'));
    expect(process.exitCode).toBe(1);
  });

  it('errors when no PACS server can be resolved', async () => {
    mockServerResolve.mockResolvedValue(null);
    await builtin_cubepath(['/net/pacs/queries/x']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('No PACS server available'));
    expect(process.exitCode).toBe(1);
  });

  it('rejects a non-PACS VFS path', async () => {
    mockServerResolve.mockResolvedValue('PACSDCM');
    await builtin_cubepath(['/home/chris/data']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Not a PACS VFS path'));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('No series found'));
  });

  it('notes when no series are found under the path', async () => {
    mockServerResolve.mockResolvedValue('PACSDCM');
    mockSeriesCollect.mockResolvedValue([]);
    await builtin_cubepath(['/net/pacs/queries/empty']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('No series found'));
    expect(process.exitCode).toBe(1);
  });

  it('errors when not connected to ChRIS', async () => {
    mockServerResolve.mockResolvedValue('PACSDCM');
    mockSeriesCollect.mockResolvedValue([{ seriesUID: '1.2', seriesLabel: 'AX_T2' }]);
    mockClientGet.mockResolvedValue(null);
    await builtin_cubepath(['/net/pacs/queries/s']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Not connected'));
    expect(process.exitCode).toBe(1);
  });

  it('reports a resolved CUBE path with a file count', async () => {
    mockServerResolve.mockResolvedValue('PACSDCM');
    mockSeriesCollect.mockResolvedValue([{ seriesUID: '1.2', seriesLabel: 'AX_T2' }]);
    mockCubePathGet.mockResolvedValue({ folderPath: '/cube/data/series', fileCount: 5 });
    await builtin_cubepath(['/net/pacs/queries/s']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('5 files'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('/cube/data/series'));
  });

  it('flags a series with zero pulled files', async () => {
    mockServerResolve.mockResolvedValue('PACSDCM');
    mockSeriesCollect.mockResolvedValue([{ seriesUID: '1.2', seriesLabel: 'AX_T2' }]);
    mockCubePathGet.mockResolvedValue({ folderPath: '/cube/data/series', fileCount: 0 });
    await builtin_cubepath(['/net/pacs/queries/s']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('may not be pulled'));
  });

  it('reports series that are not in CUBE, with a summary', async () => {
    mockServerResolve.mockResolvedValue('PACSDCM');
    mockSeriesCollect.mockResolvedValue([{ seriesUID: '1.2', seriesLabel: 'AX_T2' }]);
    mockCubePathGet.mockResolvedValue(null);
    await builtin_cubepath(['/net/pacs/queries/s', '--retry']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not in CUBE'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1/1 series not found'));
  });

  it('honours an explicit --pacsserver override', async () => {
    mockServerResolve.mockResolvedValue('PACSDCM');
    mockSeriesCollect.mockResolvedValue([{ seriesUID: '1.2', seriesLabel: 'AX_T2' }]);
    mockCubePathGet.mockResolvedValue({ folderPath: '/cube/x', fileCount: 1 });
    await builtin_cubepath(['/net/pacs/queries/s', '--pacsserver', '3']);
    expect(mockServerResolve).toHaveBeenCalledWith('3');
  });
});
