/**
 * @file User-visible behavior tests for the `cat` builtin.
 *
 * Mocks the ChRIS file boundary while exercising the exported builtin through
 * text, binary, TTY, forced-language, and disabled-highlighting paths.
 *
 * @module
 */

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
beforeEach((): void => {
  jest.clearAllMocks();
  process.exitCode = 0;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('builtin_cat', (): void => {
  it('reports usage with no file argument', async (): Promise<void> => {
    const envelope = await builtin_cat([]);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('Usage: cat');
  });

  it('renders a text file', async (): Promise<void> => {
    mockCat.mockResolvedValue(ok('hello world'));
    const envelope = await builtin_cat(['notes.txt']);
    expect(mockCat).toHaveBeenCalledWith('/home/chris/notes.txt');
    expect(envelope.rendered).toContain('RENDERED');
  });

  it('reports a text read error and sets a non-zero exit code', async (): Promise<void> => {
    mockCat.mockResolvedValue(err());
    mockStackPop.mockReturnValue({ message: 'not found' });
    const envelope = await builtin_cat(['ghost.txt']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('cat: ghost.txt');
    expect(process.exitCode).toBe(1);
  });

  it('writes raw bytes for --binary', async (): Promise<void> => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockCatBinary.mockResolvedValue(ok(Buffer.from('BIN')));
    await builtin_cat(['--binary', 'data.txt']);
    expect(mockCatBinary).toHaveBeenCalledWith('/home/chris/data.txt');
    expect(writeSpy).toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('auto-detects a binary file by extension', async (): Promise<void> => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockCatBinary.mockResolvedValue(ok(Buffer.from('DICOM')));
    await builtin_cat(['scan.dcm']);
    expect(mockCatBinary).toHaveBeenCalledWith('/home/chris/scan.dcm');
    expect(mockCat).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('reports a binary read error', async (): Promise<void> => {
    mockCatBinary.mockResolvedValue(err());
    mockStackPop.mockReturnValue({ message: 'io error' });
    const envelope = await builtin_cat(['--binary', 'data.bin']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('io error');
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ['explicit binary mode', ['--binary', '--highlight=madeup', 'data.custom']],
    ['an auto-detected binary extension', ['--highlight=madeup', 'scan.dcm']],
  ])('ignores an unsupported highlight language for %s', async (
    _scenario: string,
    args: string[],
  ): Promise<void> => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockCatBinary.mockResolvedValue(ok(Buffer.from('RAW')));
    const envelope = await builtin_cat(args);
    expect(envelope.status).toBe('ok');
    expect(mockCatBinary).toHaveBeenCalledTimes(1);
    expect(mockCat).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

describe('builtin_cat — syntax highlighting on a TTY', (): void => {
  const origTTY = process.stdout.isTTY;
  beforeEach((): void => { (process.stdout as { isTTY: boolean }).isTTY = true; });
  afterEach((): void => { (process.stdout as { isTTY?: boolean }).isTTY = origTTY; });

  it('highlights a valid JSON file', async (): Promise<void> => {
    mockCat.mockResolvedValue(ok('{"a": 1, "b": true, "c": null, "d": "x"}'));
    await builtin_cat(['config.json']);
    expect(mockCatRender).toHaveBeenCalled();
  });

  it('renders malformed JSON without failing', async (): Promise<void> => {
    mockCat.mockResolvedValue(ok('{not json'));
    const envelope = await builtin_cat(['broken.json']);
    expect(envelope.status).toBe('ok');
  });

  it('highlights a YAML file with varied value types', async (): Promise<void> => {
    mockCat.mockResolvedValue(ok('# comment\nflag: true\nempty: null\nnum: 42\nquoted: "hi"\nplain: text\n  - listitem\n'));
    await builtin_cat(['data.yaml']);
    expect(mockCatRender).toHaveBeenCalled();
  });

  it('automatically highlights Python source on a TTY', async (): Promise<void> => {
    mockCat.mockResolvedValue(ok('def greet(name):\n    return f"hello {name}"\n'));
    await builtin_cat(['greet.py']);
    const renderedContent: string = mockCatRender.mock.calls[0]?.[0] as string;
    expect(renderedContent).toContain('\u001b[');
  });

  it('automatically highlights TypeScript source on a TTY', async (): Promise<void> => {
    mockCat.mockResolvedValue(ok('const answer: number = 42;\n'));
    await builtin_cat(['answer.ts']);
    const renderedContent: string = mockCatRender.mock.calls[0]?.[0] as string;
    expect(renderedContent).toContain('\u001b[');
  });

  it.each([
    ['app.js', 'const name = "mise";\n'],
    ['script.sh', 'if true; then echo "ok"; fi\n'],
    ['query.sql', 'SELECT * FROM users WHERE id = 1;\n'],
    ['README.md', '# Heading\n\nSome **strong** text.\n'],
    ['index.html', '<main class="app">hello</main>\n'],
    ['theme.css', '.app { color: red; }\n'],
    ['settings.toml', '[shell]\ntheme = "p10k"\n'],
    ['main.cpp', 'int main() { return 0; }\n'],
    ['Main.java', 'public class Main {}\n'],
    ['main.go', 'package main\nfunc main() {}\n'],
    ['main.rs', 'fn main() { let answer = 42; }\n'],
    ['task.rb', 'def run\n  puts "ok"\nend\n'],
    ['Dockerfile', 'FROM node:22\nRUN npm test\n'],
    ['Makefile', 'build:\n\tnpm run build\n'],
  ])('automatically highlights popular format %s', async (
    filename: string,
    source: string,
  ): Promise<void> => {
    mockCat.mockResolvedValue(ok(source));
    await builtin_cat([filename]);
    const renderedContent: string = mockCatRender.mock.calls[0]?.[0] as string;
    expect(renderedContent).toContain('\u001b[');
  });

  it('forces an explicit language when output is not a TTY', async (): Promise<void> => {
    (process.stdout as { isTTY: boolean }).isTTY = false;
    mockCat.mockResolvedValue(ok('def greet(name):\n    return name\n'));
    await builtin_cat(['source', '--highlight=python']);
    const renderedContent: string = mockCatRender.mock.calls[0]?.[0] as string;
    expect(renderedContent).toContain('\u001b[');
    expect(mockCat).toHaveBeenCalledTimes(1);
  });

  it('forces extension-inferred highlighting with a bare flag', async (): Promise<void> => {
    (process.stdout as { isTTY: boolean }).isTTY = false;
    mockCat.mockResolvedValue(ok('def greet():\n    return 42\n'));
    await builtin_cat(['greet.py', '--highlight']);
    const renderedContent: string = mockCatRender.mock.calls[0]?.[0] as string;
    expect(renderedContent).toContain('\u001b[');
    expect(mockCat).toHaveBeenCalledTimes(1);
  });

  it('lets a later bare --highlight restore filename inference', async (): Promise<void> => {
    (process.stdout as { isTTY: boolean }).isTTY = false;
    mockCat.mockResolvedValue(ok('const answer = 42;\n'));
    await builtin_cat(['answer.js', '--highlight=python', '--highlight']);
    const renderedContent: string = mockCatRender.mock.calls[0]?.[0] as string;
    expect(renderedContent).toContain('\u001b[');
  });

  it('suppresses automatic highlighting with --no-highlight', async (): Promise<void> => {
    const source: string = 'def greet():\n    return 42\n';
    mockCat.mockResolvedValue(ok(source));
    await builtin_cat(['greet.py', '--no-highlight']);
    expect(mockCatRender).toHaveBeenCalledWith(source, 'greet.py');
    expect(mockCat).toHaveBeenCalledTimes(1);
  });

  it('keeps automatic highlighting raw when output is not a TTY', async (): Promise<void> => {
    (process.stdout as { isTTY: boolean }).isTTY = false;
    const source: string = 'def greet():\n    return 42\n';
    mockCat.mockResolvedValue(ok(source));
    await builtin_cat(['greet.py']);
    expect(mockCatRender).toHaveBeenCalledWith(source, 'greet.py');
  });

  it('auto-detects content when a forced file has no recognized name', async (): Promise<void> => {
    (process.stdout as { isTTY: boolean }).isTTY = false;
    mockCat.mockResolvedValue(ok('def greet():\n    return 42\n'));
    await builtin_cat(['source', '--highlight']);
    const renderedContent: string = mockCatRender.mock.calls[0]?.[0] as string;
    expect(renderedContent).toContain('\u001b[');
  });

  it('reports an unsupported explicit language without reading the file', async (): Promise<void> => {
    const envelope = await builtin_cat(['source', '--highlight=madeup']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain("unknown highlight language 'madeup'");
    expect(mockCat).not.toHaveBeenCalled();
  });
});
