/**
 * @file Tests for PACS file content retrieval, mocked at the cumin and
 * file-lookup boundaries.
 */

let mockGetText: jest.Mock;
let mockGetBlob: jest.Mock;
let mockIdResolve: jest.Mock;

jest.mock('@fnndsc/cumin', () => ({
  Err: (): { ok: false } => ({ ok: false }),
  pacsFile_getText: (...args: unknown[]): Promise<unknown> => mockGetText(...args),
  pacsFile_getBlob: (...args: unknown[]): Promise<unknown> => mockGetBlob(...args),
}));
jest.mock('../src/files/fileLookup', () => ({
  fileId_atPath_resolve: (...args: unknown[]): Promise<unknown> => mockIdResolve(...args),
}));

import { fileContent_getPACS, fileContent_getPACSBinary } from '../src/files/pacs_content';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetText = jest.fn();
  mockGetBlob = jest.fn();
  mockIdResolve = jest.fn();
});

describe('fileContent_getPACS', () => {
  it('resolves the file id and fetches text content', async () => {
    mockIdResolve.mockResolvedValue({ ok: true, value: 42 });
    mockGetText.mockResolvedValue({ ok: true, value: 'report' });
    const result = await fileContent_getPACS('/SERVICES/PACS/x/report.txt');
    expect(result).toEqual({ ok: true, value: 'report' });
    expect(mockGetText).toHaveBeenCalledWith(42);
  });

  it('errors when the path cannot be resolved', async () => {
    mockIdResolve.mockResolvedValue({ ok: false });
    expect((await fileContent_getPACS('/ghost.dcm')).ok).toBe(false);
    expect(mockGetText).not.toHaveBeenCalled();
  });
});

describe('fileContent_getPACSBinary', () => {
  it('resolves the file id and fetches binary content', async () => {
    mockIdResolve.mockResolvedValue({ ok: true, value: 7 });
    mockGetBlob.mockResolvedValue({ ok: true, value: Buffer.from('DICM') });
    const result = await fileContent_getPACSBinary('/SERVICES/PACS/x/img.dcm');
    expect(result.ok).toBe(true);
    expect(mockGetBlob).toHaveBeenCalledWith(7);
  });

  it('errors when the path cannot be resolved', async () => {
    mockIdResolve.mockResolvedValue({ ok: false });
    expect((await fileContent_getPACSBinary('/ghost.dcm')).ok).toBe(false);
  });
});
