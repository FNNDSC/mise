/**
 * Boundary-only tests for PacsVfsProvider. Real pacsHelpers / Result / Context;
 * stubbed cumin client+context, salsa pacs/index, files/index and pacs_content.
 */
const mockClientGet = jest.fn();
const mockCtxGet = jest.fn();
const mockPacs = {
  pacsServers_list: jest.fn(),
  pacsQueries_list: jest.fn(),
  pacsQueries_create: jest.fn(),
  pacsRetrieve_create: jest.fn(),
  pacsRetrieve_statusForQuery: jest.fn(),
  pacsQuery_resultDecode: jest.fn(),
};
const mockCopyRecursively = jest.fn();
const mockContent = { pacsVfs_read: jest.fn(), pacsVfs_readBinary: jest.fn() };

jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  chrisConnection: { client_get: mockClientGet },
  chrisContext: { current_get: mockCtxGet },
}));
jest.mock('../src/pacs/index', () => mockPacs);
jest.mock('../src/files/index', () => ({ files_copyRecursively: mockCopyRecursively }));
jest.mock('../src/vfs/providers/pacs_content', () => mockContent);

import { Ok, Err, errorStack } from '@fnndsc/cumin';
import { PacsVfsProvider } from '../src/vfs/providers/pacs';

let provider: PacsVfsProvider;

const DECODED = {
  json: {
    studies: [
      {
        StudyInstanceUID: 'S1',
        StudyDescription: 'Head',
        series: [{ SeriesInstanceUID: 'SE1', SeriesDescription: 'Axial' }],
      },
    ],
  },
};

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

beforeEach(() => {
  jest.clearAllMocks();
  errorStack.stack_clear();
  provider = new PacsVfsProvider(); // fresh per test -> clean query cache
});

describe('list', () => {
  it('lists the pacs root', async () => {
    const r = await provider.list('/net/pacs');
    expect(r.ok && r.value.map((i) => i.name)).toEqual(['queries']);
  });

  it('lists queries with a descriptive name', async () => {
    mockPacs.pacsQueries_list.mockResolvedValue(
      Ok({
        tableData: [
          { id: 5, title: 't', query: '{"PatientID":"123"}', result: 'hit', owner_username: 'chris', creation_date: 'd' },
        ],
      })
    );
    const r = await provider.list('/net/pacs/queries');
    const name = r.ok ? r.value[0].name : '';
    expect(name).toContain('PatientID:123');
    expect(name).toContain('qid:5');
    expect(name).toContain('chris');
    expect(name).not.toContain('no-hits');
  });

  it('returns [] when there are no queries', async () => {
    mockPacs.pacsQueries_list.mockResolvedValue(Ok(null));
    const r = await provider.list('/net/pacs/queries');
    expect(r.ok && r.value).toEqual([]);
  });

  it('lists studies for a query folder', async () => {
    mockPacs.pacsQuery_resultDecode.mockResolvedValue(Ok(DECODED));
    const r = await provider.list('/net/pacs/queries/q_qid:5');
    expect(r.ok && r.value.map((i) => i.name)).toEqual(['Study_S1_Head']);
  });

  it('lists series for a study', async () => {
    mockPacs.pacsQuery_resultDecode.mockResolvedValue(Ok(DECODED));
    const r = await provider.list('/net/pacs/queries/q_qid:5/Study_S1_Head');
    expect(r.ok && r.value.map((i) => i.name)).toEqual(['Series_SE1_Axial']);
  });

  it('lists the files inside a series', async () => {
    mockPacs.pacsQuery_resultDecode.mockResolvedValue(Ok(DECODED));
    const r = await provider.list('/net/pacs/queries/q_qid:5/Study_S1_Head/Series_SE1_Axial');
    expect(r.ok && r.value.map((i) => i.name)).toEqual(['metadata.json', 'image_slices.dcm']);
  });

  it('caches the decoded result across calls', async () => {
    mockPacs.pacsQuery_resultDecode.mockResolvedValue(Ok(DECODED));
    await provider.list('/net/pacs/queries/q_qid:5');
    await provider.list('/net/pacs/queries/q_qid:5/Study_S1_Head');
    expect(mockPacs.pacsQuery_resultDecode).toHaveBeenCalledTimes(1);
  });

  it('errors on an invalid top-level directory', async () => {
    expect((await provider.list('/net/pacs/other/x')).ok).toBe(false);
  });

  it('errors on a folder with no query id', async () => {
    expect((await provider.list('/net/pacs/queries/badfolder')).ok).toBe(false);
  });

  it('errors when the query has no decoded payload', async () => {
    mockPacs.pacsQuery_resultDecode.mockResolvedValue(Ok({ json: null }));
    expect((await provider.list('/net/pacs/queries/q_qid:5')).ok).toBe(false);
  });

  it('returns [] for an unknown study', async () => {
    mockPacs.pacsQuery_resultDecode.mockResolvedValue(Ok(DECODED));
    const r = await provider.list('/net/pacs/queries/q_qid:5/Study_NOPE_x');
    expect(r.ok && r.value).toEqual([]);
  });

  it('honours sort + reverse options', async () => {
    mockPacs.pacsQueries_list.mockResolvedValue(
      Ok({
        tableData: [
          { id: 1, title: 'b', query: '{}', creation_date: '2026-02-01' },
          { id: 2, title: 'a', query: '{}', creation_date: '2026-01-01' },
        ],
      })
    );
    const r = await provider.list('/net/pacs/queries', { sort: 'date', reverse: true });
    const dates = r.ok ? r.value.map((i) => i.date) : [];
    expect(dates).toEqual(['2026-02-01', '2026-01-01']); // date desc
  });
});

describe('read / readBinary delegate to pacs_content', () => {
  it('read', async () => {
    mockContent.pacsVfs_read.mockResolvedValue(Ok('content'));
    expect((await provider.read('/net/pacs/x')).ok).toBe(true);
    expect(mockContent.pacsVfs_read).toHaveBeenCalled();
  });
  it('readBinary', async () => {
    mockContent.pacsVfs_readBinary.mockResolvedValue(Ok(Buffer.from('x')));
    expect((await provider.readBinary('/net/pacs/x')).ok).toBe(true);
    expect(mockContent.pacsVfs_readBinary).toHaveBeenCalled();
  });
});

describe('cp early exits', () => {
  it('fails on an unparseable source path', async () => {
    expect(await provider.cp('/net/pacs', '/dest', {} as never)).toBe(false);
  });

  it('fails when the query cannot be decoded', async () => {
    mockPacs.pacsQuery_resultDecode.mockResolvedValue(Ok({ json: null }));
    expect(await provider.cp('/net/pacs/query_qid:5/Study_S1_Head', '/dest', {} as never)).toBe(false);
  });

  it('fails when the study is not in the decoded results', async () => {
    mockPacs.pacsQuery_resultDecode.mockResolvedValue(Ok(DECODED));
    expect(await provider.cp('/net/pacs/query_qid:5/Study_NOPE_x', '/dest', {} as never)).toBe(false);
  });

  it('fails when no PACS server can be resolved', async () => {
    mockPacs.pacsQuery_resultDecode.mockResolvedValue(Ok(DECODED));
    mockCtxGet.mockResolvedValue(null);
    mockPacs.pacsServers_list.mockResolvedValue(Ok([]));
    expect(await provider.cp('/net/pacs/query_qid:5/Study_S1_Head', '/dest', {} as never)).toBe(false);
  });
});

describe('cp success (fake timers through the poll loop)', () => {
  it('retrieves a series and copies it to the destination', async () => {
    jest.useFakeTimers();
    mockPacs.pacsQuery_resultDecode.mockResolvedValue(Ok(DECODED));
    mockCtxGet.mockResolvedValue('srv1'); // PACS server from context
    mockPacs.pacsQueries_create.mockResolvedValue(Ok({ id: 99 }));
    mockPacs.pacsRetrieve_create.mockResolvedValue(Ok({ id: 1 }));
    mockPacs.pacsRetrieve_statusForQuery.mockResolvedValue(
      Ok({ retrieveStatus: 'succeeded', studies: [] })
    );
    mockClientGet.mockResolvedValue({
      getPACSSeriesList: jest.fn().mockResolvedValue({
        getItems: () => [{ data: { folder_path: 'PACS/SE1' } }],
      }),
    });
    mockCopyRecursively.mockResolvedValue(true);

    const p = provider.cp('/net/pacs/query_qid:5/Study_S1_Head/Series_SE1_Axial', '/dest', {} as never);
    await jest.advanceTimersByTimeAsync(5000); // clear the 5s poll delay
    expect(await p).toBe(true);
    expect(mockCopyRecursively).toHaveBeenCalledWith('/PACS/SE1', '/dest/Series_SE1_Axial');
    jest.useRealTimers();
  });
});

describe('pacsServer_resolve fallback', () => {
  it('falls back to the first listed server when context is empty', async () => {
    mockPacs.pacsQuery_resultDecode.mockResolvedValue(Ok(DECODED));
    mockCtxGet.mockResolvedValue(null);
    mockPacs.pacsServers_list.mockResolvedValue(Ok([{ id: 7 }]));
    mockPacs.pacsQueries_create.mockResolvedValue(Err()); // stop after server resolve

    jest.useFakeTimers();
    const p = provider.cp('/net/pacs/query_qid:5/Study_S1_Head/Series_SE1_Axial', '/dest', {} as never);
    await jest.advanceTimersByTimeAsync(0);
    // query create fails -> series copy fails -> overall false, but server WAS resolved
    expect(await p).toBe(false);
    expect(mockPacs.pacsServers_list).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
