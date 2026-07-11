import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: jest.fn(async () => ({ user: 'chris', folder: '/home/chris' })),
}));
const mockStackPop = jest.fn(() => undefined as { message: string } | undefined);
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  errorStack: { stack_pop: mockStackPop },
  envelope_ok: (rendered: string, model?: unknown) =>
    model === undefined ? { status: 'ok', rendered } : { status: 'ok', rendered, model },
  envelope_error: (rendered: string, errors?: unknown, renderedErr?: string) => {
    const envelope: Record<string, unknown> = { status: 'error', rendered };
    if (errors !== undefined) envelope.errors = errors;
    if (renderedErr !== undefined) envelope.renderedErr = renderedErr;
    return envelope;
  },
}));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));
jest.unstable_mockModule('../src/session/index.js', () => ({ session: { getCWD: jest.fn(async () => '/home/chris') } }));

const mockCat = jest.fn();
const mockCatBinary = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/fs/cat.js', () => ({
  files_cat: mockCat,
  files_catBinary: mockCatBinary,
}));
const mockCatRender = jest.fn(() => 'RENDERED');
jest.unstable_mockModule('@fnndsc/chili/views/fs.js', () => ({ cat_render: mockCatRender }));

const ok = <T>(value: T) => ({ ok: true as const, value });
const err = () => ({ ok: false as const });

const { builtin_cat } = await import('../src/builtins/fs/cat.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('builtin_cat', () => {
  it('reports usage with no file argument', async () => {
    const envelope = await builtin_cat([]);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('Usage: cat');
  });

  it('renders a text file', async () => {
    mockCat.mockResolvedValue(ok('hello world'));
    const envelope = await builtin_cat(['notes.txt']);
    expect(mockCat).toHaveBeenCalledWith('/home/chris/notes.txt');
    expect(envelope.rendered).toContain('RENDERED');
  });

  it('reports a text read error and sets a non-zero exit code', async () => {
    mockCat.mockResolvedValue(err());
    mockStackPop.mockReturnValue({ message: 'not found' });
    const envelope = await builtin_cat(['ghost.txt']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('cat: ghost.txt');
    expect(process.exitCode).toBe(1);
  });

  it('writes raw bytes for --binary', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockCatBinary.mockResolvedValue(ok(Buffer.from('BIN')));
    await builtin_cat(['--binary', 'data.txt']);
    expect(mockCatBinary).toHaveBeenCalledWith('/home/chris/data.txt');
    expect(writeSpy).toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('auto-detects a binary file by extension', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockCatBinary.mockResolvedValue(ok(Buffer.from('DICOM')));
    await builtin_cat(['scan.dcm']);
    expect(mockCatBinary).toHaveBeenCalledWith('/home/chris/scan.dcm');
    expect(mockCat).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('reports a binary read error', async () => {
    mockCatBinary.mockResolvedValue(err());
    mockStackPop.mockReturnValue({ message: 'io error' });
    const envelope = await builtin_cat(['--binary', 'data.bin']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('io error');
    expect(process.exitCode).toBe(1);
  });
});

describe('builtin_cat — syntax highlighting on a TTY', () => {
  const origTTY = process.stdout.isTTY;
  beforeEach(() => { (process.stdout as { isTTY: boolean }).isTTY = true; });
  afterEach(() => { (process.stdout as { isTTY?: boolean }).isTTY = origTTY; });

  it('highlights a valid JSON file', async () => {
    mockCat.mockResolvedValue(ok('{"a": 1, "b": true, "c": null, "d": "x"}'));
    await builtin_cat(['config.json']);
    expect(mockCatRender).toHaveBeenCalled();
  });

  it('passes invalid JSON through unchanged', async () => {
    mockCat.mockResolvedValue(ok('{not json'));
    await builtin_cat(['broken.json']);
    expect(mockCatRender).toHaveBeenCalled();
  });

  it('highlights a YAML file with varied value types', async () => {
    mockCat.mockResolvedValue(ok('# comment\nflag: true\nempty: null\nnum: 42\nquoted: "hi"\nplain: text\n  - listitem\n'));
    await builtin_cat(['data.yaml']);
    expect(mockCatRender).toHaveBeenCalled();
  });
});
