import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockContext = jest.fn();
const mockFeedsList = jest.fn();
const mockInstancesList = jest.fn();
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: mockContext,
  feeds_list: mockFeedsList,
  pluginInstances_list: mockInstancesList,
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({}));

const mockSession = {
  timingEnabled_get: jest.fn(),
  timingEnabled_set: jest.fn(),
  physicalMode_get: jest.fn(),
  physicalMode_set: jest.fn(),
  getCWD: jest.fn(),
  connection: { config: { debug: false } as { debug: boolean } | null },
};
jest.unstable_mockModule('../src/session/index.js', () => ({ session: mockSession }));

const { builtin_whoami, builtin_whereami } = await import('../src/builtins/sys/whoami.js');
const { builtin_timing } = await import('../src/builtins/sys/timing.js');
const { builtin_physicalmode } = await import('../src/builtins/sys/physicalmode.js');
const { builtin_debug } = await import('../src/builtins/debug.js');
const { builtin_pwd } = await import('../src/builtins/fs/pwd.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('builtin_whoami', () => {
  it('prints the connected user', async () => {
    mockContext.mockResolvedValue({ user: 'chris' });
    await builtin_whoami([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('chris'));
    expect(process.exitCode).toBe(0);
  });
  it('reports not-connected with a non-zero exit code', async () => {
    mockContext.mockResolvedValue({ user: null });
    await builtin_whoami([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not connected'));
    expect(process.exitCode).toBe(1);
  });
});

describe('builtin_whereami', () => {
  it('prints the CUBE URL', async () => {
    mockContext.mockResolvedValue({ URL: 'http://c/api/' });
    await builtin_whereami([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('http://c/api/'));
  });
  it('reports not-connected when no URL', async () => {
    mockContext.mockResolvedValue({ URL: null });
    await builtin_whereami([]);
    expect(process.exitCode).toBe(1);
  });
});

describe('builtin_timing', () => {
  it('shows enabled status with no argument', async () => {
    mockSession.timingEnabled_get.mockReturnValue(true);
    await builtin_timing([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('enabled'));
  });
  it('shows disabled status with no argument', async () => {
    mockSession.timingEnabled_get.mockReturnValue(false);
    await builtin_timing([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('disabled'));
  });
  it('turns timing on', async () => {
    await builtin_timing(['on']);
    expect(mockSession.timingEnabled_set).toHaveBeenCalledWith(true);
  });
  it('turns timing off', async () => {
    await builtin_timing(['off']);
    expect(mockSession.timingEnabled_set).toHaveBeenCalledWith(false);
  });
  it('rejects an unknown argument', async () => {
    await builtin_timing(['sideways']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown argument'));
  });
});

describe('builtin_physicalmode', () => {
  it('shows status with no argument', async () => {
    mockSession.physicalMode_get.mockReturnValue(true);
    await builtin_physicalmode([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('enabled'));
  });
  it('turns physical mode on and off', async () => {
    await builtin_physicalmode(['on']);
    expect(mockSession.physicalMode_set).toHaveBeenCalledWith(true);
    await builtin_physicalmode(['off']);
    expect(mockSession.physicalMode_set).toHaveBeenCalledWith(false);
  });
  it('rejects an unknown argument', async () => {
    await builtin_physicalmode(['sideways']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown argument'));
  });
});

describe('builtin_debug', () => {
  let errSpy: jest.SpiedFunction<typeof console.error>;
  beforeEach(() => {
    mockSession.connection.config = { debug: false };
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('errors when the connection config is missing', async () => {
    mockSession.connection.config = null;
    await builtin_debug([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('not initialized'));
  });
  it('shows status with no argument', async () => {
    await builtin_debug([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Debug mode'));
  });
  it('turns debug on and off', async () => {
    await builtin_debug(['on']);
    expect(mockSession.connection.config?.debug).toBe(true);
    await builtin_debug(['off']);
    expect(mockSession.connection.config?.debug).toBe(false);
  });
  it('rejects an unknown argument', async () => {
    await builtin_debug(['sideways']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown argument'));
  });
});

describe('builtin_pwd', () => {
  it('prints the raw cwd without --title', async () => {
    mockSession.getCWD.mockResolvedValue('/home/chris/uploads');
    await builtin_pwd([]);
    expect(logSpy).toHaveBeenCalledWith('/home/chris/uploads');
  });

  it('replaces feed and plugin segments with titles for --title', async () => {
    mockSession.getCWD.mockResolvedValue('/home/chris/feeds/feed_123/pl-dircopy_456');
    mockFeedsList.mockResolvedValue({ tableData: [{ name: 'Brain Study' }] });
    mockInstancesList.mockResolvedValue({ tableData: [{ plugin_name: 'pl-dircopy', plugin_version: '2.1.1' }] });
    await builtin_pwd(['--title']);
    expect(logSpy).toHaveBeenCalledWith('/home/chris/feeds/Brain Study/pl-dircopy v2.1.1');
  });
});
