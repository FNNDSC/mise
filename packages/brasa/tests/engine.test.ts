/**
 * @file Tests for the engine facade: line-level orchestration (shell escape,
 * semicolon batching, redirects, pipes), envelope collection, completion,
 * and engine creation.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Minimal cumin surface used by the dispatch layer (Result helpers + error stack).
const Ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const Err = (): { ok: false } => ({ ok: false });
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
  Ok,
  Err,
  errorStack: {
    stack_pop: jest.fn(() => undefined),
    stack_push: jest.fn(),
    checkpoint_mark: jest.fn(() => 0),
    checkpoint_drain: jest.fn(() => []),
    scope_run: (fn: () => unknown) => fn(),
  },
}));

// The /bin listing model is type-only at runtime.
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));

// chili delegation target.
const mockChiliRun = jest.fn(async () => ({ out: '', err: '' }));
const mockCommandNames = jest.fn(async () => new Set<string>(['frobnicate']));
jest.unstable_mockModule('@fnndsc/chili/run.js', () => ({ run: jest.fn(), run_capture: mockChiliRun, commandNames_get: mockCommandNames }));

// Session — the engine reads the timing toggle and initializes on creation.
const mockTiming = jest.fn(() => false);
const mockSessionInit = jest.fn(async () => undefined);
const mockPhysicalMode = jest.fn(() => false);
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: {
    timingEnabled_get: mockTiming,
    init: mockSessionInit,
    physicalMode_get: mockPhysicalMode,
  },
}));

// Watches: the engine facade delegates to the sampler registry.
const mockWatchAdd = jest.fn((): string => 'live');
const mockWatchRemove = jest.fn();
const mockWatchRelease = jest.fn();
const mockWatchState = jest.fn((): string => 'settled');
jest.unstable_mockModule('../src/builtins/procWatch.js', () => ({
  procWatch_add: mockWatchAdd,
  procWatch_remove: mockWatchRemove,
  procWatch_release: mockWatchRelease,
  procWatch_state: mockWatchState,
  watchSubject_parse: (subject: string): number | null => (/feed_(\d+)$/.exec(subject) ? Number(/feed_(\d+)$/.exec(subject)![1]) : null),
}));

// Redirect targets: real preprocess resolves the path (statSync), dispatch writes it.
const mockWriteFile = jest.fn();
const mockAppendFile = jest.fn();
const enoent = (): never => { const e: NodeJS.ErrnoException = new Error('nope'); e.code = 'ENOENT'; throw e; };
const mockStatSync = jest.fn(enoent);
jest.unstable_mockModule('fs', () => ({
  statSync: mockStatSync,
  writeFileSync: mockWriteFile,
  appendFileSync: mockAppendFile,
}));

// VFS — command dispatch consults /bin for plugin/pipeline names.
const mockDataGet = jest.fn();
jest.unstable_mockModule('../src/lib/vfs/vfs.js', () => ({ vfs: { data_get: mockDataGet } }));

// Built-in command table. Every name is a jest.fn() so COMMAND_HANDLERS is
// fully populated; the ones asserted on are captured by reference.
const mockLs = jest.fn();
const mockWhoami = jest.fn();
const mockPipeline = jest.fn();
const BUILTIN_NAMES = [
  'builtin_config', 'builtin_cd', 'builtin_ls', 'builtin_pwd', 'builtin_connect', 'builtin_logout',
  'builtin_cat', 'builtin_cp', 'builtin_mv', 'builtin_upload', 'builtin_pacs',
  'builtin_pipeline', 'builtin_pull', 'builtin_query', 'builtin_cubepath',
  'builtin_rm', 'builtin_touch', 'builtin_mkdir', 'builtin_plugin', 'builtin_feed',
  'builtin_compute', 'builtin_tag', 'builtin_group', 'builtin_user', 'builtin_pluginmeta',
  'builtin_plugininstance', 'builtin_workflow', 'builtin_download', 'builtin_edit',
  'builtin_files', 'builtin_links', 'builtin_dirs', 'builtin_context',
  'builtin_parametersofplugin', 'builtin_physicalmode', 'builtin_prompt',
  'builtin_timing', 'builtin_id', 'builtin_whoami', 'builtin_whereami', 'builtin_version', 'builtin_fortune', 'builtin_date', 'builtin_cal',
  'builtin_debug', 'builtin_help', 'builtin_tree', 'builtin_du', 'builtin_store',
];
jest.unstable_mockModule('../src/builtins/index.js', () => {
  const exports: Record<string, unknown> = {};
  for (const name of BUILTIN_NAMES) exports[name] = jest.fn();
  exports.builtin_ls = mockLs;
  exports.builtin_whoami = mockWhoami;
  exports.builtin_pipeline = mockPipeline;
  exports.error_stripDebugPrefix = (s: string): string => s;
  return exports;
});

const mockExecutePlugin = jest.fn();
jest.unstable_mockModule('../src/builtins/pluginExecute.js', () => ({ builtin_executePlugin: mockExecutePlugin }));
jest.unstable_mockModule('../src/builtins/proc.js', () => ({ builtin_proc: jest.fn() }));
jest.unstable_mockModule('../src/builtins/wildcard.js', () => ({ shellWords_expand: jest.fn(async (words) => Ok(words)) }));

const mockHelpRender = jest.fn((cmd: string) => `HELP:${cmd}\n`);
const mockHasHelpFlag = jest.fn(() => false);
jest.unstable_mockModule('../src/builtins/help.js', () => ({
  help_render: mockHelpRender,
  commandHelp_get: jest.fn(() => 'known help'),
  pipelineExecutableHelp_render: jest.fn((name: string): string => `PIPELINE HELP:${name}\n`),
  args_checkHasHelpFlag: mockHasHelpFlag,
}));

const mockPluginExecutable = jest.fn(async () => false);
jest.unstable_mockModule('../src/builtins/executable.js', () => ({ pluginExecutable_handle: mockPluginExecutable }));
jest.unstable_mockModule('../src/core/elevation.js', () => ({
  sudoCommand_run: jest.fn(async (): Promise<{ status: string; rendered: string }> => ({ status: 'ok', rendered: '' })),
}));

// Pipe segments now run through the active surface; the test installs a
// surface whose pipeSegment delegates to this mock.
const mockSegmentPipe = jest.fn();
const mockShellCommand = jest.fn(async (_command: string): Promise<number> => 0);
jest.unstable_mockModule('../src/lib/pipe.js', () => ({ segment_pipeThrough: mockSegmentPipe }));

// Engine creation registers the static VFS providers on the salsa dispatcher.
const mockProviderRegister = jest.fn();
const mockPathResolverRegister = jest.fn();
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  vfsDispatcher: {
    provider_register: mockProviderRegister,
    pathResolver_register: mockPathResolverRegister,
  },
}));
class FakeStaticProvider { constructor(public readonly root: string) {} }
jest.unstable_mockModule('../src/lib/vfs/providers/static.js', () => ({ StaticVfsProvider: FakeStaticProvider }));

// Completion delegates to the callback-style completer.
type CompleterCallback = (err: Error | null, result: [string[], string]) => void;
const mockInputComplete = jest.fn((line: string, callback: CompleterCallback): void => {
  callback(null, [['ls', 'logout'], line]);
});
jest.unstable_mockModule('../src/lib/completer/index.js', () => ({ input_complete: mockInputComplete }));

const {
  line_execute,
  line_complete,
  command_handle,
  engine_create,
  stopOnError_set,
} = await import('../src/core/engine.js');
const { surface_set } = await import('../src/core/surface.js');
const { BufferSink, CaptureSink, sink_set } = await import('../src/core/sink.js');

let output: InstanceType<typeof CaptureSink>;
beforeEach(() => {
  jest.clearAllMocks();
  mockHasHelpFlag.mockReturnValue(false);
  mockTiming.mockReturnValue(false);
  mockStatSync.mockImplementation(enoent);
  // Install a surface that can run local process capabilities, delegating to mocks.
  surface_set({
    capabilities: {
      hiddenInput: false,
      localEdit: false,
      tty: false,
      pipeSegments: true,
      shellCommands: true,
    },
    prompt: async (): Promise<string> => '',
    pipeSegment: (command: string, input: Buffer): Promise<Buffer> => mockSegmentPipe(command, input) as Promise<Buffer>,
    shellCommand: (command: string): Promise<number> => mockShellCommand(command),
    localEdit: async (r: { content: string }): Promise<{ content: string; changed: boolean }> => ({ content: r.content, changed: false }),
  });
  output = new CaptureSink(new BufferSink());
  sink_set(output);
});

describe('line_execute', () => {
  it('ignores a blank line and returns no envelopes', async () => {
    const envelopes = await line_execute('   ');
    expect(envelopes).toEqual([]);
    expect(mockLs).not.toHaveBeenCalled();
    expect(mockChiliRun).not.toHaveBeenCalled();
  });

  it('dispatches a plain command end-to-end and returns one envelope', async () => {
    const envelopes = await line_execute('whoami');
    expect(mockWhoami).toHaveBeenCalledWith([]);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].status).toBe('ok');
  });

  it('short-circuits on a --help flag, returning the help envelope without dispatching', async () => {
    mockHasHelpFlag.mockReturnValue(true);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const envelopes = await line_execute('ls --help');
    expect(mockHelpRender).toHaveBeenCalledWith('ls');
    expect(mockLs).not.toHaveBeenCalled();
    expect(envelopes).toEqual([{ status: 'ok', rendered: 'HELP:ls\n' }]);
    writeSpy.mockRestore();
  });

  it('runs each command in a semicolon-separated list, one envelope per segment', async () => {
    const envelopes = await line_execute('whoami; whoami');
    expect(mockWhoami).toHaveBeenCalledTimes(2);
    expect(envelopes).toHaveLength(2);
  });

  it('captures the first segment and pipes it through the rest', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockSegmentPipe.mockResolvedValue(Buffer.from('piped'));
    const envelopes = await line_execute('whoami | grep foo');
    expect(mockWhoami).toHaveBeenCalled();
    expect(mockSegmentPipe).toHaveBeenCalledWith('grep foo', expect.any(Buffer));
    expect(envelopes).toEqual([{ status: 'ok', rendered: 'piped' }]);
    writeSpy.mockRestore();
  });

  it('pipes SignalFlow YAML from a pipeline executable alias', async () => {
    mockDataGet.mockResolvedValue(Ok([{ name: 'myPipe', type: 'pipeline' }]));
    mockPipeline.mockResolvedValue({ status: 'ok', rendered: 'pipeline: myPipe\n' });
    mockSegmentPipe.mockImplementation(async (_command: string, input: Buffer): Promise<Buffer> => input);

    const envelopes = await line_execute('myPipe --signalflow | signalflow -');

    expect(mockPipeline).toHaveBeenCalledWith(['diagram', 'myPipe', '--signalflow']);
    expect(mockSegmentPipe).toHaveBeenCalledWith('signalflow -', Buffer.from('pipeline: myPipe\n'));
    expect(envelopes).toEqual([{ status: 'ok', rendered: 'pipeline: myPipe\n' }]);
  });

  it('keeps output redirection in the final local pipe segment', async () => {
    mockDataGet.mockResolvedValue(Ok([{ name: 'myPipe', type: 'pipeline' }]));
    mockPipeline.mockResolvedValue({ status: 'ok', rendered: 'pipeline: myPipe\n' });
    mockSegmentPipe.mockResolvedValue(Buffer.alloc(0));

    const envelopes = await line_execute('myPipe --signalflow | signalflow - > ~/tmp/pipeline.txt');

    expect(mockPipeline).toHaveBeenCalledWith(['diagram', 'myPipe', '--signalflow']);
    expect(mockSegmentPipe).toHaveBeenCalledWith(
      'signalflow - > ~/tmp/pipeline.txt',
      Buffer.from('pipeline: myPipe\n'),
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(envelopes).toEqual([{ status: 'ok', rendered: '' }]);
  });

  it('delegates an unknown piped command to chili during capture', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockSegmentPipe.mockResolvedValue(Buffer.from(''));
    await line_execute('frobnicate | grep foo');
    expect(mockChiliRun).toHaveBeenCalledWith(['frobnicate', '-s']);
    writeSpy.mockRestore();
  });

  it('fails a pipeline clearly when the surface cannot run segments', async () => {
    surface_set({
      capabilities: {
        hiddenInput: false,
        localEdit: false,
        tty: false,
        pipeSegments: false,
        shellCommands: false,
      },
      prompt: async (): Promise<string> => '',
      pipeSegment: (_c: string, i: Buffer): Promise<Buffer> => Promise.resolve(i),
      shellCommand: async (): Promise<number> => 0,
      localEdit: async (r: { content: string }): Promise<{ content: string; changed: boolean }> => ({ content: r.content, changed: false }),
    });
    const envelopes = await line_execute('whoami | grep foo');
    expect(output.errText_get()).toContain('cannot run pipeline segments');
    expect(envelopes).toEqual([{ status: 'error', rendered: '' }]);
    expect(mockSegmentPipe).not.toHaveBeenCalled();
  });

  it('yields an error envelope when a pipe segment fails', async () => {
    mockSegmentPipe.mockRejectedValue(new Error('broken pipe'));
    const envelopes = await line_execute('whoami | grep foo');
    expect(output.errText_get()).toContain('broken pipe');
    expect(envelopes).toEqual([{ status: 'error', rendered: '' }]);
  });

  it('prints elapsed time when timing is enabled', async () => {
    mockTiming.mockReturnValue(true);
    await line_execute('whoami');
    expect(mockWhoami).toHaveBeenCalled();
    expect(output.dataText_get()).toContain('ms');
  });
});

describe('shell escape', () => {
  it('delegates a !-prefixed command to the active surface', async () => {
    const envelopes = await line_execute('!echo hi');
    expect(mockShellCommand).toHaveBeenCalledWith('echo hi');
    expect(envelopes).toEqual([{ status: 'ok', rendered: '' }]);
  });

  it('reports a non-zero host exit code as an error envelope', async () => {
    mockShellCommand.mockResolvedValueOnce(3);
    const envelopes = await line_execute('!false');
    expect(envelopes).toEqual([{ status: 'error', rendered: '' }]);
  });

  it('reports a surface shell failure in the returned envelope', async () => {
    mockShellCommand.mockRejectedValueOnce(new Error('nope'));
    const envelopes = await line_execute('!badcmd');
    expect(envelopes).toEqual([{
      status: 'error',
      rendered: '',
      renderedErr: expect.stringContaining('nope'),
    }]);
  });

  it('ignores a bare "!" with no command', async () => {
    const envelopes = await line_execute('!');
    expect(mockShellCommand).not.toHaveBeenCalled();
    expect(envelopes).toEqual([]);
  });
});

describe('output redirection', () => {
  it('writes captured output to the target with >', async () => {
    const envelopes = await line_execute('whoami > out.txt');
    expect(mockWhoami).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith('out.txt', expect.any(Buffer));
    expect(envelopes).toEqual([{ status: 'ok', rendered: '' }]);
  });

  it('appends captured output with >>', async () => {
    await line_execute('whoami >> out.txt');
    expect(mockAppendFile).toHaveBeenCalledWith('out.txt', expect.any(Buffer));
  });

  it('errors and skips the write when the target is a directory', async () => {
    mockStatSync.mockReturnValue({ isDirectory: () => true } as unknown as ReturnType<typeof mockStatSync>);
    const envelopes = await line_execute('whoami > somedir');
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(output.errText_get()).not.toBe('');
    expect(envelopes).toEqual([{ status: 'error', rendered: '' }]);
  });
});

describe('line_execute — control flow', () => {
  it('short-circuits when a simulated plugin handles the command', async () => {
    mockPluginExecutable.mockResolvedValueOnce({ status: 'ok', rendered: 'PLUGIN OUTPUT\n' });
    const envelopes = await line_execute('whoami');
    expect(mockPluginExecutable).toHaveBeenCalledWith('whoami', []);
    expect(mockWhoami).not.toHaveBeenCalled();
    expect(envelopes).toEqual([{ status: 'ok', rendered: 'PLUGIN OUTPUT\n' }]);
  });

  it('aborts a semicolon batch on error when stop-on-error is set', async () => {
    mockWhoami.mockRejectedValueOnce(new Error('boom'));
    stopOnError_set(true);
    const envelopes = await line_execute('whoami; whoami');
    // First segment throws and aborts; the second never runs.
    expect(mockWhoami).toHaveBeenCalledTimes(1);
    expect(output.errText_get()).toContain('boom');
    expect(envelopes).toEqual([{ status: 'error', rendered: '' }]);
    stopOnError_set(false);
  });

  it('continues a semicolon batch past an error when stop-on-error is unset', async () => {
    mockWhoami.mockRejectedValueOnce(new Error('boom'));
    const envelopes = await line_execute('whoami; whoami');
    expect(mockWhoami).toHaveBeenCalledTimes(2);
    expect(envelopes).toHaveLength(2);
    expect(envelopes[0].status).toBe('error');
    expect(envelopes[1].status).toBe('ok');
  });
});

describe('command_handle', () => {
  it('executes a line without exposing envelopes', async () => {
    await command_handle('whoami');
    expect(mockWhoami).toHaveBeenCalledWith([]);
  });
});

describe('line_complete', () => {
  it('resolves the completer callback into candidates and prefix', async () => {
    const result = await line_complete('l');
    expect(mockInputComplete).toHaveBeenCalledWith('l', expect.any(Function));
    expect(result).toEqual({ candidates: ['ls', 'logout'], prefix: 'l' });
  });

  it('resolves to no candidates when the completer reports an error', async () => {
    mockInputComplete.mockImplementationOnce((_line: string, callback: CompleterCallback): void => {
      callback(new Error('boom'), [[], '']);
    });
    const result = await line_complete('l');
    expect(result).toEqual({ candidates: [], prefix: 'l' });
  });
});

describe('engine_create', () => {
  it('initializes the session, registers VFS providers, and returns the facade', async () => {
    const engine = await engine_create();
    expect(mockSessionInit).toHaveBeenCalledTimes(1);
    expect(mockProviderRegister).toHaveBeenCalledTimes(3);
    expect(mockPathResolverRegister).toHaveBeenCalledTimes(1);
    const roots: string[] = mockProviderRegister.mock.calls.map(
      (call: unknown[]) => (call[0] as FakeStaticProvider).root,
    );
    expect(roots).toEqual(['/bin', '/usr', '/usr/bin']);

    const envelopes = await engine.line_execute('whoami');
    expect(envelopes).toHaveLength(1);
    const completion = await engine.line_complete('l');
    expect(completion.candidates).toContain('ls');
  });

  it('exposes watches on the facade: open, release one, release an owner, refuse a non-feed', async () => {
    const engine = await engine_create();
    expect(engine.watch_set!('/proc/jobs/feed_7', 'pane-a', true)).toBe('live');
    expect(mockWatchAdd).toHaveBeenCalledWith(7, 'pane-a');
    expect(engine.watch_set!('/proc/jobs/feed_7', 'pane-a', false)).toBe('settled');
    expect(mockWatchRemove).toHaveBeenCalledWith(7, 'pane-a');
    expect(engine.watch_set!('/vfs/home', 'pane-a', true)).toBeNull();
    engine.watch_release!('pane-a');
    expect(mockWatchRelease).toHaveBeenCalledWith('pane-a');
    const stop: () => void = engine.ambient_listen!((): void => undefined);
    expect(typeof stop).toBe('function');
    stop();
  });
});
