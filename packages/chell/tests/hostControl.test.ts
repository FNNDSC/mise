/**
 * @file The attach banner says what each host-control tier hands the daemon.
 */
import { describe, it, expect } from '@jest/globals';
import { hostControl_phrase } from '../src/remote/hostControl.js';

describe('the host-control banner phrase', () => {
  it('names each tier for what it hands the daemon, in the order given', () => {
    expect(hostControl_phrase(['tasks'])).toBe('jobs may change the cloud and bill');
    expect(hostControl_phrase(['shell', 'files', 'pipes'])).toBe("`!` runs on calypso's host, upload/download reach ITS disk, pipes run on calypso's host");
    expect(hostControl_phrase(['later'])).toBe('later');
  });
});
