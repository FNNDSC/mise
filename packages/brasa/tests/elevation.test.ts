/** Tests for explicit, surface-mediated CUBE elevation. */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { CommandEnvelope } from '@fnndsc/cumin';
import type { Surface } from '../src/core/surface.js';

const mockElevationRun = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/connect/elevation.js', () => ({
  elevation_run: mockElevationRun,
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => ({
    status: 'error', rendered, renderedErr,
  }),
}));

const { sudoCommand_run, authorizationFailure_is, sudoHint_build } = await import('../src/core/elevation.js');
const { surface_set, HeadlessSurface } = await import('../src/core/surface.js');

function surface_create(answers: string[], tty: boolean = true): Surface {
  return {
    capabilities: {
      hiddenInput: true,
      localEdit: false,
      tty,
      pipeSegments: false,
      shellCommands: false,
    },
    prompt: jest.fn(async (): Promise<string> => answers.shift() ?? ''),
    pipeSegment: async (_command: string, input: Buffer): Promise<Buffer> => input,
    shellCommand: async (): Promise<number> => 1,
    localEdit: async (): Promise<{ content: string; changed: boolean }> => ({ content: '', changed: false }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  surface_set(new HeadlessSurface());
  mockElevationRun.mockImplementation(async (
    _credentials: unknown,
    operation: () => Promise<CommandEnvelope>,
  ): Promise<CommandEnvelope> => await operation());
});

describe('sudoCommand_run', () => {
  it('prompts on the active surface and scopes one nested command', async (): Promise<void> => {
    const surface: Surface = surface_create(['admin', 'secret']);
    surface_set(surface);
    const run = jest.fn(async (): Promise<CommandEnvelope> => ({ status: 'ok', rendered: 'done\n' }));

    await expect(sudoCommand_run(['group', 'adduser', 'pacs_users', 'peter.hong'], run)).resolves.toEqual({
      status: 'ok', rendered: 'done\n',
    });

    expect(surface.prompt).toHaveBeenNthCalledWith(1, { message: 'Administrator username: ' });
    expect(surface.prompt).toHaveBeenNthCalledWith(2, { message: 'Administrator password: ', hidden: true });
    expect(mockElevationRun).toHaveBeenCalledWith(
      { username: 'admin', password: 'secret' },
      expect.any(Function),
    );
    expect(run).toHaveBeenCalledWith('group', ['adduser', 'pacs_users', 'peter.hong']);
  });

  it('fails clearly before prompting when the surface cannot read a secret', async (): Promise<void> => {
    const envelope: CommandEnvelope = await sudoCommand_run(['group', 'adduser', 'pacs_users', 'peter.hong'], jest.fn());

    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('cannot securely collect administrator credentials');
    expect(mockElevationRun).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('allows a non-TTY surface that explicitly supports hidden input', async (): Promise<void> => {
    const surface: Surface = surface_create(['admin', 'secret'], false);
    surface_set(surface);
    const run = jest.fn(async (): Promise<CommandEnvelope> => ({ status: 'ok', rendered: 'done\n' }));

    await expect(sudoCommand_run(['group', 'adduser', 'pacs_users', 'peter.hong'], run)).resolves.toEqual({
      status: 'ok', rendered: 'done\n',
    });
    expect(run).toHaveBeenCalled();
  });

  it('does not allow nested sudo', async (): Promise<void> => {
    const envelope: CommandEnvelope = await sudoCommand_run(['sudo', 'group', 'adduser', 'pacs_users', 'peter.hong'], jest.fn());

    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('nested elevation is not supported');
  });
});

describe('elevation hints', () => {
  it('recognizes authorization failures but not ordinary validation errors', (): void => {
    expect(authorizationFailure_is('Request failed with status code 403')).toBe(true);
    expect(authorizationFailure_is('permission denied')).toBe(true);
    expect(authorizationFailure_is('Username does not exist')).toBe(false);
  });

  it('builds a copyable sudo rerun', (): void => {
    expect(sudoHint_build('group adduser', ['pacs_users', 'peter.hong']))
      .toContain('sudo group adduser pacs_users peter.hong');
  });
});
