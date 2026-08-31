/**
 * @file Characterization tests for the brain art and its frame renderer.
 *
 * The renderer moved here from chell so any surface (the chell boot screen,
 * the calypso console face) can draw it. The golden fixture was captured
 * before the move; matching it proves the relocation is behaviour-preserving.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  logo_frameRender,
  logo_linesRender,
  logoRows_count,
  logoColumns_count,
} from '../src/logo/brain.js';

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
  it('reverse wraps every line in reverse video', () => {
    for (const line of logo_linesRender(true, true)) {
      expect(line.startsWith('\x1b[7m')).toBe(true);
      expect(line.endsWith('\x1b[0m')).toBe(true);
    }
  });
});

describe('frame geometry', () => {
  it('reports the height every frame actually has', () => {
    expect(logoRows_count()).toBe(logo_frameRender(0).length);
    expect(logoRows_count()).toBe(golden.f0.length);
  });

  it('reports a width no rendered plain line exceeds', () => {
    const widest: number = Math.max(
      ...logo_linesRender(false).map((line: string): number => line.length),
    );
    // Every frame line carries a two-column indent over the raw art.
    expect(logoColumns_count()).toBe(widest + 2);
  });
});
