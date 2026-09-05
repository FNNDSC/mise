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
import type { LocalEditRequest, LocalEditResult } from '@fnndsc/brasa';
import type { RemoteEngineOptions } from '../src/remote/remoteEngine.js';

interface TestBerth {
  identity: string;
  url: string;
  token: string;
}

interface TestRemoteEngine {
  close(): void;
  promptLine?: () => string;
  daemonStack?: () => { chell: string; calypso: string; build: string } | undefined;
}

const remoteClose_mock = jest.fn<() => void>();
const remoteConnect_mock = jest.fn<(options: RemoteEngineOptions) => Promise<TestRemoteEngine>>();
const replStart_mock = jest.fn(async (): Promise<void> => undefined);
const surfaceLineExecute_mock = jest.fn<(engine: unknown, line: string) => Promise<CommandEnvelope[]>>();
const sinkSet_mock = jest.fn<(sink: unknown) => void>();
const surfaceSet_mock = jest.fn<(surface: unknown) => void>();
const prompt_mock = jest.fn<(options: { message: string; hidden: boolean }) => Promise<string>>();
const pipeSegment_mock = jest.fn<(command: string, stdin: Buffer) => Promise<Buffer>>();
const shellCommand_mock = jest.fn<(command: string) => Promise<number>>();
const localEdit_mock = jest.fn<(request: LocalEditRequest) => Promise<LocalEditResult>>();
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
    shellCommand: shellCommand_mock,
    localEdit: localEdit_mock,
  })),
  surface_set: surfaceSet_mock,
  StdoutSink: class MockStdoutSink {},
  welcomeLine_build: jest.fn(() => 'ChELL Executes Layered Logic, v 0.0.0 (dev). Welcome.'),
  welcomeLine_compose: jest.fn(
    (pkg: string, version: string, build: string) => `ChELL Executes Layered Logic, v ${version} (${build}). Welcome.`,
  ),
  fortune_random: jest.fn(() => 'A test fortune.'),
}));
jest.unstable_mockModule('../src/remote/remoteEngine.js', () => ({
  RemoteEngine: MockRemoteEngine,
}));
jest.unstable_mockModule('../src/core/repl.js', () => ({ REPL: MockRepl }));
jest.unstable_mockModule('../src/core/cliSurface.js', () => ({
  cliSurface_create: jest.fn(() => ({ capabilities: {} })),
}));
jest.unstable_mockModule('../src/core/progressRenderer.js', () => ({
  TerminalProgressRenderer: class MockTerminalProgressRenderer {
    write(): void {}
    clear(): void {}
  },
}));
jest.unstable_mockModule('../src/core/surfaceDispatch.js', () => ({
  surfaceLine_execute: surfaceLineExecute_mock,
}));

const { berth_probeLive, remote_run, berth_fromAddress } = await import('../src/remote/client.js');

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
    remoteConnect_mock.mockResolvedValue({
      close: remoteClose_mock,
      promptLine: jest.fn((): string => ''),
      daemonStack: jest.fn(() => undefined),
    });
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

  it('attaches by address without consulting this host\'s berths', async () => {
    await remote_run(undefined, 'pwd', { address: 'http://pangea:41234/?token=abc123' });

    // A daemon on another machine leaves no berth in this host's runtime
    // directory, so discovery must not be reached at all — asking it would
    // find nothing and refuse an attach that is perfectly possible.
    expect(resolverList_mock).not.toHaveBeenCalled();
    expect(resolverResolve_mock).not.toHaveBeenCalled();
    expect(remoteConnect_mock).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'ws://pangea:41234', token: 'abc123' }),
    );
  });

  it('exits unsuccessfully when no daemon berth is available', async () => {
    const error_spy = jest.spyOn(console, 'error').mockImplementation((): void => undefined);
    const exit_spy = jest.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('exit 1');
    }) as typeof process.exit);
    resolverList_mock.mockResolvedValue([]);

    await expect(remote_run(undefined, 'pwd')).rejects.toThrow('exit 1');
    expect(error_spy).toHaveBeenCalledWith(expect.stringContaining('No calypso found'));
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

  it('banners the daemon-reported stack on interactive attach', async () => {
    const log_spy = jest.spyOn(console, 'log').mockImplementation((): void => undefined);
    remoteConnect_mock.mockResolvedValue({
      close: remoteClose_mock,
      promptLine: jest.fn((): string => ''),
      daemonStack: jest.fn(() => ({
        chell: '5.3.0', calypso: '0.5.0', build: 'abc123',
        brasa: '0.10.0', chili: '3.5.0', salsa: '2.1.0', cumin: '3.9.0',
      })),
    });

    await remote_run(berth.identity);

    const printed: string = log_spy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    log_spy.mockRestore();
    expect(printed).toContain('v 5.3.0 (abc123)');
    for (const layer of ['chell', 'brasa', 'chili', 'salsa', 'cumin', 'calypso']) {
      expect(printed).toContain(layer);
    }
    expect(replStart_mock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the local welcome line when the daemon reports no stack', async () => {
    const log_spy = jest.spyOn(console, 'log').mockImplementation((): void => undefined);
    await remote_run(berth.identity);
    const printed: string = log_spy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    log_spy.mockRestore();
    expect(printed).toContain('Welcome.');
    expect(printed).toContain('Attached to CALYPSO daemon');
  });

  it('wires interactive daemon callbacks to the local surface', async () => {
    const stdout_spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exit_spy = jest.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('daemon disconnected');
    }) as typeof process.exit);
    prompt_mock.mockResolvedValue('answer');
    pipeSegment_mock.mockResolvedValue(Buffer.from('output'));
    shellCommand_mock.mockResolvedValue(0);
    localEdit_mock.mockResolvedValue({ content: 'edited', changed: true });

    await remote_run(berth.identity);
    const options: RemoteEngineOptions = remoteConnect_mock.mock.calls[0][0];
    const session_dispatch = options.onSession;
    const prompt_dispatch = options.onPrompt;
    const pipe_dispatch = options.onPipe;
    const shell_dispatch = options.onShell;
    const edit_dispatch = options.onEdit;
    const close_dispatch = options.onClose;
    if (!session_dispatch || !prompt_dispatch || !pipe_dispatch || !shell_dispatch || !edit_dispatch || !close_dispatch) {
      throw new Error('interactive callbacks were not connected');
    }

    session_dispatch('abcdef123', { status: 'ok', rendered: 'background output\n' });
    session_dispatch('abcdef123', { status: 'ok', rendered: '' });
    await expect(prompt_dispatch('Question?', false)).resolves.toBe('answer');
    await expect(pipe_dispatch('wc -l', Buffer.from('input'))).resolves.toEqual(Buffer.from('output'));
    await expect(shell_dispatch('pwd')).resolves.toBe(0);
    await expect(edit_dispatch('before', '.txt')).resolves.toEqual({ content: 'edited', changed: true });
    expect(() => close_dispatch()).toThrow('daemon disconnected');

    expect(stdout_spy).toHaveBeenCalledWith(expect.stringContaining('background output'));
    expect(prompt_mock).toHaveBeenCalledWith({ message: 'Question?', hidden: false });
    expect(pipeSegment_mock).toHaveBeenCalledWith('wc -l', Buffer.from('input'));
    expect(shellCommand_mock).toHaveBeenCalledWith('pwd');
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

describe('berth_fromAddress', () => {
  it('takes the ARGUS link the daemon prints, token and all', () => {
    // One thing to copy: the same URL that opens the web surface also names
    // the wire, because the daemon serves both on one port.
    const berth = berth_fromAddress('http://pangea:41234/?token=abc123');

    expect(berth).toEqual({
      identity: 'ws://pangea:41234 (attached by address)',
      url: 'ws://pangea:41234',
      token: 'abc123',
    });
  });

  it('takes a bare wire URL with the token beside it', () => {
    const berth = berth_fromAddress('ws://pangea:41234', 'abc123');

    expect(berth?.url).toBe('ws://pangea:41234');
    expect(berth?.token).toBe('abc123');
  });

  it('prefers an explicit token over one carried in the URL', () => {
    const berth = berth_fromAddress('http://pangea:41234/?token=stale', 'fresh');

    expect(berth?.token).toBe('fresh');
  });

  it('keeps TLS when the address is secure', () => {
    expect(berth_fromAddress('https://pangea/?token=t')?.url).toBe('wss://pangea');
    expect(berth_fromAddress('wss://pangea:9/?token=t')?.url).toBe('wss://pangea:9');
  });

  it('refuses an address with no token rather than attaching anonymously', () => {
    expect(berth_fromAddress('ws://pangea:41234')).toBeNull();
  });

  it('refuses something that is not a URL', () => {
    expect(berth_fromAddress('pangea:41234', 't')).toBeNull();
  });
});
