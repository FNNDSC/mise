/**
 * @file Envelope behavior tests for versioned plugin executables.
 *
 * Mocks plugin resolution and README retrieval while exercising the real
 * executable interceptor, including raw-output byte preservation.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockPluginsList: jest.Mock = jest.fn();
const mockPluginsListAll: jest.Mock = jest.fn();
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  plugins_list: mockPluginsList,
  plugins_listAll: mockPluginsListAll,
}));

const mockReadmeFetch: jest.Mock = jest.fn();
const mockReadmeRender: jest.Mock = jest.fn();
const mockParameters: jest.Mock = jest.fn();
const mockPluginHelp: jest.Mock = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/plugin/readme.js', () => ({
  pluginReadme_fetch: mockReadmeFetch,
  pluginReadme_render: mockReadmeRender,
}));

jest.unstable_mockModule('../src/lib/spinner.js', () => ({
  spinner: { start: jest.fn(), stop: jest.fn() },
}));
jest.unstable_mockModule('../src/builtins/parametersofplugin.js', () => ({
  builtin_parametersofplugin: mockParameters,
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  errorStack: { stack_push: jest.fn() },
  envelope_ok: (rendered: string): { status: 'ok'; rendered: string } => ({ status: 'ok', rendered }),
}));
jest.unstable_mockModule('../src/builtins/help.js', () => ({
  pluginExecutableHelp_render: mockPluginHelp,
}));

const { pluginExecutable_handle } = await import('../src/builtins/executable.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockPluginsList.mockResolvedValue({
    tableData: [{ id: 270, name: 'pl-example', version: '1.2.2' }],
  });
  mockReadmeRender.mockReturnValue('Rendered README');
  mockParameters.mockResolvedValue({ status: 'ok', rendered: 'Parameter table\n' });
  mockPluginHelp.mockReturnValue('Plugin executable help\n');
});

describe('pluginExecutable_handle', () => {
  it('ignores commands without a complete version suffix', async () => {
    await expect(pluginExecutable_handle('pl-example', ['--readme'])).resolves.toBeNull();
    await expect(pluginExecutable_handle('-v1.2.2', ['--readme'])).resolves.toBeNull();
    await expect(pluginExecutable_handle('pl-example-v', ['--readme'])).resolves.toBeNull();
  });

  it('returns plugin-specific help without resolving the plugin', async () => {
    const envelope = await pluginExecutable_handle('pl-example-v1.2.2', ['--help']);

    expect(envelope).toEqual({ status: 'ok', rendered: 'Plugin executable help\n' });
    expect(mockPluginHelp).toHaveBeenCalledWith('pl-example-v1.2.2');
    expect(mockPluginsList).not.toHaveBeenCalled();
  });

  it('returns the original README text alone in raw mode', async () => {
    const content: string = 'Title\n=====\n\nExact source without a final newline';
    mockReadmeFetch.mockResolvedValue({ content, format: 'rst', sourceUrl: 'README.rst' });

    const envelope = await pluginExecutable_handle('pl-example-v1.2.2', ['--readme', '--raw']);

    expect(envelope).toEqual({ status: 'ok', rendered: content });
    expect(mockReadmeRender).not.toHaveBeenCalled();
  });

  it('renders a README for normal terminal output', async () => {
    mockReadmeFetch.mockResolvedValue({ content: 'Source', format: 'md', sourceUrl: 'README.md' });

    const envelope = await pluginExecutable_handle('pl-example-v1.2.2', ['--readme']);

    expect(envelope?.rendered).toContain('Resolving plugin pl-example v1.2.2 for README...');
    expect(envelope?.rendered).toContain('Rendered README\n');
    expect(mockReadmeRender).toHaveBeenCalledWith({
      content: 'Source',
      format: 'md',
      sourceUrl: 'README.md',
    });
  });

  it('resolves and delegates parameter listing', async () => {
    const envelope = await pluginExecutable_handle('pl-example-v1.2.2', ['--parameters']);

    expect(envelope?.rendered).toContain('Resolved Plugin: pl-example v1.2.2 (ID: 270)');
    expect(envelope?.rendered).toContain('Parameter table\n');
    expect(mockParameters).toHaveBeenCalledWith(['list', '--plugin-id', '270']);
  });

  it('leaves a versioned command alone when no supported option is present', async () => {
    await expect(pluginExecutable_handle('pl-example-v1.2.2', [])).resolves.toBeNull();
  });
});
