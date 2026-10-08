/**
 * @file porter starts when run, by its own path or through npm's bin link, and stays quiet when imported (#961).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { entry_isMain } from '../../src/entry.js';

let root: string;
let entry: string;
let entryUrl: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'porter-entry-'));
  mkdirSync(join(root, 'lib', 'dist'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  entry = join(root, 'lib', 'dist', 'porter.js');
  writeFileSync(entry, '');
  entryUrl = pathToFileURL(entry).href;
  // As npm links a bin: a name with no .js, relative, into the package.
  symlinkSync('../lib/dist/porter.js', join(root, 'bin', 'porter'));
  writeFileSync(join(root, 'lib', 'dist', 'other.js'), '');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('entry_isMain', () => {
  it('is the program run by its own path', () => {
    expect(entry_isMain(entry, entryUrl)).toBe(true);
  });

  it('is the program run through a bin link that does not end in porter.js (npm -g, npx, node_modules/.bin)', () => {
    expect(entry_isMain(join(root, 'bin', 'porter'), entryUrl)).toBe(true);
  });

  it('is not the program when another file was run (porter imported by it)', () => {
    expect(entry_isMain(join(root, 'lib', 'dist', 'other.js'), entryUrl)).toBe(false);
  });

  it('is not the program with no argv[1], or one that does not resolve', () => {
    expect(entry_isMain(undefined, entryUrl)).toBe(false);
    expect(entry_isMain(join(root, 'nowhere'), entryUrl)).toBe(false);
  });
});
