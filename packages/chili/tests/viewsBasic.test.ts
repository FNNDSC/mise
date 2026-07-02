/**
 * View-layer tests for plugin and connect renderers (pure formatting).
 * chalk is auto-mocked (colors stripped, text kept); screen is stubbed.
 */
jest.mock('../src/screen/screen', () => ({
  screen: { table_output: jest.fn(() => 'TABLE_OUTPUT') },
}));

import { pluginRun_render, pluginList_render } from '../src/views/plugin';
import { login_render, logout_render } from '../src/views/connect';
import type { Plugin, PluginInstance } from '../src/models/plugin';

const plugins = [
  { name: 'pl-dircopy', version: '2.1.1', title: 'Dir Copy', id: 1 },
  { name: 'pl-fshack', version: '1.0.0', title: 'FS Hack', id: 2 },
] as unknown as Plugin[];

describe('pluginRun_render', () => {
  it('reports the instance id and status', () => {
    const inst = { id: 42, status: 'scheduled' } as unknown as PluginInstance;
    const out = pluginRun_render(inst);
    expect(out).toContain('Plugin started successfully');
    expect(out).toContain('42');
    expect(out).toContain('scheduled');
  });
});

describe('pluginList_render', () => {
  it('reports when there are no plugins', () => {
    expect(pluginList_render([], [])).toContain('No plugins found');
  });

  it('uses default fields and tab-separates rows', () => {
    const out = pluginList_render(plugins, []);
    expect(out).toContain('pl-dircopy');
    expect(out).toContain('2.1.1');
    expect(out.split('\n')).toHaveLength(2);
    expect(out.split('\n')[0]).toContain('\t');
  });

  it('renders selected fields, defaulting missing values to empty', () => {
    const out = pluginList_render([{ name: 'pl-x' } as unknown as Plugin], ['name', 'version']);
    expect(out).toBe('pl-x\t'); // version missing -> empty
  });

  it('renders CSV with quoted, escaped headers and cells', () => {
    const out = pluginList_render(plugins, ['name', 'version'], { csv: true });
    const lines = out.split('\n');
    expect(lines[0]).toBe('"NAME","VERSION"');
    expect(lines[1]).toBe('"pl-dircopy","2.1.1"');
  });

  it('delegates to screen.table_output for table format', () => {
    const out = pluginList_render(plugins, ['name'], { table: true });
    expect(out).toBe('TABLE_OUTPUT');
  });
});

describe('connect views', () => {
  it('login_render', () => {
    expect(login_render(true, 'http://c/', 'chris')).toContain('Successfully connected');
    expect(login_render(false, 'http://c/', 'chris')).toContain('Failed to connect');
  });
  it('logout_render', () => {
    expect(logout_render(true)).toContain('Logged out');
    expect(logout_render(false)).toContain('Logout failed');
  });
});
