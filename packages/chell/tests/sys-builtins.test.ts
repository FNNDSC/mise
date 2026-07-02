import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockContext = jest.fn();
jest.unstable_mockModule('@fnndsc/salsa', () => ({ context_getSingle: mockContext }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({}));

const mockSession = {
  timingEnabled_get: jest.fn(),
  timingEnabled_set: jest.fn(),
};
jest.unstable_mockModule('../src/session/index.js', () => ({ session: mockSession }));

const { builtin_whoami, builtin_whereami } = await import('../src/builtins/sys/whoami.js');
const { builtin_timing } = await import('../src/builtins/sys/timing.js');

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
