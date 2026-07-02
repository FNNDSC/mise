/**
 * Tests for PACSQueryGroupHandler. Commander actions are driven via parseAsync;
 * salsa, screen, result-render and payload-build are mocked; chrisContext and
 * the base handler methods are stubbed/spied.
 */
const mockList = jest.fn();
const mockCreate = jest.fn();
const mockDecode = jest.fn();
const mockPayloadBuild = jest.fn();
const mockRenderPretty = jest.fn();
const mockCtxGet = jest.fn();

jest.mock('@fnndsc/salsa', () => ({
  pacsQueries_list: mockList,
  pacsQueries_create: mockCreate,
  pacsQuery_resultDecode: mockDecode,
}));
jest.mock('../src/pacs/pacsQueryPayload', () => ({ pacsQueryPayload_build: mockPayloadBuild }));
jest.mock('../src/pacs/pacsResultRender', () => ({ pacsQueryResult_renderPretty: mockRenderPretty }));
jest.mock('../src/screen/screen', () => ({ border_draw: (s: string) => s }));
jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  ChRISPACSQueryGroup: jest.fn(),
  chrisContext: { current_get: mockCtxGet },
}));

import { Command } from 'commander';
import { Ok, Err } from '@fnndsc/cumin';
import { PACSQueryGroupHandler } from '../src/pacs/pacsQueryHandler';
import { BaseGroupHandler } from '../src/handlers/baseGroupHandler';

function run(argv: string[]): Promise<unknown> {
  const program = new Command();
  program.exitOverride();
  new PACSQueryGroupHandler().pacsQueryCommand_setup(program);
  program.commands.forEach((c) => {
    c.exitOverride();
    c.commands.forEach((sc) => sc.exitOverride());
  });
  return program.parseAsync(['pacsqueries', ...argv], { from: 'user' });
}

let logSpy: jest.SpyInstance;
let listSpy: jest.SpyInstance;
let fieldsSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  listSpy = jest.spyOn(BaseGroupHandler.prototype, 'resources_list').mockResolvedValue(undefined);
  fieldsSpy = jest.spyOn(BaseGroupHandler.prototype, 'resourceFields_list').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('list', () => {
  it('merges the pacs filter and lists when a server is in context', async () => {
    mockCtxGet.mockResolvedValue('5');
    await run(['list']);
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ search: 'pacs_id:5' }));
  });

  it('warns when no PACS server is available', async () => {
    mockCtxGet.mockResolvedValue(null);
    await run(['list']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No PACS server'));
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('uses a non-numeric identifier filter with --pacsserver', async () => {
    await run(['list', '--pacsserver', 'MYPACS']);
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ search: 'pacs_identifier:MYPACS' }));
  });
});

describe('fieldslist', () => {
  it('delegates to the base handler', async () => {
    await run(['fieldslist']);
    expect(fieldsSpy).toHaveBeenCalled();
  });
});

describe('create', () => {
  it('creates a query and prints the summary', async () => {
    mockPayloadBuild.mockReturnValue({ title: 'T', query: '{}' });
    mockCreate.mockResolvedValue(Ok({ id: 1, status: 'created', title: 'T' }));
    await run(['create', 'PatientID:123', '--pacsserver', 'MYPACS']);
    expect(mockCreate).toHaveBeenCalledWith('MYPACS', { title: 'T', query: '{}' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Created PACS query'));
  });

  it('warns when no PACS server is available', async () => {
    mockCtxGet.mockResolvedValue(null);
    await run(['create', 'PatientID:123']);
    expect(mockPayloadBuild).not.toHaveBeenCalled();
  });

  it('rejects an invalid query payload', async () => {
    mockPayloadBuild.mockReturnValue(null);
    await run(['create', 'garbage', '--pacsserver', 'X']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid query format'));
  });

  it('reports a creation failure', async () => {
    mockPayloadBuild.mockReturnValue({ query: '{}' });
    mockCreate.mockResolvedValue(Err());
    await run(['create', 'PatientID:123', '--pacsserver', 'X']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to create'));
  });
});

describe('decode', () => {
  it('rejects a non-numeric id', async () => {
    await run(['decode', 'abc']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('must be a number'));
  });

  it('pretty-prints a decoded json payload', async () => {
    mockDecode.mockResolvedValue(Ok({ json: { studies: [] } }));
    mockRenderPretty.mockReturnValue('PRETTY');
    await run(['decode', '5']);
    expect(logSpy).toHaveBeenCalledWith('PRETTY');
  });

  it('prints raw json with --raw', async () => {
    mockDecode.mockResolvedValue(Ok({ json: { a: 1 } }));
    await run(['decode', '5', '--raw']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"a": 1'));
  });

  it('prints text payloads', async () => {
    mockDecode.mockResolvedValue(Ok({ text: 'plain text' }));
    await run(['decode', '5']);
    expect(logSpy).toHaveBeenCalledWith('plain text');
  });

  it('notes a non-printable raw payload', async () => {
    mockDecode.mockResolvedValue(Ok({ raw: 'abcd' }));
    await run(['decode', '5']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('base64 length 4'));
  });

  it('reports a decode failure', async () => {
    mockDecode.mockResolvedValue(Err());
    await run(['decode', '5']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to decode'));
  });
});
