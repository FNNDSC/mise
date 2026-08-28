/**
 * @file Characterization tests for the logo renderer.
 *
 * `logo_frameRender` and `logo_linesRender` are deterministic; these tests pin
 * their output against a golden fixture captured before the helper extraction,
 * guaranteeing the refactor is behaviour-preserving.
 *
 * @module
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  logo_frameRender,
  logo_linesRender,
  rows_count,
  logo_animatePulse,
  logo_animateStop,
  rowsPrinted_peek,
  rowsPrinted_track,
  rowsPrinted_untrack,
} from '../src/lib/logo.js';

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

describe('rows_count', () => {
  const columns_set = (width: number): void => {
    Object.defineProperty(process.stdout, 'columns', { value: width, configurable: true });
  };

  beforeEach(() => {
    columns_set(80);
    // Each case starts at column zero; the counter is module state.
    rows_count('\n');
  });

  it('counts a short line as one row', () => {
    expect(rows_count('hello\n')).toBe(1);
  });

  it('counts a wrapped line as the rows it actually occupies', () => {
    // The defect this exists for: a URL carrying a 64-character token wraps,
    // occupies three rows, and contributes one newline. An animation that
    // moves up by newlines then paints over two rows of real output.
    expect(rows_count(`${'x'.repeat(200)}\n`)).toBe(3);
  });

  it('ignores escapes, which occupy no columns', () => {
    expect(rows_count(`\x1b[32m${'x'.repeat(70)}\x1b[0m\n`)).toBe(1);
  });

  it('counts an exactly-full line as one row', () => {
    expect(rows_count(`${'x'.repeat(80)}\n`)).toBe(1);
  });

  it('counts an empty line as one row', () => {
    expect(rows_count('\n')).toBe(1);
  });

  it('carries an unterminated line into the next write', () => {
    // console.log emits its text and its newline together, but a bare
    // process.stdout.write need not, and the column position must survive.
    expect(rows_count('x'.repeat(60))).toBe(0);
    expect(rows_count(`${'x'.repeat(30)}\n`)).toBe(2);
  });

  it('counts several lines in one write', () => {
    expect(rows_count('a\nb\nc\n')).toBe(3);
  });

  it('follows a narrower terminal', () => {
    columns_set(20);
    rows_count('\n');
    expect(rows_count(`${'x'.repeat(60)}\n`)).toBe(3);
  });
});

describe('animation and the row counter', () => {
  beforeEach(() => {
    // The animation is a no-op off a TTY, so it must look like one here.
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
    jest.useFakeTimers();
  });

  it('does not count its own repaints', () => {
    // The animation repaints through stdout, and stdout is what the counter
    // hijacks. Counting its own output feeds the offset that positions it, so
    // every repaint pushes the next one further up — ten times a second, until
    // the logo climbs over everything above it.
    rowsPrinted_track();
    try {
      const before = rowsPrinted_peek();
      logo_animatePulse();
      jest.advanceTimersByTime(2000);
      logo_animateStop();
      expect(rowsPrinted_peek()).toBe(before);
    } finally {
      rowsPrinted_untrack();
    }
  });
});
