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

interface TestBerth {
  identity: string;
  url: string;
  token: string;
}

interface TestRemoteEngine {
  close(): void;
  promptLine?: (line: string) => string;
}

interface TestConnectOptions {
  url: string;
  token: string;
  onSession?: (surface: string, envelope: CommandEnvelope) => void;
  onPrompt: (message: string, hidden: boolean) => Promise<string>;
  onPipe: (command: string, stdin: Buffer) => Promise<Buffer>;
  onEdit: (content: string, extension: string) => Promise<{ content: string; changed: boolean }>;
  onClose: () => void;
}

const remoteClose_mock = jest.fn<() => void>();
const remoteConnect_mock = jest.fn<(options: TestConnectOptions) => Promise<TestRemoteEngine>>();
const replStart_mock = jest.fn(async (): Promise<void> => undefined);
const surfaceLineExecute_mock = jest.fn<(engine: unknown, line: string) => Promise<CommandEnvelope[]>>();
const sinkSet_mock = jest.fn<(sink: unknown) => void>();
const surfaceSet_mock = jest.fn<(surface: unknown) => void>();
const prompt_mock = jest.fn<(options: { message: string; hidden: boolean }) => Promise<string>>();
const pipeSegment_mock = jest.fn<(command: string, stdin: Buffer) => Promise<Buffer>>();
const localEdit_mock = jest.fn<(request: { content: string; extension: string }) => Promise<{ content: string; changed: boolean }>>();
const resolverResolve_mock = jest.fn<(identity: string) => Promise<TestBerth | null>>();
const resolverList_mock = jest.fn<() => Promise<TestBerth[]>>();

const berth: TestBerth = {
  identity: 'chris@https://cube.example.org/api/v1/',
  url: 'ws://127.0.0.1:42000',
  token: 'token',
};

class MockLocalBerthResolver {
  public async resolve(_identity: string): Promise<TestBerth | null> {
    return resolverResolve_mock(_identity);
  }

  public async list(): Promise<Array<typeof berth>> {
    return resolverList_mock();
  }
}

class MockRemoteEngine {
  public static connect = remoteConnect_mock;
}

class MockRepl {
  public start = replStart_mock;
}

jest.unstable_mockModule('@fnndsc/calypso', () => ({
  LocalBerthResolver: MockLocalBerthResolver,
}));
jest.unstable_mockModule('@fnndsc/brasa', () => ({
  sink_set: sinkSet_mock,
  surface_get: jest.fn(() => ({
    prompt: prompt_mock,
    pipeSegment: pipeSegment_mock,
    localEdit: localEdit_mock,
  })),
  surface_set: surfaceSet_mock,
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
  surfaceLine_execute: surfaceLineExecute_mock,
}));

const { berth_probeLive, remote_run } = await import('../src/remote/client.js');

describe('berth_probeLive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('closes a successful probe connection', async () => {
    remoteConnect_mock.mockResolvedValue({ close: remoteClose_mock });

    await expect(berth_probeLive(berth)).resolves.toBe(true);
    expect(remoteClose_mock).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected probe as not live', async () => {
    remoteConnect_mock.mockRejectedValue(new Error('connection refused'));

    await expect(berth_probeLive(berth)).resolves.toBe(false);
  });
});

describe('remote_run', () => {
  const previousExitCode: number | string | undefined = process.exitCode;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    resolverResolve_mock.mockResolvedValue(berth);
    resolverList_mock.mockResolvedValue([berth]);
    remoteConnect_mock.mockResolvedValue({ close: remoteClose_mock, promptLine: jest.fn((): string => '') });
    surfaceLineExecute_mock.mockResolvedValue([{ status: 'ok', rendered: '/proc/jobs\n' }]);
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    jest.restoreAllMocks();
  });

  it('executes a one-shot command, closes, and does not start the REPL', async () => {
    await remote_run(berth.identity, 'pwd');

    expect(remoteConnect_mock).toHaveBeenCalledWith(expect.objectContaining({ onSession: undefined }));
    expect(surfaceLineExecute_mock).toHaveBeenCalledWith(expect.any(Object), 'pwd');
    expect(remoteClose_mock).toHaveBeenCalledTimes(1);
    expect(replStart_mock).not.toHaveBeenCalled();
    expect(sinkSet_mock).toHaveBeenCalledTimes(1);
    expect(surfaceSet_mock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it('uses the sole live berth when no identity is specified', async () => {
    await remote_run(undefined, 'pwd');

    expect(resolverList_mock).toHaveBeenCalledTimes(1);
    expect(remoteConnect_mock).toHaveBeenCalledWith(expect.objectContaining({ url: berth.url }));
    expect(remoteClose_mock).toHaveBeenCalledTimes(1);
  });

  it('exits unsuccessfully when no daemon berth is available', async () => {
    const error_spy = jest.spyOn(console, 'error').mockImplementation((): void => undefined);
    const exit_spy = jest.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('exit 1');
    }) as typeof process.exit);
    resolverList_mock.mockResolvedValue([]);

    await expect(remote_run(undefined, 'pwd')).rejects.toThrow('exit 1');
    expect(error_spy).toHaveBeenCalledWith(expect.stringContaining('No CALYPSO daemon found'));
    expect(exit_spy).toHaveBeenCalledWith(1);
  });

  it('returns failure status and still closes when an envelope reports error', async () => {
    const envelopes: CommandEnvelope[] = [{ status: 'error', rendered: 'failed\n' }];
    surfaceLineExecute_mock.mockResolvedValue(envelopes);

    await remote_run(berth.identity, 'bad-command');

    expect(process.exitCode).toBe(1);
    expect(remoteClose_mock).toHaveBeenCalledTimes(1);
  });

  it('returns failure status and still closes when execution rejects', async () => {
    const error_spy = jest.spyOn(console, 'error').mockImplementation((): void => undefined);
    surfaceLineExecute_mock.mockRejectedValue(new Error('daemon rejected command'));

    await remote_run(berth.identity, 'bad-command');

    expect(process.exitCode).toBe(1);
    expect(remoteClose_mock).toHaveBeenCalledTimes(1);
    expect(error_spy).toHaveBeenCalledWith(expect.stringContaining('daemon rejected command'));
  });

  it('keeps the existing interactive REPL path when no command is given', async () => {
    await remote_run(berth.identity);

    expect(replStart_mock).toHaveBeenCalledTimes(1);
    expect(surfaceLineExecute_mock).not.toHaveBeenCalled();
    expect(remoteClose_mock).not.toHaveBeenCalled();
  });

  it('wires interactive daemon callbacks to the local surface', async () => {
    const stdout_spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exit_spy = jest.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('daemon disconnected');
    }) as typeof process.exit);
    prompt_mock.mockResolvedValue('answer');
    pipeSegment_mock.mockResolvedValue(Buffer.from('output'));
    localEdit_mock.mockResolvedValue({ content: 'edited', changed: true });

    await remote_run(berth.identity);
    const options: TestConnectOptions = remoteConnect_mock.mock.calls[0][0];

    options.onSession('abcdef123', { status: 'ok', rendered: 'background output\n' });
    options.onSession('abcdef123', { status: 'ok', rendered: '' });
    await expect(options.onPrompt('Question?', false)).resolves.toBe('answer');
    await expect(options.onPipe('wc -l', Buffer.from('input'))).resolves.toEqual(Buffer.from('output'));
    await expect(options.onEdit('before', '.txt')).resolves.toEqual({ content: 'edited', changed: true });
    expect(() => options.onClose()).toThrow('daemon disconnected');

    expect(stdout_spy).toHaveBeenCalledWith(expect.stringContaining('background output'));
    expect(prompt_mock).toHaveBeenCalledWith({ message: 'Question?', hidden: false });
    expect(pipeSegment_mock).toHaveBeenCalledWith('wc -l', Buffer.from('input'));
    expect(localEdit_mock).toHaveBeenCalledWith({ content: 'before', extension: '.txt' });
    expect(exit_spy).toHaveBeenCalledWith(0);
  });

  it('reports an attach failure and exits unsuccessfully', async () => {
    const error_spy = jest.spyOn(console, 'error').mockImplementation((): void => undefined);
    const exit_spy = jest.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('exit 1');
    }) as typeof process.exit);
    remoteConnect_mock.mockRejectedValue(new Error('handshake failed'));

    await expect(remote_run(berth.identity)).rejects.toThrow('exit 1');
    expect(error_spy).toHaveBeenCalledWith(expect.stringContaining('handshake failed'));
    expect(exit_spy).toHaveBeenCalledWith(1);
  });
});
