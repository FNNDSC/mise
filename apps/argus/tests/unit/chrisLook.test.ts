/**
 * @file A ChRIS node's look: errors always visible, a group hued by its
 * error share, the root cool unless it failed, work the accent, a stage
 * never run gold — and which stages the finish wave passes through.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { chrisLook_of, chrisPaint_of, chrisState_of, type ChrisLookInput } from '../../src/scene/chrisLook.js';

const node = (fields: Partial<ChrisLookInput> = {}): ChrisLookInput => ({ parentIds: ['p'], joinParentIds: [], ...fields });

describe('chrisState_of', () => {
  it('reads work, failure, a finish and rest from the status', () => {
    expect(chrisState_of(node({ status: 'started' }))).toBe('live');
    expect(chrisState_of(node({ status: 'registeringFiles' }))).toBe('live');
    expect(chrisState_of(node({ status: 'finishedWithError' }))).toBe('failed');
    expect(chrisState_of(node({ status: 'finishedSuccessfully' }))).toBe('done');
    expect(chrisState_of(node({ status: 'cancelled' }))).toBe('rest');
    expect(chrisState_of(node())).toBe('rest');
  });

  it('reads a group by its share: all failed is failed, any settled share is done', () => {
    expect(chrisState_of(node({ status: 'finishedSuccessfully', share: 1 }))).toBe('failed');
    expect(chrisState_of(node({ status: 'cancelled', share: 0.2 }))).toBe('done');
    expect(chrisState_of(node({ share: 0.2 }))).toBe('rest');
  });
});

describe('chrisPaint_of', () => {
  it('lets an error win over everything, the root and a host hue included', () => {
    expect(chrisPaint_of(node({ status: 'finishedWithError', hue: '#123', parentIds: [] }))).toEqual({ token: 'error' });
    expect(chrisPaint_of(node({ status: 'cancelled' }))).toEqual({ token: 'error' });
    expect(chrisPaint_of(node({ share: 1, status: 'finishedSuccessfully' }))).toEqual({ token: 'error' });
  });

  it('hues a group from done toward error by the root of its share, so a trace shows', () => {
    expect(chrisPaint_of(node({ share: 0.04, status: 'finishedSuccessfully' }))).toEqual({ blend: ['done', 'error'], share: 0.2 });
    expect(chrisPaint_of(node({ share: -1, status: 'finishedSuccessfully' }))).toEqual({ blend: ['done', 'error'], share: 0 });
  });

  it('takes a host hue, then the root, then the status', () => {
    expect(chrisPaint_of(node({ hue: '#abc', status: 'finishedSuccessfully' }))).toEqual({ hue: '#abc' });
    expect(chrisPaint_of(node({ parentIds: [], status: 'finishedSuccessfully' }))).toEqual({ token: 'root' });
    expect(chrisPaint_of(node({ parentIds: [], joinParentIds: ['j'], status: 'finishedSuccessfully' }))).toEqual({ token: 'done' });
    expect(chrisPaint_of(node())).toEqual({ token: 'template' });
    expect(chrisPaint_of(node({ status: 'scheduled' }))).toEqual({ token: 'running' });
    expect(chrisPaint_of(node({ status: 'somethingNew' }))).toEqual({ token: 'unknown' });
  });
});

describe('chrisLook_of', () => {
  it('marks failure as an ember, by status or by any share', () => {
    expect(chrisLook_of(node({ status: 'finishedWithError' })).ember).toBe(true);
    expect(chrisLook_of(node({ status: 'finishedSuccessfully', share: 0.01 })).ember).toBe(true);
    expect(chrisLook_of(node({ status: 'finishedSuccessfully', share: 0 })).ember).toBe(false);
  });

  it('lets the wave pass a finished stage or one never run, and wait at work or a cancel', () => {
    expect(chrisLook_of(node()).waved).toBe(true);
    expect(chrisLook_of(node({ status: 'finishedSuccessfully' })).waved).toBe(true);
    expect(chrisLook_of(node({ status: 'finishedWithError' })).waved).toBe(true);
    expect(chrisLook_of(node({ status: 'started' })).waved).toBe(false);
    expect(chrisLook_of(node({ status: 'cancelled' })).waved).toBe(false);
  });
});
