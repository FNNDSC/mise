import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Satisfy builtins/utils' heavy imports so the real commandArgs_process loads.
jest.unstable_mockModule('@fnndsc/salsa', () => ({ context_getSingle: jest.fn() }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({}));
jest.unstable_mockModule('../src/session/index.js', () => ({ session: {} }));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));

// Shared screen + per-resource chili command modules.
const mockTable = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({ table_display: mockTable }));

const mockTagsList = jest.fn();
const mockTagFields = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/tags/list.js', () => ({ tags_fetchList: mockTagsList }));
jest.unstable_mockModule('@fnndsc/chili/commands/tags/fields.js', () => ({ tagFields_fetch: mockTagFields }));

const mockGroupsList = jest.fn();
const mockGroupFields = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/groups/list.js', () => ({ groups_fetchList: mockGroupsList }));
jest.unstable_mockModule('@fnndsc/chili/commands/groups/fields.js', () => ({ groupFields_fetch: mockGroupFields }));

const mockWorkflowsList = jest.fn();
const mockWorkflowFields = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/workflows/list.js', () => ({ workflows_fetchList: mockWorkflowsList }));
jest.unstable_mockModule('@fnndsc/chili/commands/workflows/fields.js', () => ({ workflowFields_fetch: mockWorkflowFields }));

const { builtin_tag } = await import('../src/builtins/res/tag.js');
const { builtin_group } = await import('../src/builtins/res/group.js');
const { builtin_workflow } = await import('../src/builtins/res/workflow.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

/** Each resource builtin follows the same list/inspect/error/unknown shape. */
const cases = [
  {
    name: 'tag',
    builtin: builtin_tag,
    list: mockTagsList,
    fields: mockTagFields,
    listKey: 'tags',
  },
  {
    name: 'group',
    builtin: builtin_group,
    list: mockGroupsList,
    fields: mockGroupFields,
    listKey: 'groups',
  },
  {
    name: 'workflow',
    builtin: builtin_workflow,
    list: mockWorkflowsList,
    fields: mockWorkflowFields,
    listKey: 'workflows',
  },
] as const;

describe.each(cases)('builtin_$name', ({ builtin, list, fields, listKey }) => {
  it('lists resources', async () => {
    list.mockResolvedValue({ [listKey]: [{ id: 1 }], selectedFields: ['id'], totalCount: 1 });
    await builtin([]);
    expect(mockTable).toHaveBeenCalled();
  });

  it('notes an empty listing', async () => {
    list.mockResolvedValue({ [listKey]: [], selectedFields: [], totalCount: 0 });
    await builtin(['list']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No '));
  });

  it('reports a listing error and sets a non-zero exit code', async () => {
    list.mockRejectedValue(new Error('boom'));
    await builtin(['list']);
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('inspects fields', async () => {
    fields.mockResolvedValue(['id', 'name']);
    await builtin(['inspect']);
    expect(mockTable).toHaveBeenCalled();
  });

  it('notes empty fields on inspect', async () => {
    fields.mockResolvedValue([]);
    await builtin(['inspect']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No fields'));
  });

  it('rejects an unknown subcommand with a non-zero exit code', async () => {
    await builtin(['frobnicate']);
    expect(process.exitCode).toBe(1);
  });

  it('handles the search subcommand', async () => {
    await expect(builtin(['search', 'foo'])).resolves.toBeUndefined();
  });
});
