/**
 * Tests for BaseGroupHandler. The injected chrisObject.asset is a fake; screen
 * rendering and readline are stubbed; commander + record_extract are real.
 */
jest.mock('../src/screen/screen', () => ({
  table_display: jest.fn(),
  border_draw: jest.fn((s: string) => s),
}));
jest.mock('readline');

import readline from 'readline';
import { Command } from 'commander';
import { BaseGroupHandler } from '../src/handlers/baseGroupHandler';
import { table_display } from '../src/screen/screen';

function makeHandler(assetOverrides: Record<string, unknown> = {}) {
  const asset = {
    resources_listAndFilterByOptions: jest.fn(),
    resourceFields_get: jest.fn(),
    resourceItem_delete: jest.fn(),
    ...assetOverrides,
  };
  const handler = new BaseGroupHandler('feeds', { asset } as never);
  return { handler, asset };
}

let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('resources_list', () => {
  const rows = { selectedFields: ['id', 'name'], tableData: [{ id: 1, name: 'brain' }] };

  it('errors when no results', async () => {
    const { handler, asset } = makeHandler();
    asset.resources_listAndFilterByOptions.mockResolvedValue(null);
    await handler.resources_list({});
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('No feeds resources found'));
  });

  it('notes when the result set is empty', async () => {
    const { handler, asset } = makeHandler();
    asset.resources_listAndFilterByOptions.mockResolvedValue({ selectedFields: [], tableData: [] });
    await handler.resources_list({});
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No feeds found'));
  });

  it('renders the default (borderless) list', async () => {
    const { handler, asset } = makeHandler();
    asset.resources_listAndFilterByOptions.mockResolvedValue(rows);
    await handler.resources_list({});
    expect(table_display).toHaveBeenCalled();
  });

  it('renders a table when --table is set', async () => {
    const { handler, asset } = makeHandler();
    asset.resources_listAndFilterByOptions.mockResolvedValue(rows);
    await handler.resources_list({ table: true });
    expect(table_display).toHaveBeenCalled();
  });

  it('renders CSV when --csv is set', async () => {
    const { handler, asset } = makeHandler();
    asset.resources_listAndFilterByOptions.mockResolvedValue(rows);
    await handler.resources_list({ csv: true });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"ID","NAME"'));
  });

  it('parses "field:width" column specifiers', async () => {
    const { handler, asset } = makeHandler();
    asset.resources_listAndFilterByOptions.mockResolvedValue(rows);
    await handler.resources_list({ fields: 'name:20,id' });
    // width specifier stripped from the fields passed downstream
    expect(asset.resources_listAndFilterByOptions).toHaveBeenCalledWith(
      expect.objectContaining({ fields: 'name,id' })
    );
  });

  it('swallows errors via the errorStack', async () => {
    const { handler, asset } = makeHandler();
    asset.resources_listAndFilterByOptions.mockRejectedValue(new Error('boom'));
    await expect(handler.resources_list({})).resolves.toBeUndefined();
  });
});

describe('resourceFields_list', () => {
  it('errors when fields cannot be fetched', async () => {
    const { handler, asset } = makeHandler();
    asset.resourceFields_get.mockResolvedValue(null);
    await handler.resourceFields_list();
    expect(errSpy).toHaveBeenCalled();
  });
  it('notes when there are no fields', async () => {
    const { handler, asset } = makeHandler();
    asset.resourceFields_get.mockResolvedValue({ fields: [] });
    await handler.resourceFields_list();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No resource fields'));
  });
  it('displays the fields', async () => {
    const { handler, asset } = makeHandler();
    asset.resourceFields_get.mockResolvedValue({ fields: ['id', 'name'] });
    await handler.resourceFields_list();
    expect(table_display).toHaveBeenCalledWith(['id', 'name'], ['fields']);
  });
});

describe('msg_OKorNot', () => {
  it('returns OK for truthy, and the default/custom failure otherwise', () => {
    const { handler } = makeHandler();
    expect(handler.msg_OKorNot({})).toBe('[ OK ]');
    expect(handler.msg_OKorNot(null)).toBe('[ Failed ]');
    expect(handler.msg_OKorNot(null, 'nope')).toBe('nope');
  });
});

describe('IDs_getFromSearch + delete_handle', () => {
  it('extracts ids from the search results', async () => {
    const { handler, asset } = makeHandler();
    asset.resources_listAndFilterByOptions.mockResolvedValue({
      selectedFields: ['id'],
      tableData: [{ id: 1 }, { id: 2 }],
    });
    expect(await handler.IDs_getFromSearch({})).toEqual([1, 2]);
  });

  it('returns null when the search yields nothing', async () => {
    const { handler, asset } = makeHandler();
    asset.resources_listAndFilterByOptions.mockResolvedValue(null);
    expect(await handler.IDs_getFromSearch({})).toBeNull();
  });

  it('delete_handle errors when nothing matches', async () => {
    const { handler, asset } = makeHandler();
    asset.resources_listAndFilterByOptions.mockResolvedValue(null);
    await handler.delete_handle({});
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('No feeds matched'));
  });

  it('delete_handle deletes matched ids with --force', async () => {
    const { handler, asset } = makeHandler();
    asset.resources_listAndFilterByOptions.mockResolvedValue({
      selectedFields: ['id'],
      tableData: [{ id: 5 }],
    });
    asset.resourceItem_delete.mockResolvedValue(true);
    await handler.delete_handle({ force: true });
    expect(asset.resourceItem_delete).toHaveBeenCalledWith(5);
  });
});

describe('resources_delete', () => {
  it('returns false when the API throws', async () => {
    const { handler, asset } = makeHandler();
    asset.resources_listAndFilterByOptions.mockRejectedValue(new Error('x'));
    expect(await handler.resources_delete([1], true)).toBe(false);
  });

  it('honours a declined confirmation prompt', async () => {
    const { handler, asset } = makeHandler();
    asset.resources_listAndFilterByOptions.mockResolvedValue({ selectedFields: ['id'], tableData: [{ id: 1 }] });
    (readline.createInterface as jest.Mock).mockReturnValue({
      question: (_q: string, cb: (a: string) => void) => cb('n'),
      close: jest.fn(),
    });
    expect(await handler.resources_delete([1], false)).toBe(true); // loop continues, no delete
    expect(asset.resourceItem_delete).not.toHaveBeenCalled();
  });
});

describe('commander wiring', () => {
  it('baseListCommand_create builds a "list" command with options', () => {
    const { handler } = makeHandler();
    const cmd = handler.baseListCommand_create(async () => undefined);
    expect(cmd.name()).toBe('list');
    expect(cmd.options.some((o) => o.long === '--csv')).toBe(true);
  });

  it('command_setup registers list/fieldslist/delete subcommands', () => {
    const { handler } = makeHandler();
    const program = new Command();
    handler.command_setup(program);
    const feeds = program.commands.find((c) => c.name() === 'feeds');
    const subNames = feeds?.commands.map((c) => c.name()) ?? [];
    expect(subNames).toEqual(expect.arrayContaining(['list', 'fieldslist', 'delete']));
  });
});
