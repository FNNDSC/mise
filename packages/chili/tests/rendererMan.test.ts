/**
 * Tests for the man-page renderer. asciidoctor is stubbed (its Opal runtime
 * doesn't initialise under jest) so we drive controlled HTML through the render
 * transforms; fs + exec are stubbed for browser_open. chalk is auto-mocked
 * (single-chain styles keep text, double-chain styles are stripped).
 */
const mockConvert = jest.fn();
jest.mock('asciidoctor', () => jest.fn(() => ({ convert: mockConvert })));
jest.mock('child_process');

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { projectDir_get, asciidoc_render, browser_open } from '../src/man/renderer';

const RICH_HTML =
  '<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4>' +
  '<p>Some <code>inline</code> and <em>emphasis</em> and <a href="x">link</a> words here to wrap.</p>';

beforeEach(() => {
  jest.clearAllMocks();
  mockConvert.mockReturnValue(RICH_HTML);
});

describe('projectDir_get', () => {
  it('walks up to a directory containing package.json', () => {
    const dir = projectDir_get();
    expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(true);
  });
});

describe('asciidoc_render', () => {
  it('renders headings and inline formatting (ascii style), stripping html', async () => {
    const out = await asciidoc_render('=== ignored', 'ascii');
    expect(out).toContain('ONE'); // h1 uppercased
    expect(out).toContain('Three'); // h3 kept
    expect(out).toContain('inline'); // <code>
    expect(out).toContain('emphasis'); // <em>
    expect(out).toContain('link'); // <a> unwrapped
    expect(out).not.toContain('<h1');
  });

  it('renders headings in figlet style', async () => {
    const out = await asciidoc_render('x', 'figlet');
    expect(out).toContain('One');
    expect(out).toContain('Three');
  });

  it('wraps text to the requested width', async () => {
    const out = await asciidoc_render('x', 'ascii', 12);
    expect(out).toContain('\n');
  });
});

describe('browser_open', () => {
  let readSpy: jest.SpyInstance;
  let writeSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    readSpy = jest.spyOn(fs, 'readFileSync');
    writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('converts the doc, writes html and launches the browser', () => {
    readSpy.mockReturnValue('= Title\n\nBody.');
    browser_open('/docs/topic.adoc');
    expect(writeSpy).toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith(expect.stringMatching(/(open|xdg-open|start) /), expect.any(Function));
  });

  it('reports an error when the exec callback fails', () => {
    readSpy.mockReturnValue('= Title');
    (exec as unknown as jest.Mock).mockImplementation((_cmd: string, cb: (e: Error) => void) => cb(new Error('no browser')));
    browser_open('/docs/topic.adoc');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Error opening browser'), expect.anything());
  });

  it('reports an error when the file cannot be read', () => {
    readSpy.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    browser_open('/docs/missing.adoc');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Error opening documentation'), 'ENOENT');
  });
});
