import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockPush = jest.fn();
const mockDecode = jest.fn();
const mockServersList = jest.fn();
const mockCurrentGet = jest.fn(async () => null as string | null);
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  errorStack: { stack_push: mockPush },
  pacsQuery_resultDecode: mockDecode,
  pacsServers_list: mockServersList,
  chrisContext: { current_get: mockCurrentGet },
  Context: { PACSserver: 'PACSserver' },
}));

const ok = <T>(value: T) => ({ ok: true as const, value });
const err = () => ({ ok: false as const });

const { pacsServer_resolve, pacs_seriesCollect, series_cubePathGet } =
  await import('../src/builtins/net/pacsUtils.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentGet.mockResolvedValue(null);
});

describe('pacsServer_resolve', () => {
  it('returns a non-numeric override as-is', async () => {
    expect(await pacsServer_resolve('PACSDCM')).toBe('PACSDCM');
    expect(mockServersList).not.toHaveBeenCalled();
  });

  it('maps a numeric override to the matching server identifier', async () => {
    mockServersList.mockResolvedValue(ok([{ id: 1, identifier: 'PACSDCM' }, { id: 2, identifier: 'ORTHANC' }]));
    expect(await pacsServer_resolve('2')).toBe('ORTHANC');
  });

  it('keeps the numeric string when no server matches', async () => {
    mockServersList.mockResolvedValue(ok([{ id: 1, identifier: 'PACSDCM' }]));
    expect(await pacsServer_resolve('9')).toBe('9');
  });

  it('keeps the numeric string when the server list fails', async () => {
    mockServersList.mockResolvedValue(err());
    expect(await pacsServer_resolve('9')).toBe('9');
  });

  it('falls back to the context server when no override is given', async () => {
    mockCurrentGet.mockResolvedValue('ORTHANC');
    expect(await pacsServer_resolve()).toBe('ORTHANC');
  });

  it('defaults to the first registered server when nothing is set', async () => {
    mockServersList.mockResolvedValue(ok([{ id: 7, identifier: 'PACSDCM' }]));
    expect(await pacsServer_resolve()).toBe('7');
  });

  it('returns null when nothing is set and no servers exist', async () => {
    mockServersList.mockResolvedValue(ok([]));
    expect(await pacsServer_resolve()).toBeNull();
  });

  it('returns null when nothing is set and the list fails', async () => {
    mockServersList.mockResolvedValue(err());
    expect(await pacsServer_resolve()).toBeNull();
  });
});

const study = (uid: string, label: string, series: unknown[]): Record<string, unknown> => ({
  StudyInstanceUID: { value: uid },
  StudyDescription: label,
  RetrieveAETitle: { value: 'AET' },
  series,
});
const series = (uid: string, label: string, files: string): Record<string, unknown> => ({
  SeriesInstanceUID: { value: uid },
  SeriesDescription: label,
  NumberOfSeriesRelatedInstances: { value: files },
});

describe('pacs_seriesCollect', () => {
  it('rejects a path outside /net/pacs/queries', async () => {
    expect(await pacs_seriesCollect('/home/chris/feeds', 'PACSDCM')).toEqual([]);
    expect(mockPush).toHaveBeenCalledWith('error', expect.stringContaining('Not a PACS query path'));
  });

  it('rejects a query folder without a qid marker', async () => {
    expect(await pacs_seriesCollect('/net/pacs/queries/broken', 'PACSDCM')).toEqual([]);
    expect(mockPush).toHaveBeenCalledWith('error', expect.stringContaining('Cannot parse query ID'));
  });

  it('reports a decode failure', async () => {
    mockDecode.mockResolvedValue(err());
    expect(await pacs_seriesCollect('/net/pacs/queries/PatientID:X_qid:12', 'PACSDCM')).toEqual([]);
    expect(mockPush).toHaveBeenCalledWith('error', expect.stringContaining('Failed to decode results for query 12'));
  });

  it('collects all series from a query-level path', async () => {
    mockDecode.mockResolvedValue(ok({
      json: {
        studies: [
          study('1.2', 'Brain Study', [series('1.2.3', 'T1 MPRAGE', '176'), series('1.2.4', 'T2', '30')]),
        ],
      },
    }));
    const infos = await pacs_seriesCollect('/net/pacs/queries/PatientID:X_qid:12_chris', 'FALLBACK');
    expect(infos).toHaveLength(2);
    expect(infos[0]).toMatchObject({
      queryLabel: 'PatientID:X',
      studyLabel: 'Brain_Study',
      seriesLabel: 'T1_MPRAGE',
      seriesUID: '1.2.3',
      studyUID: '1.2',
      pacsName: 'AET',
      expectedFiles: 176,
    });
    expect(infos[0].label).toBe('PatientID:X|Brain_Study|T1_MPRAGE');
  });

  it('filters to one study on a study-level path', async () => {
    mockDecode.mockResolvedValue(ok({
      json: {
        studies: [
          study('1.2', 'Keep', [series('1.2.3', 'A', '1')]),
          study('9.9', 'Drop', [series('9.9.1', 'B', '1')]),
        ],
      },
    }));
    const infos = await pacs_seriesCollect('/net/pacs/queries/q_qid:1/Study_1.2_Keep', 'PACSDCM');
    expect(infos).toHaveLength(1);
    expect(infos[0].studyUID).toBe('1.2');
  });

  it('filters to one series on a series-level path', async () => {
    mockDecode.mockResolvedValue(ok({
      json: {
        studies: [study('1.2', 'S', [series('1.2.3', 'A', '1'), series('1.2.4', 'B', '1')])],
      },
    }));
    const infos = await pacs_seriesCollect('net/pacs/queries/q_qid:1/Study_1.2_S/Series_1.2.4_B', 'PACSDCM');
    expect(infos).toHaveLength(1);
    expect(infos[0].seriesUID).toBe('1.2.4');
  });

  it('uses the fallback PACS name and skips series without a UID', async () => {
    mockDecode.mockResolvedValue(ok({
      json: [{
        StudyInstanceUID: '1.2',
        Series: [{ SeriesDescription: 'no uid' }, series('1.2.3', 'Good', '5')],
      }],
    }));
    const infos = await pacs_seriesCollect('/net/pacs/queries/q_qid:1', 'FALLBACK');
    expect(infos).toHaveLength(1);
    expect(infos[0].pacsName).toBe('FALLBACK');
  });
});

interface FakeList { getItems(): Array<unknown>; totalCount: number }
const list = (items: unknown[], totalCount: number): FakeList => ({ getItems: () => items, totalCount });

describe('series_cubePathGet', () => {
  it('resolves the folder path and file count on the first attempt', async () => {
    const client = {
      getPACSSeriesList: jest.fn(async () => list([{ data: { folder_path: 'SERVICES/PACS/x' } }], 1)),
      getPACSFiles: jest.fn(async () => list([{}], 42)),
    };
    expect(await series_cubePathGet('1.2.3', client, 1, 0)).toEqual({
      folderPath: '/SERVICES/PACS/x',
      fileCount: 42,
    });
    expect(client.getPACSFiles).toHaveBeenCalledWith({ fname: 'SERVICES/PACS/x', limit: 1 });
  });

  it('strips a leading slash for the fname query but keeps it for display', async () => {
    const client = {
      getPACSSeriesList: jest.fn(async () => list([{ data: { folder_path: '/already/rooted' } }], 1)),
      getPACSFiles: jest.fn(async () => list([], 3)),
    };
    expect(await series_cubePathGet('1.2.3', client, 1, 0)).toEqual({
      folderPath: '/already/rooted',
      fileCount: 3,
    });
    expect(client.getPACSFiles).toHaveBeenCalledWith({ fname: 'already/rooted', limit: 1 });
  });

  it('retries when the series is not yet indexed', async () => {
    const client = {
      getPACSSeriesList: jest
        .fn(async () => list([{ data: { folder_path: 'p' } }], 1))
        .mockResolvedValueOnce(list([], 0)),
      getPACSFiles: jest.fn(async () => list([], 7)),
    };
    expect(await series_cubePathGet('1.2.3', client, 2, 0)).toEqual({ folderPath: '/p', fileCount: 7 });
    expect(client.getPACSSeriesList).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts when folder_path never appears', async () => {
    const client = {
      getPACSSeriesList: jest.fn(async () => list([{ data: {} }], 1)),
      getPACSFiles: jest.fn(async () => list([], 0)),
    };
    expect(await series_cubePathGet('1.2.3', client, 3, 0)).toBeNull();
    expect(client.getPACSSeriesList).toHaveBeenCalledTimes(3);
    expect(client.getPACSFiles).not.toHaveBeenCalled();
  });

  it('swallows client errors and returns null after retries', async () => {
    const client = {
      getPACSSeriesList: jest.fn(async () => { throw new Error('boom'); }),
      getPACSFiles: jest.fn(async () => list([], 0)),
    };
    expect(await series_cubePathGet('1.2.3', client, 2, 0)).toBeNull();
    expect(client.getPACSSeriesList).toHaveBeenCalledTimes(2);
  });

  it('clamps a negative file count to zero', async () => {
    const client = {
      getPACSSeriesList: jest.fn(async () => list([{ data: { folder_path: 'p' } }], 1)),
      getPACSFiles: jest.fn(async () => list([], -1)),
    };
    expect(await series_cubePathGet('1.2.3', client, 1, 0)).toEqual({ folderPath: '/p', fileCount: 0 });
  });
});
