/**
 * @file What CUBE's series record says of a series in its PACS store.
 *
 * CUBE cannot be asked by folder, so a series' facts are found through its
 * patient: the patient folder begins with the patient's ID, the series list
 * answers by patient, and the folder is matched exactly among the answer.
 * One ask serves every series of the patient; a failed ask is not kept.
 */

jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import { pacsSeriesFolder_of, pacsSeriesFacts_ofPath, pacsSeriesFacts_clear } from '../src/pacs/chrisPACS';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;
const list_of = (rows: unknown[]): unknown => ({ getItems: (): unknown[] => rows, totalCount: rows.length });
const FOLDER: string = 'SERVICES/PACS/PACSDCM/1234567-X-19000101/Study-1-20200101/00005-SAG_MPRAGE-abc';

beforeEach(() => {
  jest.clearAllMocks();
  pacsSeriesFacts_clear();
});

describe('pacsSeriesFolder_of', () => {
  it('finds the series folder, PACS and patient of a path in the PACS store, and nothing elsewhere', () => {
    expect(pacsSeriesFolder_of(`/${FOLDER}/0001.dcm`)).toEqual({ folder: FOLDER, pacs: 'PACSDCM', patient: '1234567-X-19000101' });
    expect(pacsSeriesFolder_of(FOLDER)).toEqual({ folder: FOLDER, pacs: 'PACSDCM', patient: '1234567-X-19000101' });
    expect(pacsSeriesFolder_of('/home/u/uploads/a/b/c/d.dcm')).toBeNull();
    expect(pacsSeriesFolder_of('/SERVICES/PACS/PACSDCM/1234567-X')).toBeNull();
  });
});

describe('pacsSeriesFacts_ofPath', () => {
  it('asks by patient once, matches the folder exactly, and keeps only modality and description', async () => {
    const getPACSSeriesList = jest.fn(async () => list_of([
      { data: { folder_path: FOLDER, Modality: 'MR ', SeriesDescription: ' SAG MPRAGE', PatientName: 'kept nowhere' } },
      { data: { folder_path: `${FOLDER}-other`, Modality: 'CT' } },
    ]));
    mockClientGet.mockResolvedValue({ getPACSSeriesList });
    expect(await pacsSeriesFacts_ofPath(`/${FOLDER}/0001.dcm`)).toEqual({ modality: 'MR', seriesDescription: 'SAG MPRAGE' });
    expect(await pacsSeriesFacts_ofPath(`/${FOLDER}-other/0001.dcm`)).toEqual({ modality: 'CT' });
    expect(getPACSSeriesList).toHaveBeenCalledTimes(1);
    expect(getPACSSeriesList).toHaveBeenCalledWith(expect.objectContaining({ PatientID: '1234567', pacs_identifier: 'PACSDCM' }));
    expect(await pacsSeriesFacts_ofPath(`/${FOLDER.replace('00005', '00009')}/0001.dcm`)).toBeNull();
  });

  it('answers nothing outside the PACS store and forgets a failed ask', async () => {
    const getPACSSeriesList = jest.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(list_of([{ data: { folder_path: FOLDER, Modality: 'MR' } }]));
    mockClientGet.mockResolvedValue({ getPACSSeriesList });
    expect(await pacsSeriesFacts_ofPath('/home/u/x.dcm')).toBeNull();
    expect(await pacsSeriesFacts_ofPath(`/${FOLDER}/1.dcm`)).toBeNull();
    expect(await pacsSeriesFacts_ofPath(`/${FOLDER}/1.dcm`)).toEqual({ modality: 'MR' });
    expect(getPACSSeriesList).toHaveBeenCalledTimes(2);
  });
});
