/**
 * @file Characterization tests for the logo renderer.
 *
 * `logo_frameRender` and `logo_linesRender` are deterministic; these tests pin
 * their output against a golden fixture captured before the helper extraction,
 * guaranteeing the refactor is behaviour-preserving.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { logo_frameRender, logo_linesRender } from '../src/lib/logo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(path.join(__dirname, 'fixtures-logo.json'), 'utf-8'));

describe('logo_frameRender (characterization)', () => {
  it('frame 0 matches golden', () => {
    expect(logo_frameRender(0)).toEqual(golden.f0);
  });
  it('frame 7 matches golden', () => {
    expect(logo_frameRender(7)).toEqual(golden.f7);
  });
  it('frame 13 matches golden', () => {
    expect(logo_frameRender(13)).toEqual(golden.f13);
  });
  it('static end-state matches golden', () => {
    expect(logo_frameRender(0, true)).toEqual(golden.static);
  });
});

describe('logo_linesRender (characterization)', () => {
  it('plain matches golden', () => {
    expect(logo_linesRender(false)).toEqual(golden.linesPlain);
  });
  it('color matches golden', () => {
    expect(logo_linesRender(true)).toEqual(golden.linesColor);
  });
});
