/**
 * @file Remote client host-mode tests.
 *
 * Verifies that `chell --remote -c` uses a one-shot surface, executes exactly
 * once, closes its transport, and never starts the interactive REPL.
 *
 * @module
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { CommandEnvelope } from '@fnndsc/cumin';

const mockClose = jest.fn();
const mockConnect = jest.fn();
const mockReplStart = jest.fn(async (): Promise<void> => undefined);
const mockSurfaceLineExecute = jest.fn();
const mockSinkSet = jest.fn();
const mockSurfaceSet = jest.fn();
const mockPrompt = jest.fn();
const mockPipeSegment = jest.fn();
const mockLocalEdit = jest.fn();
const mockResolverResolve = jest.fn();
const mockResolverList = jest.fn();

const berth = {
  identity: 'chris@https://cube.example.org/api/v1/',
  url: 'ws://127.0.0.1:42000',
  token: 'token',
};

class MockLocalBerthResolver {
  public async resolve(_identity: string): Promise<typeof berth> {
    return mockResolverResolve(_identity);
  }

  public async list(): Promise<Array<typeof berth>> {
    return mockResolverList();
  }
}

class MockRemoteEngine {
  public static connect = mockConnect;
}

class MockRepl {
  public start = mockReplStart;
}

jest.unstable_mockModule('@fnndsc/calypso', () => ({
  LocalBerthResolver: MockLocalBerthResolver,
}));
jest.unstable_mockModule('@fnndsc/brasa', () => ({
  sink_set: mockSinkSet,
  surface_get: jest.fn(() => ({
    prompt: mockPrompt,
    pipeSegment: mockPipeSegment,
    localEdit: mockLocalEdit,
  })),
  surface_set: mockSurfaceSet,
  StdoutSink: class MockStdoutSink {},
}));
jest.unstable_mockModule('../src/remote/remoteEngine.js', () => ({
  RemoteEngine: MockRemoteEngine,
}));
jest.unstable_mockModule('../src/core/repl.js', () => ({ REPL: MockRepl }));
jest.unstable_mockModule('../src/core/cliSurface.js', () => ({
  cliSurface_create: jest.fn(() => ({ capabilities: {} })),
}));
jest.unstable_mockModule('../src/core/progressRenderer.js', () => ({
  TerminalProgressRenderer: class MockTerminalProgressRenderer {},
}));
jest.unstable_mockModule('../src/core/surfaceDispatch.js', () => ({
  surfaceLine_execute: mockSurfaceLineExecute,
}));

const { berth_probeLive, remote_run } = await import('../src/remote/client.js');

describe('berth_probeLive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('closes a successful probe connection', async () => {
    mockConnect.mockResolvedValue({ close: mockClose });

    await expect(berth_probeLive(berth)).resolves.toBe(true);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected probe as not live', async () => {
    mockConnect.mockRejectedValue(new Error('connection refused'));

    await expect(berth_probeLive(berth)).resolves.toBe(false);
  });
});

describe('remote_run', () => {
  const previousExitCode: number | string | undefined = process.exitCode;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    mockResolverResolve.mockResolvedValue(berth);
    mockResolverList.mockResolvedValue([berth]);
    mockConnect.mockResolvedValue({ close: mockClose, promptLine: jest.fn(() => '') });
    mockSurfaceLineExecute.mockResolvedValue([{ status: 'ok', rendered: '/proc/jobs\n' }]);
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    jest.restoreAllMocks();
  });

  it('executes a one-shot command, closes, and does not start the REPL', async () => {
    await remote_run(berth.identity, 'pwd');

    expect(mockConnect).toHaveBeenCalledWith(expect.objectContaining({ onSession: undefined }));
    expect(mockSurfaceLineExecute).toHaveBeenCalledWith(expect.any(Object), 'pwd');
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockReplStart).not.toHaveBeenCalled();
    expect(mockSinkSet).toHaveBeenCalledTimes(1);
    expect(mockSurfaceSet).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it('uses the sole live berth when no identity is specified', async () => {
    await remote_run(undefined, 'pwd');

    expect(mockResolverList).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledWith(expect.objectContaining({ url: berth.url }));
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('exits unsuccessfully when no daemon berth is available', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation((): void => undefined);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('exit 1');
    }) as typeof process.exit);
    mockResolverList.mockResolvedValue([]);

    await expect(remote_run(undefined, 'pwd')).rejects.toThrow('exit 1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No CALYPSO daemon found'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('returns failure status and still closes when an envelope reports error', async () => {
    const envelopes: CommandEnvelope[] = [{ status: 'error', rendered: 'failed\n' }];
    mockSurfaceLineExecute.mockResolvedValue(envelopes);

    await remote_run(berth.identity, 'bad-command');

    expect(process.exitCode).toBe(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('returns failure status and still closes when execution rejects', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation((): void => undefined);
    mockSurfaceLineExecute.mockRejectedValue(new Error('daemon rejected command'));

    await remote_run(berth.identity, 'bad-command');

    expect(process.exitCode).toBe(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('daemon rejected command'));
  });

  it('keeps the existing interactive REPL path when no command is given', async () => {
    await remote_run(berth.identity);

    expect(mockReplStart).toHaveBeenCalledTimes(1);
    expect(mockSurfaceLineExecute).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('wires interactive daemon callbacks to the local surface', async () => {
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('daemon disconnected');
    }) as typeof process.exit);
    mockPrompt.mockResolvedValue('answer');
    mockPipeSegment.mockResolvedValue(Buffer.from('output'));
    mockLocalEdit.mockResolvedValue({ content: 'edited', changed: true });

    await remote_run(berth.identity);
    const options = mockConnect.mock.calls[0][0];

    options.onSession('abcdef123', { status: 'ok', rendered: 'background output\n' });
    options.onSession('abcdef123', { status: 'ok', rendered: '' });
    await expect(options.onPrompt('Question?', false)).resolves.toBe('answer');
    await expect(options.onPipe('wc -l', Buffer.from('input'))).resolves.toEqual(Buffer.from('output'));
    await expect(options.onEdit('before', '.txt')).resolves.toEqual({ content: 'edited', changed: true });
    expect(() => options.onClose()).toThrow('daemon disconnected');

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('background output'));
    expect(mockPrompt).toHaveBeenCalledWith({ message: 'Question?', hidden: false });
    expect(mockPipeSegment).toHaveBeenCalledWith('wc -l', Buffer.from('input'));
    expect(mockLocalEdit).toHaveBeenCalledWith({ content: 'before', extension: '.txt' });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('reports an attach failure and exits unsuccessfully', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation((): void => undefined);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('exit 1');
    }) as typeof process.exit);
    mockConnect.mockRejectedValue(new Error('handshake failed'));

    await expect(remote_run(berth.identity)).rejects.toThrow('exit 1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('handshake failed'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
