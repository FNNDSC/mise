/**
 * @file The attach splash follows the session's backend.
 *
 * @module
 */
import { describe, expect, it } from '@jest/globals';
import { logo_frameRender, logo_linesRender } from '@fnndsc/menu/logo';
import { tdMark_linesRender } from '@fnndsc/menu/logo/td';
import { splashLines_of } from '../src/remote/splash.js';

describe('splashLines_of', () => {
  it('draws the brain for a ChRIS session, and for a daemon that names no backend', () => {
    expect(splashLines_of('chris', true)).toEqual(logo_frameRender(0, true));
    expect(splashLines_of(undefined, true)).toEqual(logo_frameRender(0, true));
    expect(splashLines_of('chris', false)).toEqual(logo_linesRender(false));
  });

  it('draws the Trusted Domain mark for a stratus session, in colour when asked', () => {
    const coloured: string[] = splashLines_of('stratus', true);
    expect(coloured).toEqual(tdMark_linesRender(true));
    // The ring in Oracle red, the star in blue.
    expect(coloured.join('\n')).toContain('\x1b[38;2;199;70;52m');
    expect(coloured.join('\n')).toContain('\x1b[38;2;122;211;241m');
    expect(splashLines_of('stratus', false)).toEqual(tdMark_linesRender(false));
    expect(splashLines_of('stratus', false).join('\n')).not.toContain('\x1b[');
  });

  it('draws nothing for another backend', () => {
    expect(splashLines_of('null', true)).toEqual([]);
  });
});
