/**
 * @file A graph's view, as the lines that put it back.
 */
import { describe, it, expect } from '@jest/globals';
import { dagView_lines } from '../../src/features/dag/panel.js';

describe('dagView_lines', () => {
  it('says every mode in the form that sets it, then the selected job', () => {
    expect(dagView_lines({ layout: 'molecule', projection: '2d', scale: 'size', hue: 'compute', census: 'census', draw: 'stars', pulse: 'pulse on', gravity: 'gravity off', place: 'pl-dicom_repack_620500' }))
      .toEqual(['dag layout molecule', 'dag projection 2d', 'dag draw stars', 'dag pulse on', 'dag scale size', 'dag census on', 'dag gravity off', 'dag hue compute', 'dag select pl-dicom_repack_620500']);
    expect(dagView_lines({ layout: 'ranked', projection: '3d', scale: 'time', hue: 'status', census: 'shape' }))
      .toEqual(['dag layout ranked', 'dag projection 3d', 'dag scale time', 'dag census off', 'dag hue status']);
  });

  it('says nothing for a block that is absent', () => {
    expect(dagView_lines({ layout: '', projection: '', scale: '', hue: '', census: '', place: null })).toEqual([]);
  });
});
