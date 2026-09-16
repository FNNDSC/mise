/**
 * @file A graph's view, as the lines that put it back.
 */
import { describe, it, expect } from '@jest/globals';
import { dagView_lines } from '../../src/features/dag/panel.js';

describe('dagView_lines', () => {
  it('says nothing for a graph at its defaults', () => {
    expect(dagView_lines({ layout: 'ranked', projection: '3d', scale: 'time', hue: 'status', census: 'shape' })).toEqual([]);
    expect(dagView_lines({ layout: '', projection: '', scale: '', hue: '', census: '' })).toEqual([]);
  });

  it('says only what the operator changed, in the frame\'s order', () => {
    expect(dagView_lines({ layout: 'molecule', projection: '2d', scale: 'size', hue: 'compute', census: 'census' }))
      .toEqual(['dag layout molecule', 'dag projection 2d', 'dag scale size', 'dag hue compute', 'dag census']);
    expect(dagView_lines({ layout: 'ranked', projection: '2d', scale: 'time', hue: 'status', census: 'shape' })).toEqual(['dag projection 2d']);
  });
});
