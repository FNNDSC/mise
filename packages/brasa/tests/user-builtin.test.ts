import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockCreate = jest.fn();
const mockFind = jest.fn();
const mockAction = jest.fn();
const mockAdminAccess = jest.fn();
const mockErrorPop = jest.fn(() => undefined);
jest.unstable_mockModule('@fnndsc/chili/commands/users/local.js', () => ({
  localAccount_adminAccessEnsure: mockAdminAccess,
  localAccount_create: mockCreate,
  localAccount_find: mockFind,
  localAccount_action: mockAction,
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  errorStack: { stack_pop: mockErrorPop },
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => ({ status: 'error', rendered, renderedErr }),
}));

const { builtin_user } = await import('../src/builtins/res/user.js');
const { surface_set } = await import('../src/core/surface.js');

const account = { id: 9, username: 'jack.bivowac', email: 'jack@example.com', is_active: true, disabled_at: null, removed_at: null };

beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  mockErrorPop.mockReturnValue(undefined);
  mockAdminAccess.mockResolvedValue({ ok: true, value: undefined });
  surface_set({
    capabilities: { hiddenInput: true, localEdit: false, tty: false, pipeSegments: false, shellCommands: false },
    prompt: jest.fn(async ({ message }: { message: string }) => message.includes('Email') ? account.email : 'secret-pass'),
    pipeSegment: async (_command: string, input: Buffer) => input,
    shellCommand: async () => 1,
    localEdit: async () => ({ content: '', changed: false }),
  });
});

describe('user builtin', () => {
  it('prompts for a local account password and creates only through the local seam', async () => {
    mockCreate.mockResolvedValue({ ok: true, value: account });
    await expect(builtin_user(['add', account.username])).resolves.toMatchObject({ status: 'ok' });
    expect(mockCreate).toHaveBeenCalledWith(account.username, account.email, 'secret-pass');
  });

  it('finds a local account for inspect and lifecycle commands', async () => {
    mockFind.mockResolvedValue({ ok: true, value: account });
    mockAction.mockResolvedValue({ ok: true, value: { ...account, is_active: false } });
    await expect(builtin_user(['disable', account.username])).resolves.toMatchObject({ status: 'ok' });
    expect(mockAction).toHaveBeenCalledWith(account.id, 'disable');
  });

  it('rejects mismatched account passwords', async () => {
    surface_set({
      capabilities: { hiddenInput: true, localEdit: false, tty: false, pipeSegments: false, shellCommands: false },
      prompt: jest.fn(async ({ message }: { message: string }) => message.includes('Email') ? account.email : message.includes('Retype') ? 'other' : 'secret-pass'),
      pipeSegment: async (_command: string, input: Buffer) => input,
      shellCommand: async () => 1,
      localEdit: async () => ({ content: '', changed: false }),
    });
    await expect(builtin_user(['add', account.username])).resolves.toMatchObject({ status: 'error' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('suggests sudo before any account operation when the current identity is not an administrator', async () => {
    mockAdminAccess.mockResolvedValue({ ok: false });
    mockErrorPop.mockReturnValue({ message: 'Administrator privileges are required.' });
    const result = await builtin_user(['disable', account.username]);
    expect(result).toMatchObject({ status: 'error', renderedErr: expect.stringContaining('sudo user disable') });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockFind).not.toHaveBeenCalled();
  });
});
