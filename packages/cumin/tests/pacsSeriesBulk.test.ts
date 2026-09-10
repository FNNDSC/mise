/**
 * @file The bulk stored-series lookup.
 *
 * The defect this exists for: reconciling a stored PACS answer against what
 * CUBE already holds asked about every series in turn, two round trips
 * each. A patient's history of 299 series took twenty seconds against a
 * live CUBE, so a REPLAYED query — the whole point of which is that it does
 * not trouble the PACS — felt exactly like a fresh one.
 *
 * CUBE indexes a stored series by its study, so the same reconciliation is
 * one page per study. These hold it to that: the shape of the asking is the
 * thing under test, not just the answer, because an answer built the slow
 * way looks identical.
 */

jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import { seriesStorage_resolveMany, type SeriesStorageFilter } from '../src/pacs/chrisPACS';
import { errorStack } from '../src/error/errorStack';
import { Result } from '../src/utils/result';
import { SeriesStorageState } from '../src/pacs/chrisPACS';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;

/** One stored-series record as CUBE returns it. */
const series_row = (uid: string, folder: string): { data: Record<string, string> } => ({
  data: { SeriesInstanceUID: uid, folder_path: folder },
});

/** A list resource holding rows. */
const list_of = (rows: unknown[], totalCount?: number): unknown => ({
  getItems: (): unknown[] => rows,
  totalCount: totalCount ?? rows.length,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('seriesStorage_resolveMany', () => {
  it('asks once per filter, whatever the number of series that come back', async () => {
    const getPACSSeriesList: jest.Mock = jest.fn(async () =>
      list_of([series_row('1.1', 'SERVICES/PACS/S/a'), series_row('1.2', 'SERVICES/PACS/S/b')]));
    const getPACSFiles: jest.Mock = jest.fn(async () => list_of([], 62));
    mockClientGet.mockResolvedValue({ getPACSSeriesList, getPACSFiles });

    const filters: SeriesStorageFilter[] = [{ StudyInstanceUID: '9.1' }, { StudyInstanceUID: '9.2' }];
    const out: Result<Map<string, SeriesStorageState>> = await seriesStorage_resolveMany(filters);

    expect(out.ok).toBe(true);
    // Two studies, two questions — NOT one per series, which is the whole
    // point: the cost follows the study count, and studies are few.
    expect(getPACSSeriesList).toHaveBeenCalledTimes(2);
    expect(getPACSSeriesList.mock.calls[0]?.[0]).toMatchObject({ StudyInstanceUID: '9.1' });
    if (!out.ok) return;
    expect(out.value.get('1.1')).toEqual({ fileCount: 62, folderPath: '/SERVICES/PACS/S/a' });
  });

  it('gives every folder a leading slash, since CUBE stores it without one', async () => {
    mockClientGet.mockResolvedValue({
      getPACSSeriesList: jest.fn(async () => list_of([series_row('1.1', 'SERVICES/PACS/S/a')])),
      getPACSFiles: jest.fn(async () => list_of([], 5)),
    });
    const out = await seriesStorage_resolveMany([{ StudyInstanceUID: '9.1' }]);
    expect(out.ok && out.value.get('1.1')?.folderPath).toBe('/SERVICES/PACS/S/a');
  });

  it('walks the pages, so a study larger than one page is not silently cut', async () => {
    const page: unknown[] = Array.from({ length: 300 }, (_unused: unknown, i: number) =>
      series_row(`p.${i}`, `SERVICES/PACS/S/${i}`));
    const getPACSSeriesList: jest.Mock = jest.fn()
      .mockResolvedValueOnce(list_of(page))
      .mockResolvedValueOnce(list_of([series_row('p.300', 'SERVICES/PACS/S/300')]));
    mockClientGet.mockResolvedValue({ getPACSSeriesList, getPACSFiles: jest.fn(async () => list_of([], 1)) });

    const out = await seriesStorage_resolveMany([{ PatientID: '123' }], { counts: false });

    expect(getPACSSeriesList).toHaveBeenCalledTimes(2);
    expect(getPACSSeriesList.mock.calls[1]?.[0]).toMatchObject({ offset: 300 });
    expect(out.ok && out.value.size).toBe(301);
  });

  it('holds only the series CUBE actually has a folder for', async () => {
    mockClientGet.mockResolvedValue({
      getPACSSeriesList: jest.fn(async () => list_of([
        series_row('1.1', 'SERVICES/PACS/S/a'),
        { data: { SeriesInstanceUID: '1.2' } },
        { data: { folder_path: 'SERVICES/PACS/S/c' } },
      ])),
      getPACSFiles: jest.fn(async () => list_of([], 3)),
    });
    const out = await seriesStorage_resolveMany([{ StudyInstanceUID: '9.1' }]);
    expect(out.ok && [...out.value.keys()]).toEqual(['1.1']);
  });

  it('counts files only for what it found, and only when asked', async () => {
    const getPACSFiles: jest.Mock = jest.fn(async () => list_of([], 62));
    mockClientGet.mockResolvedValue({
      getPACSSeriesList: jest.fn(async () => list_of([series_row('1.1', 'SERVICES/PACS/S/a')])),
      getPACSFiles,
    });

    await seriesStorage_resolveMany([{ StudyInstanceUID: '9.1' }], { counts: false });
    expect(getPACSFiles).not.toHaveBeenCalled();

    await seriesStorage_resolveMany([{ StudyInstanceUID: '9.1' }]);
    expect(getPACSFiles).toHaveBeenCalledTimes(1);
    // One row asked for: the count is the question, the rows are not wanted.
    expect(getPACSFiles.mock.calls[0]?.[0]).toMatchObject({ fname: 'SERVICES/PACS/S/a', limit: 1 });
  });

  it('answers an empty map with no client, rather than failing the caller', async () => {
    mockClientGet.mockResolvedValue(null);
    const out = await seriesStorage_resolveMany([{ StudyInstanceUID: '9.1' }]);
    expect(out.ok).toBe(true);
    expect(out.ok && out.value.size).toBe(0);
  });

  it('reports a refusal as an error, so a caller can fall back instead of believing nothing is held', async () => {
    mockClientGet.mockResolvedValue({
      getPACSSeriesList: jest.fn(async () => { throw new Error('CUBE said no'); }),
      getPACSFiles: jest.fn(),
    });
    const out = await seriesStorage_resolveMany([{ StudyInstanceUID: '9.1' }]);
    expect(out.ok).toBe(false);
  });
});
