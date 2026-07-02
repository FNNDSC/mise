import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Minimal cumin surface used by the dispatch layer (Result helpers + error stack).
const Ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const Err = (): { ok: false } => ({ ok: false });
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  Ok,
  Err,
  errorStack: { stack_pop: jest.fn(() => undefined) },
}));

// The /bin listing model is type-only at runtime.
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));

// chili delegation target.
const mockChiliRun = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/run.js', () => ({ run: mockChiliRun }));

// Session — dispatch only reads the timing toggle.
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { timingEnabled_get: jest.fn(() => false) },
}));

// VFS — command_dispatch consults /bin for plugin/pipeline names.
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

const mockSegmentPipe = jest.fn();
jest.unstable_mockModule('../src/lib/pipe.js', () => ({ segment_pipeThrough: mockSegmentPipe }));

const { command_dispatch, command_handle } = await import('../src/core/dispatch.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let exitSpy: jest.SpiedFunction<typeof process.exit>;
beforeEach(() => {
  jest.clearAllMocks();
  mockHasHelpFlag.mockReturnValue(false);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  exitSpy = jest.spyOn(process, 'exit').mockImplementation(((): never => {
    throw new Error('__exit__');
  }) as never);
});

describe('command_dispatch', () => {
  it('routes a known command to its built-in handler', async () => {
    await command_dispatch('ls', ['-l']);
    expect(mockLs).toHaveBeenCalledWith(['-l']);
    expect(mockChiliRun).not.toHaveBeenCalled();
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
    await command_dispatch('frobnicate', ['x']);
    expect(mockChiliRun).toHaveBeenCalledWith(['frobnicate', '-s', 'x']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('delegating to chili'));
  });

  it('delegates to chili when the /bin lookup fails', async () => {
    mockDataGet.mockResolvedValue(Err());
    await command_dispatch('frobnicate', []);
    expect(mockChiliRun).toHaveBeenCalledWith(['frobnicate', '-s']);
  });

  it('delegates the pacsservers alias to chili', async () => {
    await command_dispatch('pacsservers', ['--query', 'x']);
    expect(mockChiliRun).toHaveBeenCalledWith(['pacsservers', '-s', '--query', 'x']);
  });

  it('exits the process on "exit"', async () => {
    await expect(command_dispatch('exit', [])).rejects.toThrow('__exit__');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

describe('command_handle', () => {
  it('ignores a blank line', async () => {
    await command_handle('   ');
    expect(mockLs).not.toHaveBeenCalled();
    expect(mockChiliRun).not.toHaveBeenCalled();
  });

  it('dispatches a plain command end-to-end', async () => {
    await command_handle('whoami');
    expect(mockWhoami).toHaveBeenCalledWith([]);
  });

  it('short-circuits on a --help flag without dispatching', async () => {
    mockHasHelpFlag.mockReturnValue(true);
    await command_handle('ls --help');
    expect(mockHelpShow).toHaveBeenCalledWith('ls');
    expect(mockLs).not.toHaveBeenCalled();
  });

  it('runs each command in a semicolon-separated list', async () => {
    await command_handle('whoami; whoami');
    expect(mockWhoami).toHaveBeenCalledTimes(2);
  });

  it('captures the first segment and pipes it through the rest', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockSegmentPipe.mockResolvedValue(Buffer.from('piped'));
    await command_handle('whoami | grep foo');
    expect(mockWhoami).toHaveBeenCalled();
    expect(mockSegmentPipe).toHaveBeenCalledWith('grep foo', expect.any(Buffer));
    writeSpy.mockRestore();
  });

  it('delegates an unknown piped command to chili during capture', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockSegmentPipe.mockResolvedValue(Buffer.from(''));
    await command_handle('frobnicate | grep foo');
    expect(mockChiliRun).toHaveBeenCalledWith(['frobnicate', '-s']);
    writeSpy.mockRestore();
  });
});
