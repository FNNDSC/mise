import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { CommandEnvelope } from '@fnndsc/cumin';

const mockContext = jest.fn();
const mockFeedsList = jest.fn();
const mockInstancesList = jest.fn();
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: mockContext,
  feeds_list: mockFeedsList,
  pluginInstances_list: mockInstancesList,
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string, model?: unknown) =>
    model === undefined ? { status: 'ok', rendered } : { status: 'ok', rendered, model },
  envelope_error: (rendered: string, errors?: unknown, renderedErr?: string) => {
    const envelope: Record<string, unknown> = { status: 'error', rendered };
    if (errors !== undefined) envelope.errors = errors;
    if (renderedErr !== undefined) envelope.renderedErr = renderedErr;
    return envelope;
  },
}));

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
const { builtin_version } = await import('../src/builtins/sys/version.js');
const { versions_get, versionReport_build } = await import('../src/core/version.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('builtin_whoami', () => {
  it('reports the connected user in the envelope', async () => {
    mockContext.mockResolvedValue({ user: 'chris' });
    const envelope: CommandEnvelope = await builtin_whoami([]);
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('chris');
    expect(envelope.model).toEqual({ kind: 'session.identity', data: { user: 'chris' } });
    expect(process.exitCode).toBe(0);
  });
  it('reports not-connected with a non-zero exit code', async () => {
    mockContext.mockResolvedValue({ user: null });
    const envelope: CommandEnvelope = await builtin_whoami([]);
    expect(envelope.status).toBe('error');
    expect(envelope.rendered).toContain('not connected');
    expect(process.exitCode).toBe(1);
  });
});

describe('builtin_whereami', () => {
  it('reports the CUBE URL in the envelope', async () => {
    mockContext.mockResolvedValue({ URL: 'http://c/api/' });
    const envelope: CommandEnvelope = await builtin_whereami([]);
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('http://c/api/');
    expect(envelope.model).toEqual({ kind: 'session.cube', data: { url: 'http://c/api/' } });
  });
  it('reports not-connected when no URL', async () => {
    mockContext.mockResolvedValue({ URL: null });
    const envelope: CommandEnvelope = await builtin_whereami([]);
    expect(envelope.status).toBe('error');
    expect(process.exitCode).toBe(1);
  });
});

describe('builtin_timing', () => {
  it('shows enabled status with no argument', async () => {
    mockSession.timingEnabled_get.mockReturnValue(true);
    const envelope: CommandEnvelope = await builtin_timing([]);
    expect(envelope.rendered).toContain('enabled');
    expect(envelope.model).toEqual({ kind: 'sys.timing', data: { enabled: true } });
  });
  it('shows disabled status with no argument', async () => {
    mockSession.timingEnabled_get.mockReturnValue(false);
    const envelope: CommandEnvelope = await builtin_timing([]);
    expect(envelope.rendered).toContain('disabled');
  });
  it('turns timing on', async () => {
    const envelope: CommandEnvelope = await builtin_timing(['on']);
    expect(mockSession.timingEnabled_set).toHaveBeenCalledWith(true);
    expect(envelope.model).toEqual({ kind: 'sys.timing', data: { enabled: true } });
  });
  it('turns timing off', async () => {
    const envelope: CommandEnvelope = await builtin_timing(['off']);
    expect(mockSession.timingEnabled_set).toHaveBeenCalledWith(false);
    expect(envelope.model).toEqual({ kind: 'sys.timing', data: { enabled: false } });
  });
  it('rejects an unknown argument', async () => {
    const envelope: CommandEnvelope = await builtin_timing(['sideways']);
    expect(envelope.status).toBe('error');
    expect(envelope.rendered).toContain('Unknown argument');
  });
});

describe('builtin_physicalmode', () => {
  it('shows status with no argument', async () => {
    mockSession.physicalMode_get.mockReturnValue(true);
    const envelope: CommandEnvelope = await builtin_physicalmode([]);
    expect(envelope.rendered).toContain('enabled');
    expect(envelope.model).toEqual({ kind: 'sys.physicalMode', data: { enabled: true } });
  });
  it('turns physical mode on and off', async () => {
    const onEnvelope: CommandEnvelope = await builtin_physicalmode(['on']);
    expect(mockSession.physicalMode_set).toHaveBeenCalledWith(true);
    expect(onEnvelope.model).toEqual({ kind: 'sys.physicalMode', data: { enabled: true } });
    const offEnvelope: CommandEnvelope = await builtin_physicalmode(['off']);
    expect(mockSession.physicalMode_set).toHaveBeenCalledWith(false);
    expect(offEnvelope.model).toEqual({ kind: 'sys.physicalMode', data: { enabled: false } });
  });
  it('rejects an unknown argument', async () => {
    const envelope: CommandEnvelope = await builtin_physicalmode(['sideways']);
    expect(envelope.status).toBe('error');
    expect(envelope.rendered).toContain('Unknown argument');
  });
});

describe('builtin_debug', () => {
  beforeEach(() => {
    mockSession.connection.config = { debug: false };
  });

  it('errors when the connection config is missing', async () => {
    mockSession.connection.config = null;
    const envelope: CommandEnvelope = await builtin_debug([]);
    expect(envelope.status).toBe('error');
    expect(envelope.errors?.[0].message).toContain('not initialized');
  });
  it('shows status with no argument', async () => {
    const envelope: CommandEnvelope = await builtin_debug([]);
    expect(envelope.rendered).toContain('Debug mode');
    expect(envelope.model).toEqual({ kind: 'sys.debug', data: { enabled: false } });
  });
  it('turns debug on and off', async () => {
    await builtin_debug(['on']);
    expect(mockSession.connection.config?.debug).toBe(true);
    await builtin_debug(['off']);
    expect(mockSession.connection.config?.debug).toBe(false);
  });
  it('rejects an unknown argument', async () => {
    const envelope: CommandEnvelope = await builtin_debug(['sideways']);
    expect(envelope.status).toBe('error');
    expect(envelope.rendered).toContain('Unknown argument');
  });
});

describe('builtin_pwd', () => {
  it('reports the raw cwd without --title', async () => {
    mockSession.getCWD.mockResolvedValue('/home/chris/uploads');
    const envelope: CommandEnvelope = await builtin_pwd([]);
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toBe('/home/chris/uploads\n');
    expect(envelope.model?.kind).toBe('fs.cwd');
  });

  it('replaces feed and plugin segments with titles for --title', async () => {
    mockSession.getCWD.mockResolvedValue('/home/chris/feeds/feed_123/pl-dircopy_456');
    mockFeedsList.mockResolvedValue({ tableData: [{ name: 'Brain Study' }] });
    mockInstancesList.mockResolvedValue({ tableData: [{ plugin_name: 'pl-dircopy', plugin_version: '2.1.1' }] });
    const envelope: CommandEnvelope = await builtin_pwd(['--title']);
    expect(envelope.rendered).toBe('/home/chris/feeds/Brain Study/pl-dircopy v2.1.1\n');
  });
});

describe('builtin_version', () => {
  it('resolves a version for every stack layer', () => {
    const versions: Record<string, string> = versions_get();
    for (const layer of ['chell', 'chili', 'salsa', 'cumin']) {
      expect(typeof versions[layer]).toBe('string');
      expect(versions[layer].length).toBeGreaterThan(0);
    }
  });

  it('builds a report naming chell and each sandwich layer', () => {
    const report: string = versionReport_build();
    for (const layer of ['chell', 'chili', 'salsa', 'cumin']) {
      expect(report).toContain(layer);
    }
  });

  it('yields an ok envelope carrying the report and a typed model', async () => {
    const envelope: CommandEnvelope = await builtin_version([]);
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('chell');
    expect(envelope.model?.kind).toBe('sys.version');
    expect((envelope.model?.data as { cumin: string }).cumin).toBe(versions_get().cumin);
  });
});
