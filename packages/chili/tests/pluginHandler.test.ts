/**
 * Tests for PluginGroupHandler / PluginMemberHandler. Command modules, ui and
 * screen are mocked; controller methods are spied; Searchable is real.
 */
const mockOverview = jest.fn();
const mockFields = jest.fn();
const mockSearchByTerm = jest.fn();
const mockDeleteById = jest.fn();
const mockAdd = jest.fn();
const mockExecute = jest.fn();
const mockIdsResolve = jest.fn();
const mockReadmeFetch = jest.fn();
const mockReadmeRender = jest.fn((s: string) => s);
const mockConfirm = jest.fn();
const mockTableDisplay = jest.fn();

jest.mock('../src/commands/plugins/overview', () => ({ pluginsOverview_display: mockOverview }));
jest.mock('../src/commands/plugins/fields', () => ({ pluginFields_fetch: mockFields }));
jest.mock('../src/commands/plugins/delete', () => ({ plugins_searchByTerm: mockSearchByTerm, plugin_deleteById: mockDeleteById }));
jest.mock('../src/commands/plugins/add', () => ({ plugin_add: mockAdd }));
jest.mock('../src/commands/plugin/run', () => ({ plugin_execute: mockExecute }));
jest.mock('../src/commands/plugin/search', () => ({ pluginIds_resolve: mockIdsResolve }));
jest.mock('../src/commands/plugin/readme', () => ({ pluginReadme_fetch: mockReadmeFetch, pluginReadme_render: mockReadmeRender }));
jest.mock('../src/utils/ui', () => ({ prompt_confirm: mockConfirm }));
jest.mock('../src/screen/screen', () => ({ table_display: mockTableDisplay }));

import { Command } from 'commander';
import { PluginGroupHandler, PluginMemberHandler } from '../src/plugins/pluginHandler';
import { PluginController } from '../src/controllers/pluginController';

let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('PluginGroupHandler', () => {
  it('plugins_overview + plugins_add delegate', async () => {
    const h = new PluginGroupHandler();
    await h.plugins_overview();
    expect(mockOverview).toHaveBeenCalled();
    await h.plugins_add('fnndsc/pl-x', { compute: 'host' });
    expect(mockAdd).toHaveBeenCalledWith('fnndsc/pl-x', { compute: 'host' });
  });

  it('plugins_fields displays or notes empty', async () => {
    mockFields.mockResolvedValue(['id']);
    await new PluginGroupHandler().plugins_fields();
    expect(mockTableDisplay).toHaveBeenCalledWith(['id'], ['fields']);
    mockFields.mockResolvedValue([]);
    await new PluginGroupHandler().plugins_fields();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No resource fields'));
  });

  it('plugins_delete deletes with force, skips on decline, notes empty', async () => {
    mockSearchByTerm.mockResolvedValue([{ id: 7, name: 'pl', version: '1' }]);
    mockDeleteById.mockResolvedValue(true);
    await new PluginGroupHandler().plugins_delete('id:7', { force: true });
    expect(mockDeleteById).toHaveBeenCalledWith(7);

    mockConfirm.mockResolvedValue(false);
    await new PluginGroupHandler().plugins_delete('id:7', {});
    expect(mockDeleteById).toHaveBeenCalledTimes(1); // not called again

    mockSearchByTerm.mockResolvedValue([]);
    await new PluginGroupHandler().plugins_delete('id:9', {});
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No plugins found matching'));
  });

  it('registers group subcommands', () => {
    const program = new Command();
    new PluginGroupHandler().pluginGroupCommand_setup(program);
    const plugins = program.commands.find((c) => c.name() === 'plugins');
    expect(plugins?.commands.map((c) => c.name())).toEqual(expect.arrayContaining(['list', 'fieldslist', 'delete', 'overview', 'add']));
  });
});

describe('PluginMemberHandler', () => {
  it('readme_print renders content or notes not-found', async () => {
    const document = { content: 'README', format: 'markdown', sourceUrl: 'http://r/raw/main/README.md' } as const;
    const fetchSpy = jest.spyOn(PluginController.prototype, 'readmeDocument_fetch').mockResolvedValue(document);
    await new PluginMemberHandler().readme_print('http://r');
    expect(mockReadmeRender).toHaveBeenCalledWith(document);
    fetchSpy.mockResolvedValue(null);
    await new PluginMemberHandler().readme_print('http://r');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('README not found'));
  });

  it('plugin_readme fetches and renders the format-aware document', async () => {
    const document = { content: 'README', format: 'markdown', sourceUrl: 'http://repo/README.md' };
    mockReadmeFetch.mockResolvedValue(document);
    expect(await new PluginMemberHandler().plugin_readme('5')).toBe(document.sourceUrl);
    expect(mockReadmeRender).toHaveBeenCalledWith(document);

    mockReadmeFetch.mockResolvedValue(null);
    expect(await new PluginMemberHandler().plugin_readme('5')).toBeNull();

    mockReadmeFetch.mockRejectedValue(new Error('boom'));
    expect(await new PluginMemberHandler().plugin_readme('5')).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('plugin_run renders the instance, or reports failure', async () => {
    mockExecute.mockResolvedValue({ id: 99, status: 'scheduled' });
    expect(await new PluginMemberHandler().plugin_run('pl-x', '--a 1')).toBe(99);

    mockExecute.mockResolvedValue(null);
    expect(await new PluginMemberHandler().plugin_run('pl-x', '')).toBeNull();

    mockExecute.mockRejectedValue(new Error('run failed'));
    expect(await new PluginMemberHandler().plugin_run('pl-x', '')).toBeNull();
    expect(errSpy).toHaveBeenCalledWith('run failed');
  });

  it('plugin_searchableToIDs returns hits, or null', async () => {
    mockIdsResolve.mockResolvedValue(['1', '2']);
    expect(await new PluginMemberHandler().plugin_searchableToIDs('pl')).toEqual(['1', '2']);
    mockIdsResolve.mockResolvedValue(null);
    expect(await new PluginMemberHandler().plugin_searchableToIDs('pl')).toBeNull();
  });

  it('pluginID_fromSearch delegates to the controller', async () => {
    jest.spyOn(PluginController.prototype, 'pluginID_fromSearch').mockResolvedValue('7');
    expect(await new PluginMemberHandler().pluginID_fromSearch({ name: 'pl' })).toBe('7');
  });

  it('registers member subcommands', () => {
    const program = new Command();
    new PluginMemberHandler().pluginCommand_setup(program);
    const plugin = program.commands.find((c) => c.name() === 'plugin');
    expect(plugin?.commands.map((c) => c.name())).toEqual(expect.arrayContaining(['readme', 'run', 'search']));
  });
});
