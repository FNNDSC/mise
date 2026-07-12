import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Minimal cumin surface used by the dispatch layer (Result helpers + error stack).
const Ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const Err = (): { ok: false } => ({ ok: false });
const mockCheckpointDrain = jest.fn((): { type: string; message: string }[] => []);
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
  Ok,
  Err,
  errorStack: {
    stack_pop: jest.fn(() => undefined),
    stack_push: jest.fn(),
    checkpoint_mark: jest.fn(() => 0),
    checkpoint_drain: mockCheckpointDrain,
    scope_run: (fn: () => unknown) => fn(),
  },
}));

// The /bin listing model is type-only at runtime.
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));

// chili delegation target: chiliCommand_run captures via run_capture.
const mockChiliRun = jest.fn(async () => ({ out: '', err: '' }));
jest.unstable_mockModule('@fnndsc/chili/run.js', () => ({ run: jest.fn(), run_capture: mockChiliRun }));

// Session — dispatch only reads the timing toggle.
const mockTiming = jest.fn(() => false);
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { timingEnabled_get: mockTiming },
}));

// VFS — command_dispatch consults /bin for plugin/pipeline names.
const mockDataGet = jest.fn();
jest.unstable_mockModule('../src/lib/vfs/vfs.js', () => ({ vfs: { data_get: mockDataGet } }));

// Built-in command table. Every name is a jest.fn() so COMMAND_HANDLERS is
// fully populated; the ones asserted on are captured by reference.
const mockLs = jest.fn();
const mockWhoami = jest.fn();
const mockPipeline = jest.fn();
const mockUpload = jest.fn();
const BUILTIN_NAMES = [
  'builtin_cd', 'builtin_ls', 'builtin_pwd', 'builtin_connect', 'builtin_logout',
  'builtin_cat', 'builtin_cp', 'builtin_mv', 'builtin_upload', 'builtin_pacs',
  'builtin_pipeline', 'builtin_pull', 'builtin_query', 'builtin_cubepath',
  'builtin_rm', 'builtin_touch', 'builtin_mkdir', 'builtin_plugin', 'builtin_feed',
  'builtin_compute', 'builtin_tag', 'builtin_group', 'builtin_pluginmeta',
  'builtin_plugininstance', 'builtin_workflow', 'builtin_download', 'builtin_edit',
  'builtin_files', 'builtin_links', 'builtin_dirs', 'builtin_context',
  'builtin_parametersofplugin', 'builtin_physicalmode', 'builtin_prompt',
  'builtin_timing', 'builtin_whoami', 'builtin_whereami', 'builtin_version',
  'builtin_debug', 'builtin_help', 'builtin_tree', 'builtin_du', 'builtin_store',
];
jest.unstable_mockModule('../src/builtins/index.js', () => {
  const exports: Record<string, unknown> = {};
  for (const name of BUILTIN_NAMES) exports[name] = jest.fn();
  exports.builtin_ls = mockLs;
  exports.builtin_whoami = mockWhoami;
  exports.builtin_pipeline = mockPipeline;
  exports.builtin_upload = mockUpload;
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

const { command_dispatch, command_dispatchEnvelope, envRefs_expand } = await import('../src/core/dispatch.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
let exitSpy: jest.SpiedFunction<typeof process.exit>;
beforeEach(() => {
  jest.clearAllMocks();
  mockCheckpointDrain.mockReturnValue([]);
  mockHasHelpFlag.mockReturnValue(false);
  mockTiming.mockReturnValue(false);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  exitSpy = jest.spyOn(process, 'exit').mockImplementation(((): never => {
    throw new Error('__exit__');
  }) as never);
});

describe('envRefs_expand', () => {
  it('expands $NAME and ${NAME} forms from the environment', () => {
    process.env.CHELL_TEST_ACC = '999';
    expect(envRefs_expand('AccessionNumber:$CHELL_TEST_ACC')).toBe('AccessionNumber:999');
    expect(envRefs_expand('${CHELL_TEST_ACC}-suffix')).toBe('999-suffix');
    delete process.env.CHELL_TEST_ACC;
  });

  it('expands multiple references in one token', () => {
    process.env.CHELL_TEST_A = 'x';
    process.env.CHELL_TEST_B = 'y';
    expect(envRefs_expand('$CHELL_TEST_A,$CHELL_TEST_B')).toBe('x,y');
    delete process.env.CHELL_TEST_A;
    delete process.env.CHELL_TEST_B;
  });

  it('leaves references to unset variables verbatim', () => {
    delete process.env.CHELL_TEST_UNSET;
    expect(envRefs_expand('$CHELL_TEST_UNSET/tail')).toBe('$CHELL_TEST_UNSET/tail');
    expect(envRefs_expand('plain $ text')).toBe('plain $ text');
  });
});

describe('command_dispatch', () => {
  it('routes a known command to its built-in handler', async () => {
    await command_dispatch('ls', ['-l']);
    expect(mockLs).toHaveBeenCalledWith(['-l']);
    expect(mockChiliRun).not.toHaveBeenCalled();
  });

  it('expands environment references in arguments before dispatch', async () => {
    process.env.CHELL_TEST_DIR = '/home/chris/data with spaces';
    await command_dispatch('ls', ['$CHELL_TEST_DIR', '-l']);
    expect(mockLs).toHaveBeenCalledWith(['/home/chris/data with spaces', '-l']);
    delete process.env.CHELL_TEST_DIR;
  });

  it('runs an exact /bin plugin match via builtin_executePlugin', async () => {
    mockDataGet.mockResolvedValue(Ok([{ name: 'pl-dircopy', type: 'plugin' }]));
    await command_dispatch('pl-dircopy', ['--dir', '/a']);
    expect(mockExecutePlugin).toHaveBeenCalledWith('pl-dircopy', ['--dir', '/a']);
  });

  it('runs a /bin pipeline name as a pipeline run', async () => {
    mockDataGet.mockResolvedValue(Ok([{ name: 'myPipe', type: 'pipeline' }]));
    await command_dispatch('myPipe', ['--compute', 'host']);
    expect(mockPipeline).toHaveBeenCalledWith(['run', 'myPipe', '--compute', 'host']);
  });

  it('routes pipeline --nodes to pipeline info', async () => {
    mockDataGet.mockResolvedValue(Ok([{ name: 'myPipe', type: 'pipeline' }]));
    await command_dispatch('myPipe', ['--nodes']);
    expect(mockPipeline).toHaveBeenCalledWith(['info', 'myPipe']);
  });

  it('routes pipeline --source to pipeline source', async () => {
    mockDataGet.mockResolvedValue(Ok([{ name: 'myPipe', type: 'pipeline' }]));
    await command_dispatch('myPipe', ['--source']);
    expect(mockPipeline).toHaveBeenCalledWith(['source', 'myPipe']);
  });

  it('delegates an unknown command to chili with -s', async () => {
    mockDataGet.mockResolvedValue(Ok([]));
    // The fallback delegates to chili, captures its output through chili's
    // seam, and returns the notice plus that output in the envelope.
    const envelope = await command_dispatchEnvelope('frobnicate', ['x']);
    expect(mockChiliRun).toHaveBeenCalledWith(['frobnicate', '-s', 'x']);
    expect(envelope.rendered).toContain('delegating to chili');
  });

  it('carries the captured chili output in the fallback envelope', async () => {
    mockDataGet.mockResolvedValue(Ok([]));
    mockChiliRun.mockResolvedValueOnce({ out: 'CHILI_SAYS_HI\n', err: '' });
    const envelope = await command_dispatchEnvelope('frobnicate', ['x']);
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('delegating to chili');
    expect(envelope.rendered).toContain('CHILI_SAYS_HI');
    expect(mockChiliRun).toHaveBeenCalledWith(['frobnicate', '-s', 'x']);
  });

  it('yields a placeholder envelope for a direct-run handler', async () => {
    mockDataGet.mockResolvedValue(Ok([{ name: 'pl-x', type: 'plugin' }]));
    mockExecutePlugin.mockResolvedValueOnce(undefined);
    const envelope = await command_dispatchEnvelope('pl-x', []);
    expect(envelope).toEqual({ status: 'ok', rendered: '' });
  });

  it('marks the placeholder envelope as failed when the handler sets a nonzero exit code', async () => {
    const previousExitCode: number | string | undefined = process.exitCode;
    process.exitCode = 0;
    mockDataGet.mockResolvedValue(Ok([{ name: 'pl-x', type: 'plugin' }]));
    mockExecutePlugin.mockImplementationOnce(async () => { process.exitCode = 1; });
    const envelope = await command_dispatchEnvelope('pl-x', []);
    expect(envelope.status).toBe('error');
    process.exitCode = previousExitCode;
  });

  it('drains errorStack messages into the envelope and escalates status', async () => {
    // A command that left an error on the stack but did not change exitCode:
    // the drain still records it and the envelope reads error.
    mockCheckpointDrain.mockReturnValueOnce([{ type: 'error', message: 'boom from ls' }]);
    const envelope = await command_dispatchEnvelope('ls', []);
    expect(envelope.status).toBe('error');
    expect(envelope.errors).toEqual([{ type: 'error', message: 'boom from ls' }]);
  });

  it('attaches drained warnings without escalating status', async () => {
    mockCheckpointDrain.mockReturnValueOnce([{ type: 'warning', message: 'heads up' }]);
    const envelope = await command_dispatchEnvelope('ls', []);
    expect(envelope.status).toBe('ok');
    expect(envelope.errors).toEqual([{ type: 'warning', message: 'heads up' }]);
  });

  it('delegates to chili when the /bin lookup fails', async () => {
    mockDataGet.mockResolvedValue(Err());
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await command_dispatch('frobnicate', []);
    expect(mockChiliRun).toHaveBeenCalledWith(['frobnicate', '-s']);
    writeSpy.mockRestore();
  });

  it('delegates the pacsservers alias to chili', async () => {
    await command_dispatch('pacsservers', ['--query', 'x']);
    expect(mockChiliRun).toHaveBeenCalledWith(['pacsservers', '-s', '--query', 'x']);
  });

  it('delegates the pacsqueries and pacsretrieve aliases to chili', async () => {
    await command_dispatch('pacsqueries', ['a']);
    expect(mockChiliRun).toHaveBeenCalledWith(['pacsqueries', '-s', 'a']);
    await command_dispatch('pacsretrieve', ['b']);
    expect(mockChiliRun).toHaveBeenCalledWith(['pacsretrieve', '-s', 'b']);
  });

  it('exits the process on "exit"', async () => {
    await expect(command_dispatch('exit', [])).rejects.toThrow('__exit__');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

// Line-level orchestration (shell escape, semicolon batching, redirects,
// pipes) is tested through the engine facade in engine.test.ts.
