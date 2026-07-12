import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockPluginGet = jest.fn(async () => null as string | null);
const mockStackPop = jest.fn(() => undefined as { message: string } | undefined);
const mockResolve = jest.fn();
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
  chrisContext: { ChRISplugin_get: mockPluginGet },
  errorStack: { stack_pop: mockStackPop },
  pipeline_resolve: mockResolve,
}));

const mockList = jest.fn();
const mockRun = jest.fn();
const mockSourceGet = jest.fn();
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  pipelines_list: mockList,
  pipeline_run: mockRun,
  pipeline_sourceGet: mockSourceGet,
}));

const mockFieldsFetch = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/pipeline/fields.js', () => ({ pipelineFields_fetch: mockFieldsFetch }));
const mockTableDisplay = jest.fn();
const mockTableRender = jest.fn(() => 'FIELDS_TABLE');
jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({ table_display: mockTableDisplay, table_render: mockTableRender }));

// pipeline streams through the sink line writers; inspect writes a table via sink_get().
const mockDataLine = jest.fn();
const mockErrLine = jest.fn();
const mockSinkWrite = jest.fn();
jest.unstable_mockModule('../src/core/sink.js', () => ({
  sink_dataLine: mockDataLine,
  sink_errLine: mockErrLine,
  sink_get: () => ({ data_write: mockSinkWrite, err_write: jest.fn() }),
}));

const mockClientGet = jest.fn(async () => null);
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { connection: { client_get: mockClientGet } },
}));

const { builtin_pipeline } = await import('../src/builtins/res/pipeline.js');

const ok = <T>(value: T) => ({ ok: true as const, value });
const err = () => ({ ok: false as const });

beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  mockPluginGet.mockResolvedValue(null);
  mockClientGet.mockResolvedValue(null);
});

describe('builtin_pipeline', () => {
  it('shows usage with no subcommand', async () => {
    await builtin_pipeline([]);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('Usage: pipeline'));
  });

  it('shows the current context node in usage when set', async () => {
    mockPluginGet.mockResolvedValue('42');
    await builtin_pipeline([]);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('instance 42'));
  });

  it('returns help for --help', async () => {
    const env = await builtin_pipeline(['--help']);
    expect(env.rendered).toContain('USAGE');
  });

  it('lists registered pipelines', async () => {
    mockList.mockResolvedValue({ tableData: [{ id: 1, name: 'MyPipe', category: 'seg', authors: 'me' }] });
    await builtin_pipeline(['list']);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('MyPipe'));
  });

  it('notes when no pipelines are registered', async () => {
    mockList.mockResolvedValue({ tableData: [] });
    await builtin_pipeline(['list']);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('No pipelines registered'));
  });

  it('requires a name for info', async () => {
    await builtin_pipeline(['info']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('Usage: pipeline info'));
    expect(process.exitCode).toBe(1);
  });

  it('prints info and reports a disconnected node fetch', async () => {
    mockResolve.mockResolvedValue(ok({ name: 'MyPipe', id: 7, locked: false }));
    await builtin_pipeline(['info', 'MyPipe']);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('MyPipe'));
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('not connected'));
  });

  it('reports an info resolve failure', async () => {
    mockResolve.mockResolvedValue(err());
    mockStackPop.mockReturnValue({ message: 'no such pipeline' });
    await builtin_pipeline(['info', 'ghost']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('no such pipeline'));
    expect(process.exitCode).toBe(1);
  });

  it('requires a name for run', async () => {
    await builtin_pipeline(['run']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('Usage: pipeline run'));
  });

  it('runs a pipeline on the context node', async () => {
    mockPluginGet.mockResolvedValue('5');
    mockResolve.mockResolvedValue(ok({ name: 'MyPipe' }));
    mockRun.mockResolvedValue(ok({ workflowId: 99, pluginInstanceIds: [1, 2] }));
    await builtin_pipeline(['run', 'MyPipe']);
    expect(mockRun).toHaveBeenCalledWith('MyPipe', 5, undefined);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('Workflow 99 created'));
  });

  it('refuses to run without a context node', async () => {
    mockPluginGet.mockResolvedValue(null);
    await builtin_pipeline(['run', 'MyPipe']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('no plugin instance in context'));
    expect(process.exitCode).toBe(1);
  });

  it('prints pipeline source', async () => {
    mockSourceGet.mockResolvedValue(ok('yaml: source'));
    await builtin_pipeline(['source', 'MyPipe']);
    expect(mockDataLine).toHaveBeenCalledWith('yaml: source');
  });

  it('reports a source failure', async () => {
    mockSourceGet.mockResolvedValue(err());
    mockStackPop.mockReturnValue({ message: 'no source' });
    await builtin_pipeline(['source', 'MyPipe']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('no source'));
  });

  it('inspects fields via table_render', async () => {
    mockFieldsFetch.mockResolvedValue(['id', 'name']);
    await builtin_pipeline(['inspect']);
    expect(mockTableRender).toHaveBeenCalled();
  });

  it('notes empty fields on inspect', async () => {
    mockFieldsFetch.mockResolvedValue([]);
    await builtin_pipeline(['inspect']);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('No fields'));
  });

  it('routes search to list', async () => {
    mockList.mockResolvedValue({ tableData: [] });
    await builtin_pipeline(['search', 'brain']);
    expect(mockList).toHaveBeenCalledWith('brain');
  });

  it('rejects an unknown subcommand', async () => {
    await builtin_pipeline(['frobnicate']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining("unknown subcommand 'frobnicate'"));
    expect(process.exitCode).toBe(1);
  });

  it('prints pipeline nodes when connected', async () => {
    mockResolve.mockResolvedValue(ok({ name: 'MyPipe', id: 7, locked: false }));
    mockClientGet.mockResolvedValue({
      getPipeline: async () => ({
        data: {},
        getPluginPipings: async () => ({
          getItems: () => [{ data: { id: 1, title: 'root', plugin_name: 'pl-a', plugin_version: '1.0', previous_id: null } }],
        }),
      }),
    } as never);
    await builtin_pipeline(['info', 'MyPipe']);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('Nodes'));
  });

  it('reports an error thrown while fetching nodes', async () => {
    mockResolve.mockResolvedValue(ok({ name: 'MyPipe', id: 7, locked: false }));
    mockClientGet.mockResolvedValue({
      getPipeline: async () => { throw new Error('api down'); },
    } as never);
    await builtin_pipeline(['info', 'MyPipe']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('api down'));
  });

  it('rejects a non-numeric context node on run', async () => {
    mockPluginGet.mockResolvedValue('abc');
    await builtin_pipeline(['run', 'MyPipe']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('invalid context instance'));
    expect(process.exitCode).toBe(1);
  });

  it('reports a run resolve failure', async () => {
    mockPluginGet.mockResolvedValue('5');
    mockResolve.mockResolvedValue(err());
    mockStackPop.mockReturnValue({ message: 'gone' });
    await builtin_pipeline(['run', 'MyPipe']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('gone'));
  });

  it('reports a workflow creation failure', async () => {
    mockPluginGet.mockResolvedValue('5');
    mockResolve.mockResolvedValue(ok({ name: 'MyPipe' }));
    mockRun.mockResolvedValue(err());
    mockStackPop.mockReturnValue({ message: 'queue full' });
    await builtin_pipeline(['run', 'MyPipe']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('queue full'));
  });

  it('requires a name for source', async () => {
    await builtin_pipeline(['source']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('Usage: pipeline source'));
    expect(process.exitCode).toBe(1);
  });
});
