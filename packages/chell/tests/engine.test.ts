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
const mockChiliRun = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/run.js', () => ({ run: mockChiliRun }));

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

// Host shell escape (`!cmd`) spawns a child process; drive its lifecycle events.
type SpawnHandlers = Record<string, (arg?: unknown) => void>;
let spawnBehavior: (h: SpawnHandlers) => void = (h) => h.close?.(0);
const mockSpawn = jest.fn(() => {
  const handlers: SpawnHandlers = {};
  const child = { on: (ev: string, cb: (arg?: unknown) => void) => { handlers[ev] = cb; return child; } };
  Promise.resolve().then(() => spawnBehavior(handlers));
  return child;
});
jest.unstable_mockModule('child_process', () => ({ spawn: mockSpawn }));

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
  'builtin_cd', 'builtin_ls', 'builtin_pwd', 'builtin_connect', 'builtin_logout',
  'builtin_cat', 'builtin_cp', 'builtin_mv', 'builtin_upload', 'builtin_pacs',
  'builtin_pipeline', 'builtin_pull', 'builtin_query', 'builtin_cubepath',
  'builtin_rm', 'builtin_touch', 'builtin_mkdir', 'builtin_plugin', 'builtin_feed',
  'builtin_compute', 'builtin_tag', 'builtin_group', 'builtin_pluginmeta',
  'builtin_plugininstance', 'builtin_workflow', 'builtin_download', 'builtin_edit',
  'builtin_files', 'builtin_links', 'builtin_dirs', 'builtin_context',
  'builtin_parametersofplugin', 'builtin_physicalmode', 'builtin_prompt',
  'builtin_timing', 'builtin_whoami', 'builtin_whereami', 'builtin_debug',
  'builtin_help', 'builtin_tree', 'builtin_du', 'builtin_store',
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
jest.unstable_mockModule('../src/builtins/wildcard.js', () => ({ wildcards_expandAll: jest.fn(async (a: string[]) => Ok(a)) }));

const mockHelpShow = jest.fn();
const mockHasHelpFlag = jest.fn(() => false);
jest.unstable_mockModule('../src/builtins/help.js', () => ({ help_show: mockHelpShow, args_checkHasHelpFlag: mockHasHelpFlag }));

const mockPluginExecutable = jest.fn(async () => false);
jest.unstable_mockModule('../src/builtins/executable.js', () => ({ pluginExecutable_handle: mockPluginExecutable }));

// Pipe segments now run through the active surface; the test installs a
// surface whose pipeSegment delegates to this mock.
const mockSegmentPipe = jest.fn();
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

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  mockHasHelpFlag.mockReturnValue(false);
  mockTiming.mockReturnValue(false);
  mockStatSync.mockImplementation(enoent);
  spawnBehavior = (h) => h.close?.(0);
  // Install a surface that can run pipe segments, delegating to the mock.
  surface_set({
    capabilities: { hiddenInput: false, localEdit: false, tty: false, pipeSegments: true },
    prompt: async (): Promise<string> => '',
    pipeSegment: (command: string, input: Buffer): Promise<Buffer> => mockSegmentPipe(command, input) as Promise<Buffer>,
    localEdit: async (r: { content: string }): Promise<{ content: string; changed: boolean }> => ({ content: r.content, changed: false }),
  });
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
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

  it('short-circuits on a --help flag without dispatching', async () => {
    mockHasHelpFlag.mockReturnValue(true);
    const envelopes = await line_execute('ls --help');
    expect(mockHelpShow).toHaveBeenCalledWith('ls');
    expect(mockLs).not.toHaveBeenCalled();
    expect(envelopes).toEqual([{ status: 'ok', rendered: '' }]);
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

  it('delegates an unknown piped command to chili during capture', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockSegmentPipe.mockResolvedValue(Buffer.from(''));
    await line_execute('frobnicate | grep foo');
    expect(mockChiliRun).toHaveBeenCalledWith(['frobnicate', '-s']);
    writeSpy.mockRestore();
  });

  it('fails a pipeline clearly when the surface cannot run segments', async () => {
    surface_set({
      capabilities: { hiddenInput: false, localEdit: false, tty: false, pipeSegments: false },
      prompt: async (): Promise<string> => '',
      pipeSegment: (_c: string, i: Buffer): Promise<Buffer> => Promise.resolve(i),
    });
    const envelopes = await line_execute('whoami | grep foo');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('cannot run pipeline segments'));
    expect(envelopes).toEqual([{ status: 'error', rendered: '' }]);
    expect(mockSegmentPipe).not.toHaveBeenCalled();
  });

  it('yields an error envelope when a pipe segment fails', async () => {
    mockSegmentPipe.mockRejectedValue(new Error('broken pipe'));
    const envelopes = await line_execute('whoami | grep foo');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('broken pipe'));
    expect(envelopes).toEqual([{ status: 'error', rendered: '' }]);
  });

  it('prints elapsed time when timing is enabled', async () => {
    mockTiming.mockReturnValue(true);
    await line_execute('whoami');
    expect(mockWhoami).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ms'));
  });
});

describe('shell escape', () => {
  it('runs a !-prefixed command on the host shell', async () => {
    const envelopes = await line_execute('!echo hi');
    expect(mockSpawn).toHaveBeenCalledWith('echo hi', expect.objectContaining({ shell: true }));
    expect(envelopes).toEqual([{ status: 'ok', rendered: '' }]);
  });

  it('reports a non-zero host exit code as an error envelope', async () => {
    spawnBehavior = (h) => h.close?.(3);
    const envelopes = await line_execute('!false');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('exited with code 3'));
    expect(envelopes).toEqual([{ status: 'error', rendered: '' }]);
  });

  it('reports a spawn error', async () => {
    spawnBehavior = (h) => h.error?.(new Error('nope'));
    const envelopes = await line_execute('!badcmd');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('nope'));
    expect(envelopes).toEqual([{ status: 'error', rendered: '' }]);
  });

  it('ignores a bare "!" with no command', async () => {
    const envelopes = await line_execute('!');
    expect(mockSpawn).not.toHaveBeenCalled();
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
    expect(errSpy).toHaveBeenCalled();
    expect(envelopes).toEqual([{ status: 'error', rendered: '' }]);
  });
});

describe('line_execute — control flow', () => {
  it('short-circuits when a simulated plugin handles the command', async () => {
    mockPluginExecutable.mockResolvedValueOnce(true);
    const envelopes = await line_execute('whoami');
    expect(mockPluginExecutable).toHaveBeenCalledWith('whoami', []);
    expect(mockWhoami).not.toHaveBeenCalled();
    expect(envelopes).toEqual([{ status: 'ok', rendered: '' }]);
  });

  it('aborts a semicolon batch on error when stop-on-error is set', async () => {
    mockWhoami.mockRejectedValueOnce(new Error('boom'));
    stopOnError_set(true);
    const envelopes = await line_execute('whoami; whoami');
    // First segment throws and aborts; the second never runs.
    expect(mockWhoami).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
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
});
