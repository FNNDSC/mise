/**
 * @file The HOST lamp's title says what each host-control tier hands the
 * daemon: a `tasks`-only daemon is not described as running `!`.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { hostTiers_title } from '../../src/app/status.js';

describe('the HOST lamp title', () => {
  it('names each tier for what it hands the daemon, and is empty with none', () => {
    expect(hostTiers_title([])).toBe('');
    expect(hostTiers_title(['tasks'])).toBe('Calypso was started with --host-control: jobs may change the cloud and bill.');
    expect(hostTiers_title(['shell', 'files', 'pipes'])).toBe('Calypso was started with --host-control: `!` runs on its host; upload/download reach its disk; pipes run on its host.');
  });
});
