import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { CommandEnvelope } from '@fnndsc/cumin';

const mockPluginGet = jest.fn(async () => null as string | null);
const mockStackPop = jest.fn(() => undefined as { message: string } | undefined);
const mockCheckpointMark = jest.fn(() => 5);
const mockCheckpointDrain = jest.fn();
const mockResolve = jest.fn();
const mockInstanceGet = jest.fn();
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
  chrisContext: { ChRISplugin_get: mockPluginGet },
  errorStack: {
    stack_pop: mockStackPop,
    checkpoint_mark: mockCheckpointMark,
    checkpoint_drain: mockCheckpointDrain,
  },
  pipeline_resolve: mockResolve,
  procCache_get: () => ({ instance_get: mockInstanceGet }),
}));

const mockList = jest.fn();
const mockRun = jest.fn();
const mockSourceGet = jest.fn();
const mockProcRefresh = jest.fn(async () => undefined);
const mockDiagramGet: jest.Mock = jest.fn();
const mockManifestGet: jest.Mock = jest.fn();
const mockManifestBySlugGet: jest.Mock = jest.fn();
const mockFileContentGet: jest.Mock = jest.fn();
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  pipelines_list: mockList,
  pipeline_run: mockRun,
  pipeline_sourceGet: mockSourceGet,
  procCache_refresh: mockProcRefresh,
  pipelineDiagram_get: mockDiagramGet,
  pipelineManifest_get: mockManifestGet,
  pipelineManifestBySlug_get: mockManifestBySlugGet,
  fileContent_get: mockFileContentGet,
  context_getSingle: jest.fn(async () => ({ user: 'me' })),
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
const mockProgressWrite = jest.fn();
jest.unstable_mockModule('../src/core/sink.js', () => ({
  sink_dataLine: mockDataLine,
  sink_errLine: mockErrLine,
  sink_get: () => ({
    data_write: mockSinkWrite,
    err_write: jest.fn(),
    progress_write: mockProgressWrite,
  }),
}));

const mockClientGet = jest.fn(async () => null);
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { connection: { client_get: mockClientGet }, getCWD: jest.fn(async () => '/home/me') },
}));

const { builtin_pipeline } = await import('../src/builtins/res/pipeline.js');

const ok = <T>(value: T) => ({ ok: true as const, value });
const err = () => ({ ok: false as const });

beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  mockPluginGet.mockResolvedValue(null);
  mockClientGet.mockResolvedValue(null);
  mockInstanceGet.mockReturnValue(undefined);
  mockFileContentGet.mockResolvedValue(err());
  mockManifestGet.mockResolvedValue(ok({
    pipelineID: 7,
    name: 'MyPipe',
    rootIDs: [1],
    nodes: [{
      pipingID: 1,
      title: 'root',
      pluginName: 'pl-a',
      pluginVersion: '1.0',
      parentID: null,
      computeResourceName: 'host',
      memoryLimit: '4Gi',
      parameterDefaults: [{ name: 'threshold', value: 0.4 }],
      parameterDefinitions: [{ name: 'threshold', type: 'float', optional: true, default: 0.25 }],
    }],
  }));
  mockManifestBySlugGet.mockImplementation((specifier: string) => mockManifestGet(specifier));
  mockDiagramGet.mockResolvedValue(ok({
    pipelineID: 7,
    name: 'Brain Segmentation',
    rootIDs: [31],
    nodes: [
      {
        id: 31, title: 'input', pluginName: 'pl-mri-convert', parentID: null,
        joinParentIDs: [],
        arguments: [
          { name: 'threshold', value: 0 },
          { name: 'label', value: 'T1 weighted' },
          { name: 'unused', value: null },
        ],
      },
      {
        id: 32, title: 'segment', pluginName: 'pl-segment', parentID: 31,
        joinParentIDs: [], arguments: [{ name: 'normalize', value: false }],
      },
    ],
  }));
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
    expect(env.rendered).toContain('--paramFile');
    expect(env.rendered).toContain('--<node>.<parameter>');
    expect(env.rendered).toContain('manifest <name|id|slug>');
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

  it('prints registered pipeline metadata before its invocation parameters', async () => {
    mockResolve.mockResolvedValue(ok({ name: 'MyPipe', id: 7, locked: false }));
    await builtin_pipeline(['info', 'MyPipe']);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('MyPipe'));
  });

  it('reports an info resolve failure', async () => {
    mockResolve.mockResolvedValue(err());
    mockStackPop.mockReturnValue({ message: 'no such pipeline' });
    const result = await builtin_pipeline(['info', 'ghost']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('no such pipeline'));
    expect(process.exitCode).toBe(1);
    expect(result.status).toBe('error');
  });

  it('requires a name for run', async () => {
    await builtin_pipeline(['run']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('Usage: pipeline run'));
  });

  it('runs a pipeline on the context node', async () => {
    mockPluginGet.mockResolvedValue('5');
    mockResolve.mockResolvedValue(ok({ name: 'MyPipe' }));
    mockRun.mockResolvedValue(ok({ workflowId: 99, pluginInstanceIds: [1, 2] }));
    mockInstanceGet.mockReturnValue({ feedID: 77 });
    await builtin_pipeline(['run', 'MyPipe']);
    expect(mockRun).toHaveBeenCalledWith('MyPipe', 5, undefined);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('Workflow 99 created'));
    expect(mockProcRefresh).toHaveBeenCalledWith(77);
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

  it('emits the complete registered invocation YAML through pipeline manifest', async () => {
    const result: CommandEnvelope = await builtin_pipeline(['manifest', 'example_pipeline_id42']);

    expect(mockManifestBySlugGet).toHaveBeenCalledWith('example_pipeline_id42');
    expect(mockProgressWrite).not.toHaveBeenCalled();
    expect(result.rendered).toContain('pipeline_id: 7');
    expect(result.rendered).toContain('piping_id: 1');
    expect(result.rendered).toContain('memory_limit: 4Gi');
  });

  it('requests the lightweight registered projection for a Pipeline name', async () => {
    await builtin_pipeline(['manifest', 'Example Pipeline']);

    expect(mockManifestGet).toHaveBeenCalledWith(
      'Example Pipeline',
      { detail: 'registered' },
    );
    expect(mockManifestBySlugGet).not.toHaveBeenCalled();
  });

  it('falls back to name resolution when an id-shaped name is not an exact slug', async () => {
    mockManifestBySlugGet.mockResolvedValue(err());

    const result: CommandEnvelope = await builtin_pipeline(['manifest', 'Example_id42']);

    expect(result.status).toBe('ok');
    expect(mockManifestBySlugGet).toHaveBeenCalledWith('Example_id42');
    expect(mockCheckpointDrain).toHaveBeenCalledWith(5);
    expect(mockManifestGet).toHaveBeenCalledWith('Example_id42', { detail: 'registered' });
  });

  it('requires a Pipeline specifier for manifest output', async () => {
    const result: CommandEnvelope = await builtin_pipeline(['manifest']);

    expect(result.status).toBe('error');
    expect(result.renderedErr).toContain('Usage: pipeline manifest');
  });

  it('emits delayed semantic progress for a slow pipeline manifest read', async () => {
    jest.useFakeTimers();
    let resolveManifest: ((value: unknown) => void) | undefined;
    mockManifestBySlugGet.mockReturnValue(new Promise((resolve: (value: unknown) => void) => {
      resolveManifest = resolve;
    }));

    try {
      const pending: Promise<CommandEnvelope> = builtin_pipeline(['manifest', 'example_pipeline_id42']);
      await jest.advanceTimersByTimeAsync(299);
      expect(mockProgressWrite).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(mockProgressWrite).toHaveBeenCalledWith({
        operation: 'pipeline',
        kind: 'inspection',
        phase: 'reading',
        label: 'Reading registered pipeline…',
        status: 'running',
      });

      resolveManifest?.({
        ok: true,
        value: { pipelineID: 42, name: 'Example Pipeline', rootIDs: [], nodes: [] },
      });
      await pending;
      expect(mockProgressWrite).toHaveBeenLastCalledWith({
        operation: 'pipeline',
        kind: 'inspection',
        phase: 'complete',
        label: 'Reading registered pipeline…',
        status: 'done',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('marks delayed manifest progress failed when hydration rejects', async () => {
    jest.useFakeTimers();
    let rejectManifest: ((reason: Error) => void) | undefined;
    mockManifestBySlugGet.mockReturnValue(new Promise((
      _resolve: (value: unknown) => void,
      reject: (reason: Error) => void,
    ) => {
      rejectManifest = reject;
    }));

    try {
      const pending: Promise<CommandEnvelope> = builtin_pipeline(['manifest', 'example_pipeline_id42']);
      const rejection: Promise<void> = expect(pending).rejects.toThrow('CUBE unavailable');
      await jest.advanceTimersByTimeAsync(300);
      rejectManifest?.(new Error('CUBE unavailable'));
      await rejection;
      expect(mockProgressWrite).toHaveBeenLastCalledWith({
        operation: 'pipeline',
        kind: 'inspection',
        phase: 'failed',
        label: 'Reading registered pipeline…',
        status: 'error',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a source failure', async () => {
    mockSourceGet.mockResolvedValue(err());
    mockStackPop.mockReturnValue({ message: 'no source' });
    const result = await builtin_pipeline(['source', 'MyPipe']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('no source'));
    expect(result.status).toBe('error');
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

  it('draws a pipeline as a shallow tree from a multi-word specifier', async () => {
    const env: CommandEnvelope = await builtin_pipeline(['diagram', 'Brain', 'Segmentation']);
    expect(mockDiagramGet).toHaveBeenCalledWith('Brain Segmentation');
    expect(env.rendered).toContain('pipeline 7');
    expect(env.rendered).toContain('input');
    expect(env.rendered).toContain('pl-mri-convert');
    expect(env.rendered).toContain('[piping 31]');
    expect(env.rendered).not.toContain('--threshold');
  });

  it('adds concrete pipeline defaults with --withargs', async () => {
    const env: CommandEnvelope = await builtin_pipeline(['diagram', '--withargs', 'Brain', 'Segmentation']);
    expect(env.rendered).toContain("--threshold 0 --label 'T1 weighted'");
    expect(env.rendered).toContain('--normalize false');
    expect(env.rendered).not.toContain('--unused');
  });

  it('keeps similar authored pipings distinct and annotates joins', async () => {
    mockDiagramGet.mockResolvedValue(ok({
      pipelineID: 8, name: 'Fan in', rootIDs: [1], nodes: [
        { id: 1, title: 'input', pluginName: 'pl-root', parentID: null, joinParentIDs: [], arguments: [] },
        { id: 2, title: 'left', pluginName: 'pl-same', parentID: 1, joinParentIDs: [], arguments: [] },
        { id: 3, title: 'right', pluginName: 'pl-same', parentID: 1, joinParentIDs: [], arguments: [] },
        { id: 4, title: 'combine', pluginName: 'pl-ts', parentID: 2, joinParentIDs: [3], arguments: [] },
      ],
    }));

    const env: CommandEnvelope = await builtin_pipeline(['diagram', 'Fan in']);

    expect(env.rendered).toContain('left');
    expect(env.rendered).toContain('right');
    expect(env.rendered).not.toContain('×2');
    expect(env.rendered).toContain('⋈ joins 3');
  });

  it('emits pipeline SignalFlow YAML', async () => {
    const env: CommandEnvelope = await builtin_pipeline(['diagram', '--signalflow', 'Brain', 'Segmentation']);
    expect(env.rendered).toContain('tree:');
    expect(env.rendered).toContain('input');
    expect(env.model).toMatchObject({ kind: 'pipeline.diagram', data: { pipelineID: 7, dialect: 'signalflow' } });
  });

  it('rejects --withargs with --signalflow', async () => {
    const env: CommandEnvelope = await builtin_pipeline(['diagram', '--withargs', '--signalflow', 'Brain']);
    expect(env.status).toBe('error');
    expect(env.renderedErr).toContain('--withargs is only available for shallow rendering');
    expect(mockDiagramGet).not.toHaveBeenCalled();
  });

  it('rejects an unknown subcommand', async () => {
    await builtin_pipeline(['frobnicate']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining("unknown subcommand 'frobnicate'"));
    expect(process.exitCode).toBe(1);
  });

  it('prints compound parameters and execution controls from the registered manifest', async () => {
    mockResolve.mockResolvedValue(ok({ name: 'MyPipe', id: 7, locked: false }));
    await builtin_pipeline(['info', 'MyPipe']);
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('--root.threshold'));
    expect(mockDataLine).toHaveBeenCalledWith(expect.stringContaining('--root.memory_limit'));
  });

  it('reports an error while fetching the registered manifest', async () => {
    mockResolve.mockResolvedValue(ok({ name: 'MyPipe', id: 7, locked: false }));
    mockManifestGet.mockResolvedValue(err());
    mockStackPop.mockReturnValueOnce({ message: 'api down' });
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
    const result = await builtin_pipeline(['run', 'MyPipe']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('gone'));
    expect(result.status).toBe('error');
  });

  it('reports a workflow creation failure', async () => {
    mockPluginGet.mockResolvedValue('5');
    mockResolve.mockResolvedValue(ok({ name: 'MyPipe' }));
    mockRun.mockResolvedValue(err());
    mockStackPop.mockReturnValue({ message: 'queue full' });
    const result = await builtin_pipeline(['run', 'MyPipe']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('queue full'));
    expect(result.status).toBe('error');
  });

  it('loads a CFS parameter file and forwards its overlay with compound CLI bindings', async () => {
    mockPluginGet.mockResolvedValue('5');
    mockResolve.mockResolvedValue(ok({ name: 'MyPipe', id: 7 }));
    mockFileContentGet.mockResolvedValue(ok(
      'plugin_tree:\n  tree:\n    - title: root\n      memory_limit: 8Gi\n',
    ));
    mockRun.mockResolvedValue(ok({ workflowId: 9, pluginInstanceIds: [10] }));

    await builtin_pipeline([
      'run', 'MyPipe', '--paramFile', '~/params/run.yaml', '--root.threshold', '0.6',
    ]);

    expect(mockFileContentGet).toHaveBeenCalledWith('/home/me/params/run.yaml');
    expect(mockRun).toHaveBeenCalledWith('MyPipe', 5, {
      globalCompute: undefined,
      parameterFile: {
        plugin_tree: { tree: [{ title: 'root', memory_limit: '8Gi' }] },
      },
      cliBindings: [{ node: 'root', field: 'threshold', value: 0.6 }],
    });
  });

  it('requires a name for source', async () => {
    const result = await builtin_pipeline(['source']);
    expect(mockErrLine).toHaveBeenCalledWith(expect.stringContaining('Usage: pipeline source'));
    expect(process.exitCode).toBe(1);
    expect(result.status).toBe('error');
  });
});
