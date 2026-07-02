import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Real commandArgs_process runs; stub its load-time boundary.
jest.unstable_mockModule('@fnndsc/salsa', () => ({ context_getSingle: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));
jest.unstable_mockModule('@fnndsc/chili/models/plugin.js', () => ({}));
jest.unstable_mockModule('@fnndsc/chili/utils/cli.js', () => ({}));
jest.unstable_mockModule('../src/session/index.js', () => ({ session: {} }));

const mockStackClear = jest.fn();
const mockAllOfType = jest.fn(() => [] as string[]);
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  errorStack: { stack_clear: mockStackClear, allOfType_get: mockAllOfType },
}));

const mockFetchList = jest.fn();
const mockFieldsFetch = jest.fn();
const mockExecute = jest.fn();
const mockAdd = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/plugins/list.js', () => ({ plugins_fetchList: mockFetchList }));
jest.unstable_mockModule('@fnndsc/chili/commands/plugins/fields.js', () => ({ pluginFields_fetch: mockFieldsFetch }));
jest.unstable_mockModule('@fnndsc/chili/commands/plugin/run.js', () => ({ plugin_execute: mockExecute }));
jest.unstable_mockModule('@fnndsc/chili/commands/plugins/add.js', () => ({ plugin_add: mockAdd }));

const mockListRender = jest.fn(() => 'PLUGIN_LIST');
const mockRunRender = jest.fn(() => 'PLUGIN_RUN');
jest.unstable_mockModule('@fnndsc/chili/views/plugin.js', () => ({ pluginList_render: mockListRender, pluginRun_render: mockRunRender }));
const mockTableDisplay = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({ table_display: mockTableDisplay }));

const mockChiliRun = jest.fn();
jest.unstable_mockModule('../src/chell.js', () => ({ chiliCommand_run: mockChiliRun }));
jest.unstable_mockModule('../src/lib/spinner.js', () => ({ spinner: { start: jest.fn(), stop: jest.fn() } }));
jest.unstable_mockModule('@fnndsc/chili/utils/admin_prompt.js', () => ({ adminPrompt_register: jest.fn() }));
jest.unstable_mockModule('../src/core/question.js', () => ({ repl_question: jest.fn(), repl_questionHidden: jest.fn() }));

const { builtin_plugin, plugin_addInteractive } = await import('../src/builtins/res/plugin.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  mockAllOfType.mockReturnValue([]);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('builtin_plugin', () => {
  it('prints usage with no subcommand', async () => {
    await builtin_plugin([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: plugin'));
  });

  it('lists plugins and shows a pagination hint', async () => {
    mockFetchList.mockResolvedValue({ plugins: [{ id: 1 }], selectedFields: ['id'], totalCount: 10 });
    await builtin_plugin(['list']);
    expect(logSpy).toHaveBeenCalledWith('PLUGIN_LIST');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('showing 1 of 10'));
  });

  it('runs a plugin and renders the instance', async () => {
    mockExecute.mockResolvedValue({ id: 5 });
    await builtin_plugin(['run', 'pl-dircopy', '--dir', '/a']);
    expect(mockExecute).toHaveBeenCalledWith('pl-dircopy', '--dir /a');
    expect(logSpy).toHaveBeenCalledWith('PLUGIN_RUN');
  });

  it('requires a plugin name for run', async () => {
    await builtin_plugin(['run']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: plugin run'));
  });

  it('reports a failed run', async () => {
    mockExecute.mockResolvedValue(null);
    await builtin_plugin(['run', 'pl-x']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('execution failed'));
  });

  it('inspects fields via table_display', async () => {
    mockFieldsFetch.mockResolvedValue(['id', 'name']);
    await builtin_plugin(['inspect']);
    expect(mockTableDisplay).toHaveBeenCalled();
  });

  it('notes empty fields on inspect', async () => {
    mockFieldsFetch.mockResolvedValue([]);
    await builtin_plugin(['inspect']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No fields'));
  });

  it('routes search to a filtered list', async () => {
    mockFetchList.mockResolvedValue({ plugins: [], selectedFields: [], totalCount: 0 });
    await builtin_plugin(['search', 'brain']);
    expect(mockFetchList).toHaveBeenCalled();
  });

  it('delegates an unknown subcommand to chili', async () => {
    await builtin_plugin(['frobnicate']);
    expect(mockChiliRun).toHaveBeenCalledWith('plugins', expect.arrayContaining(['-s']));
  });

  it('reports an error from a handler', async () => {
    mockFetchList.mockRejectedValue(new Error('boom'));
    await builtin_plugin(['list']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

describe('plugin_addInteractive', () => {
  it('requires a plugin name', async () => {
    await plugin_addInteractive({ _: ['add'] } as never);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: plugin add'));
  });

  it('reports a successful install', async () => {
    mockAdd.mockResolvedValue('installed');
    await plugin_addInteractive({ _: ['add', 'pl-x'] } as never);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SUCCESS'));
  });

  it('reports an already-registered plugin', async () => {
    mockAdd.mockResolvedValue('already_exists');
    await plugin_addInteractive({ _: ['add', 'pl-x'] } as never);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already registered'));
  });

  it('reports a failure with collected errors and warnings', async () => {
    mockAdd.mockResolvedValue('failed');
    mockAllOfType.mockImplementation((type: string) => type === 'error' ? ['[x] | bad thing'] : ['[y] | heads up']);
    await plugin_addInteractive({ _: ['add', 'pl-x'] } as never);
    expect(process.exitCode).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('FAILED'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('bad thing'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('heads up'));
  });
});
