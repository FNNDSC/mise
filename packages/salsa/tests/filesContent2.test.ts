/**
 * Boundary-only tests for files/pacs_content and files/pipeline_content.
 * Stubs files_getGroup and the cumin pacsFile_/pipelineFile_ helpers.
 */
const mockGetGroup = jest.fn();
const mockCumin = {
  pacsFile_getText: jest.fn(),
  pacsFile_getBlob: jest.fn(),
  pipelineFile_getTextByPath: jest.fn(),
  pipelineFile_getByPath: jest.fn(),
};

jest.mock('../src/files/index', () => ({ files_getGroup: mockGetGroup }));
jest.mock('@fnndsc/cumin', () => ({ ...jest.requireActual('@fnndsc/cumin'), ...mockCumin }));

import { Ok, errorStack } from '@fnndsc/cumin';
import { fileContent_getPACS, fileContent_getPACSBinary } from '../src/files/pacs_content';
import { fileContent_getPipeline, fileContent_getPipelineBinary } from '../src/files/pipeline_content';

function groupWith(tableData: unknown): void {
  mockGetGroup.mockResolvedValue({
    asset: { resources_getAll: jest.fn().mockResolvedValue(tableData ? { tableData } : null) },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  errorStack.stack_clear();
});

describe('fileContent_getPACS', () => {
  it('resolves the file id and fetches text', async () => {
    groupWith([{ id: 5, fname: '/d/img.dcm' }]);
    mockCumin.pacsFile_getText.mockResolvedValue(Ok('DICOM-TEXT'));
    const r = await fileContent_getPACS('/d/img.dcm');
    expect(r.ok && r.value).toBe('DICOM-TEXT');
    expect(mockCumin.pacsFile_getText).toHaveBeenCalledWith(5);
  });

  it('errors when the group is unavailable', async () => {
    mockGetGroup.mockResolvedValue(null);
    expect((await fileContent_getPACS('/d/img.dcm')).ok).toBe(false);
  });

  it('errors when the directory is empty', async () => {
    groupWith(null);
    expect((await fileContent_getPACS('/d/img.dcm')).ok).toBe(false);
  });

  it('errors when the file is not found', async () => {
    groupWith([{ id: 1, fname: '/d/other.dcm' }]);
    expect((await fileContent_getPACS('/d/img.dcm')).ok).toBe(false);
  });

  it('errors when the file has no id', async () => {
    groupWith([{ fname: '/d/img.dcm' }]);
    expect((await fileContent_getPACS('/d/img.dcm')).ok).toBe(false);
  });
});

describe('fileContent_getPACSBinary', () => {
  it('resolves the file id and fetches a blob', async () => {
    groupWith([{ id: 5, fname: '/d/img.dcm' }]);
    const buf = Buffer.from([1, 2]);
    mockCumin.pacsFile_getBlob.mockResolvedValue(Ok(buf));
    const r = await fileContent_getPACSBinary('/d/img.dcm');
    expect(r.ok && r.value).toBe(buf);
  });

  it('errors when the file is not found', async () => {
    groupWith([{ id: 1, fname: '/d/other.dcm' }]);
    expect((await fileContent_getPACSBinary('/d/img.dcm')).ok).toBe(false);
  });
});

describe('pipeline content delegates to cumin', () => {
  it('text', async () => {
    mockCumin.pipelineFile_getTextByPath.mockResolvedValue(Ok('yaml'));
    expect((await fileContent_getPipeline('/PIPELINES/o/p.yml')).ok).toBe(true);
    expect(mockCumin.pipelineFile_getTextByPath).toHaveBeenCalledWith('/PIPELINES/o/p.yml');
  });
  it('binary', async () => {
    mockCumin.pipelineFile_getByPath.mockResolvedValue(Ok(Buffer.from('y')));
    expect((await fileContent_getPipelineBinary('/PIPELINES/o/p.yml')).ok).toBe(true);
    expect(mockCumin.pipelineFile_getByPath).toHaveBeenCalledWith('/PIPELINES/o/p.yml');
  });
});
