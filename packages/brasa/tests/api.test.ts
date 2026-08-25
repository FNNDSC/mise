/**
 * @file Tests for the typed chell API facade: each method must enter its
 * command core with faithfully translated options and return the core's
 * envelope with the declared model kind.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mkdirRun = jest.fn();
const touchRun = jest.fn();
const rmRun = jest.fn();
const pwdRun = jest.fn();
const cdRun = jest.fn();

jest.unstable_mockModule('../src/builtins/fs/mkdir.js', () => ({ mkdir_run: mkdirRun }));
jest.unstable_mockModule('../src/builtins/fs/touch.js', () => ({ touch_run: touchRun }));
jest.unstable_mockModule('../src/builtins/fs/rm.js', () => ({ rm_run: rmRun }));
jest.unstable_mockModule('../src/builtins/fs/pwd.js', () => ({ pwd_run: pwdRun }));
jest.unstable_mockModule('../src/builtins/fs/cd.js', () => ({ cd_run: cdRun }));
jest.unstable_mockModule('../src/session/index.js', () => ({ session: { init: jest.fn() } }));

const { chellApi_create } = await import('../src/api/index.js');

/** An envelope of the given kind, as a core would return it. */
function envelope_of(kind: string, data: unknown): object {
  return { status: 'ok', rendered: '', model: { kind, data } };
}

describe('chellApi_create', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pwd forwards the titles option and returns the fs.cwd envelope', async () => {
    pwdRun.mockResolvedValue(envelope_of('fs.cwd', { path: '/home/alice' }));
    const sh = await chellApi_create();
    const result = await sh.pwd({ titles: true });
    expect(pwdRun).toHaveBeenCalledWith({ titles: true });
    expect(result.model?.kind).toBe('fs.cwd');
    expect(result.model?.data.path).toBe('/home/alice');
  });

  it('cd forwards the path', async () => {
    cdRun.mockResolvedValue(envelope_of('fs.cwd', { path: '/x' }));
    const sh = await chellApi_create();
    await sh.cd('/x');
    expect(cdRun).toHaveBeenCalledWith({ path: '/x' });
    await sh.cd();
    expect(cdRun).toHaveBeenCalledWith({ path: undefined });
  });

  it('mkdir accepts one path or many', async () => {
    mkdirRun.mockResolvedValue(envelope_of('fs.mkdir', []));
    const sh = await chellApi_create();
    await sh.mkdir('a');
    expect(mkdirRun).toHaveBeenCalledWith({ paths: ['a'] });
    await sh.mkdir(['a', 'b']);
    expect(mkdirRun).toHaveBeenCalledWith({ paths: ['a', 'b'] });
  });

  it('touch carries the content options', async () => {
    touchRun.mockResolvedValue(envelope_of('fs.touch', [{ path: '/f', created: true }]));
    const sh = await chellApi_create();
    const result = await sh.touch('/f', { contents: 'hi' });
    expect(touchRun).toHaveBeenCalledWith({ paths: ['/f'], contents: 'hi', contentsFromFile: undefined });
    expect(result.model?.data[0]?.created).toBe(true);
  });

  it('rm translates options and never enables interactive mode', async () => {
    rmRun.mockResolvedValue(envelope_of('fs.rm', []));
    const sh = await chellApi_create();
    await sh.rm('scratch', { recursive: true, force: true });
    expect(rmRun).toHaveBeenCalledWith({ paths: ['scratch'], recursive: true, force: true, interactive: false });
    await sh.rm(['a', 'b']);
    expect(rmRun).toHaveBeenCalledWith({ paths: ['a', 'b'], recursive: false, force: false, interactive: false });
  });

  it('propagates an error-status envelope unchanged', async () => {
    rmRun.mockResolvedValue({ status: 'error', rendered: '', renderedErr: 'rm: no', model: { kind: 'fs.rm', data: [] } });
    const sh = await chellApi_create();
    const result = await sh.rm('nope');
    expect(result.status).toBe('error');
    expect(result.renderedErr).toBe('rm: no');
  });
});
