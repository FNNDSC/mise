/**
 * @file Tests for the PACS retrieve command group, driven through a real
 * commander program. salsa and cumin mocked at their seams; border_draw
 * reduced to identity so output is directly assertable.
 */

let mockCreate: jest.Mock;
let mockDelete: jest.Mock;
let mockStatus: jest.Mock;
jest.mock('@fnndsc/salsa', () => ({
  pacsRetrieve_create: (...a: unknown[]): unknown => mockCreate(...a),
  pacsRetrieve_delete: (...a: unknown[]): unknown => mockDelete(...a),
  pacsRetrieve_statusForQuery: (...a: unknown[]): unknown => mockStatus(...a),
}));

let mockErrorsGet: jest.Mock;
jest.mock('@fnndsc/cumin', () => ({
  errorStack_getAllOfType: (...a: unknown[]): unknown => mockErrorsGet(...a),
}));

jest.mock('../src/screen/screen', () => ({
  border_draw: (s: string): string => s,
}));

import { Command } from 'commander';
import { PACSRetrieveGroupHandler } from '../src/pacs/pacsRetrieveHandler';

const run = async (...args: string[]): Promise<void> => {
  const program: Command = new Command();
  program.exitOverride();
  new PACSRetrieveGroupHandler().pacsRetrieveCommand_setup(program);
  await program.parseAsync(['node', 'chili', 'pacsretrieve', ...args]);
};

const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

let logSpy: jest.SpyInstance;
const logged = (): string => logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
beforeEach(() => {
  jest.clearAllMocks();
  mockCreate = jest.fn();
  mockDelete = jest.fn();
  mockStatus = jest.fn();
  mockErrorsGet = jest.fn(() => []);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
});

describe('pull', () => {
  it('creates a retrieve and reports its id', async () => {
    mockCreate.mockResolvedValue(ok({ id: 21, status: 'created' }));
    await run('pull', '9');
    expect(mockCreate).toHaveBeenCalledWith(9);
    expect(logged()).toContain('Created PACS retrieve id=21 query=9 status=created');
  });

  it('rejects a non-numeric query id', async () => {
    await run('pull', 'abc');
    expect(logged()).toContain('Query ID must be a number.');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('prints stacked errors, or a fallback, on failure', async () => {
    mockCreate.mockResolvedValue({ ok: false });
    mockErrorsGet.mockReturnValue(['no such query']);
    await run('pull', '9');
    expect(logged()).toContain('no such query');

    mockErrorsGet.mockReturnValue([]);
    await run('pull', '9');
    expect(logged()).toContain('Failed to create PACS retrieve for query 9.');
  });
});

describe('report', () => {
  it('renders a full status report with every series state', async () => {
    mockStatus.mockResolvedValue(ok({
      queryId: 9,
      retrieveId: 21,
      retrieveStatus: 'sent',
      studies: [{
        studyInfo: {},
        studyDescription: { value: 'Brain' },
        studyInstanceUID: '1.2',
        series: [
          { seriesInfo: {}, seriesInstanceUID: 'a', seriesDescription: 'T1', status: 'pending', actualFiles: 0, expectedFiles: 4 },
          { seriesInfo: {}, seriesInstanceUID: 'b', seriesDescription: 'T2', status: 'pulling', actualFiles: 2, expectedFiles: 4 },
          { seriesInfo: {}, seriesInstanceUID: 'c', seriesDescription: '', status: 'pulled', actualFiles: 4, expectedFiles: 4 },
          { seriesInfo: {}, seriesInstanceUID: 'd', seriesDescription: 'DWI', status: 'error', actualFiles: 6, expectedFiles: 4 },
        ],
      }],
    }));
    await run('report', '9');
    const output: string = logged();
    expect(output).toContain('Retrieve Status: Retrieving');
    expect(output).toContain('Description: Brain');
    expect(output).toContain('T1: Pending (0/4 images)');
    expect(output).toContain('T2: Pulling (2/4 images)');
    expect(output).toContain('Series 3: Pulled (4 images)');
    expect(output).toContain('DWI: Error (6/4 images - count mismatch)');
  });

  it('reports Completed when every series is pulled', async () => {
    mockStatus.mockResolvedValue(ok({
      queryId: 9,
      retrieveId: 21,
      retrieveStatus: 'sent',
      studies: [{
        studyInfo: {},
        series: [{ seriesInfo: {}, seriesInstanceUID: 'a', status: 'pulled', actualFiles: 4, expectedFiles: 4 }],
      }],
    }));
    await run('report', '9');
    expect(logged()).toContain('Retrieve Status: Completed');
  });

  it('handles the no-retrieve and no-studies cases', async () => {
    mockStatus.mockResolvedValue(ok({ queryId: 9, studies: [] }));
    await run('report', '9');
    expect(logged()).toContain('Retrieve Status: No retrieve created yet');
    expect(logged()).toContain('No studies found in query result.');
  });

  it('rejects a non-numeric id and reports failures', async () => {
    await run('report', 'abc');
    expect(logged()).toContain('Query ID must be a number.');

    mockStatus.mockResolvedValue({ ok: false });
    mockErrorsGet.mockReturnValue([]);
    await run('report', '9');
    expect(logged()).toContain('Failed to generate status report for query 9.');
  });
});

describe('cancel', () => {
  it('cancels a retrieve', async () => {
    mockDelete.mockResolvedValue(ok(undefined));
    await run('cancel', '21');
    expect(mockDelete).toHaveBeenCalledWith(21);
    expect(logged()).toContain('PACS retrieve 21 cancelled.');
  });

  it('rejects a non-numeric id and reports failures', async () => {
    await run('cancel', 'abc');
    expect(logged()).toContain('Retrieve ID must be a number.');

    mockDelete.mockResolvedValue({ ok: false });
    mockErrorsGet.mockReturnValue(['permission denied']);
    await run('cancel', '21');
    expect(logged()).toContain('permission denied');
  });
});
