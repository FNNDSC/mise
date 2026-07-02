/**
 * Tests for FeedGroupHandler / FeedMemberHandler. The command modules, ui and
 * screen are mocked; BaseGroupHandler.IDs_getFromSearch is spied so no live
 * asset call happens. FeedController.controller_create runs (lazy cumin group).
 */
const mockFields = jest.fn();
const mockShareById = jest.fn();
const mockSearchByTerm = jest.fn();
const mockDeleteById = jest.fn();
const mockCreateCmd = jest.fn();
const mockConfirm = jest.fn();
const mockTableDisplay = jest.fn();

jest.mock('../src/commands/feeds/fields', () => ({ feedFields_fetch: mockFields }));
jest.mock('../src/commands/feeds/share', () => ({ feed_shareById: mockShareById }));
jest.mock('../src/commands/feeds/delete', () => ({ feeds_searchByTerm: mockSearchByTerm, feed_deleteById: mockDeleteById }));
jest.mock('../src/commands/feed/create', () => ({ feed_create: mockCreateCmd }));
jest.mock('../src/utils/ui', () => ({ prompt_confirm: mockConfirm }));
jest.mock('../src/screen/screen', () => ({ table_display: mockTableDisplay }));

import { Command } from 'commander';
import { FeedGroupHandler, FeedMemberHandler } from '../src/feeds/feedHandler';
import { BaseGroupHandler } from '../src/handlers/baseGroupHandler';

let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('FeedGroupHandler.feeds_fields', () => {
  it('displays fields when present', async () => {
    mockFields.mockResolvedValue(['id', 'name']);
    await new FeedGroupHandler().feeds_fields();
    expect(mockTableDisplay).toHaveBeenCalledWith(['id', 'name'], ['fields']);
  });
  it('notes when there are none', async () => {
    mockFields.mockResolvedValue([]);
    await new FeedGroupHandler().feeds_fields();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No resource fields'));
  });
});

describe('FeedGroupHandler.feeds_share', () => {
  it('shares each matched feed', async () => {
    const spy = jest.spyOn(BaseGroupHandler.prototype, 'IDs_getFromSearch').mockResolvedValue([5]);
    mockShareById.mockResolvedValue(true);
    await new FeedGroupHandler().feeds_share('id:5', { is_public: true });
    expect(spy).toHaveBeenCalled();
    expect(mockShareById).toHaveBeenCalledWith(5, { is_public: true });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('shared successfully'));
  });

  it('notes when nothing matches', async () => {
    jest.spyOn(BaseGroupHandler.prototype, 'IDs_getFromSearch').mockResolvedValue([]);
    await new FeedGroupHandler().feeds_share('id:9', {});
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No feeds found matching'));
  });
});

describe('FeedGroupHandler.feeds_delete', () => {
  it('deletes matched feeds with --force', async () => {
    mockSearchByTerm.mockResolvedValue([{ id: 7, name: 'brain' }]);
    mockDeleteById.mockResolvedValue(true);
    await new FeedGroupHandler().feeds_delete('id:7', { force: true });
    expect(mockDeleteById).toHaveBeenCalledWith(7);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Deleted feed 7'));
  });

  it('respects a declined confirmation', async () => {
    mockSearchByTerm.mockResolvedValue([{ id: 7, name: 'brain' }]);
    mockConfirm.mockResolvedValue(false);
    await new FeedGroupHandler().feeds_delete('id:7', {});
    expect(mockDeleteById).not.toHaveBeenCalled();
  });

  it('notes when nothing matches', async () => {
    mockSearchByTerm.mockResolvedValue([]);
    await new FeedGroupHandler().feeds_delete('id:9', {});
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No feeds found matching'));
  });
});

describe('FeedMemberHandler.feed_create', () => {
  it('creates and renders a feed', async () => {
    mockCreateCmd.mockResolvedValue({ id: 1, name: 'f' });
    const feed = await new FeedMemberHandler().feed_create({ dirs: '/a' });
    expect(feed).toEqual({ id: 1, name: 'f' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Feed created successfully'));
  });

  it('reports a null creation result', async () => {
    mockCreateCmd.mockResolvedValue(null);
    expect(await new FeedMemberHandler().feed_create({})).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('returned null'));
  });

  it('reports a thrown error', async () => {
    mockCreateCmd.mockRejectedValue(new Error('boom'));
    expect(await new FeedMemberHandler().feed_create({})).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

describe('command setup', () => {
  it('registers feed group + member subcommands', () => {
    const program = new Command();
    new FeedGroupHandler().feedGroupCommand_setup(program);
    new FeedMemberHandler().feedCommand_setup(program);
    const feeds = program.commands.find((c) => c.name() === 'feeds');
    const feed = program.commands.find((c) => c.name() === 'feed');
    expect(feeds?.commands.map((c) => c.name())).toEqual(expect.arrayContaining(['list', 'fieldslist', 'delete', 'share']));
    expect(feed?.commands.map((c) => c.name())).toContain('create');
  });
});
