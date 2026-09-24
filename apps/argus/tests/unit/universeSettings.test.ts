/**
 * @file The universe frame's four choices are kept per identity, and a
 * record that is missing, old or damaged never leaves the frame half-set.
 */
import { describe, it, expect } from '@jest/globals';
import { UNIVERSE_SETTINGS_DEFAULT, universeSettings_of, universeSettings_parse } from '../../src/features/dag/universe.js';

describe('universeSettings_parse', () => {
  it('opens a first visit as stars, every feed, sized by jobs, a sphere per stage', () => {
    expect(universeSettings_parse(null)).toEqual({ draw: 'stars', view: 'feeds', scale: 'jobs', density: 'shape', arrangement: 'galaxy' });
    expect(UNIVERSE_SETTINGS_DEFAULT.draw).toBe('stars');
  });

  it('keeps what was chosen', () => {
    const kept: string = JSON.stringify(universeSettings_of('spheres', 'shapes', 'feeds', 'census', 'clumps'));
    expect(universeSettings_parse(kept)).toEqual({ draw: 'spheres', view: 'shapes', scale: 'feeds', density: 'census', arrangement: 'clumps' });
  });

  it('takes the default for anything missing or unrecognised, and survives a damaged record', () => {
    expect(universeSettings_parse(JSON.stringify({ draw: 'spheres', view: 'nebulae' }))).toEqual({ draw: 'spheres', view: 'feeds', scale: 'jobs', density: 'shape', arrangement: 'galaxy' });
    expect(universeSettings_parse('{not json')).toEqual(UNIVERSE_SETTINGS_DEFAULT);
    expect(universeSettings_parse('[1,2]')).toEqual(UNIVERSE_SETTINGS_DEFAULT);
  });
});
