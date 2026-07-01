/**
 * Boundary-only tests for the PACS intents. Each wrapper forwards to the
 * matching cumin function and returns its Result unchanged; mock those.
 */
const mockPacs = {
  pacsServers_list: jest.fn(),
  pacsQueries_list: jest.fn(),
  pacsQueries_create: jest.fn(),
  pacsQuery_resultDecode: jest.fn(),
  pacsRetrieve_create: jest.fn(),
  pacsRetrieves_list: jest.fn(),
  pacsRetrieve_delete: jest.fn(),
  pacsRetrieve_statusForQuery: jest.fn(),
};

jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  ...mockPacs,
}));

import {
  pacsServers_list,
  pacsQueries_list,
  pacsQueries_create,
  pacsQuery_resultDecode,
  pacsRetrieve_create,
  pacsRetrieves_list,
  pacsRetrieve_delete,
  pacsRetrieve_statusForQuery,
} from '../src/pacs/index';

beforeEach(() => jest.clearAllMocks());

const SENTINEL = { ok: true, value: 'X' } as unknown;

it('pacsServers_list forwards options', async () => {
  mockPacs.pacsServers_list.mockResolvedValue(SENTINEL);
  expect(await pacsServers_list({ limit: 5 } as never)).toBe(SENTINEL);
  expect(mockPacs.pacsServers_list).toHaveBeenCalledWith({ limit: 5 });
});

it('pacsServers_list defaults options to {}', async () => {
  mockPacs.pacsServers_list.mockResolvedValue(SENTINEL);
  await pacsServers_list();
  expect(mockPacs.pacsServers_list).toHaveBeenCalledWith({});
});

it('pacsQueries_list forwards options', async () => {
  mockPacs.pacsQueries_list.mockResolvedValue(SENTINEL);
  expect(await pacsQueries_list({ pacs_id: 1 } as never)).toBe(SENTINEL);
  expect(mockPacs.pacsQueries_list).toHaveBeenCalledWith({ pacs_id: 1 });
});

it('pacsQueries_create forwards server + data', async () => {
  mockPacs.pacsQueries_create.mockResolvedValue(SENTINEL);
  expect(await pacsQueries_create('MYPACS', { PatientID: '123' } as never)).toBe(SENTINEL);
  expect(mockPacs.pacsQueries_create).toHaveBeenCalledWith('MYPACS', { PatientID: '123' });
});

it('pacsQuery_resultDecode forwards queryId', async () => {
  mockPacs.pacsQuery_resultDecode.mockResolvedValue(SENTINEL);
  expect(await pacsQuery_resultDecode(7)).toBe(SENTINEL);
  expect(mockPacs.pacsQuery_resultDecode).toHaveBeenCalledWith(7);
});

it('pacsRetrieve_create forwards queryId', async () => {
  mockPacs.pacsRetrieve_create.mockResolvedValue(SENTINEL);
  expect(await pacsRetrieve_create(7)).toBe(SENTINEL);
  expect(mockPacs.pacsRetrieve_create).toHaveBeenCalledWith(7);
});

it('pacsRetrieves_list forwards queryId + options', async () => {
  mockPacs.pacsRetrieves_list.mockResolvedValue(SENTINEL);
  expect(await pacsRetrieves_list(7, { limit: 2 } as never)).toBe(SENTINEL);
  expect(mockPacs.pacsRetrieves_list).toHaveBeenCalledWith(7, { limit: 2 });
});

it('pacsRetrieve_delete forwards retrieveId', async () => {
  mockPacs.pacsRetrieve_delete.mockResolvedValue(SENTINEL);
  expect(await pacsRetrieve_delete(3)).toBe(SENTINEL);
  expect(mockPacs.pacsRetrieve_delete).toHaveBeenCalledWith(3);
});

it('pacsRetrieve_statusForQuery forwards queryId', async () => {
  mockPacs.pacsRetrieve_statusForQuery.mockResolvedValue(SENTINEL);
  expect(await pacsRetrieve_statusForQuery(7)).toBe(SENTINEL);
  expect(mockPacs.pacsRetrieve_statusForQuery).toHaveBeenCalledWith(7);
});
