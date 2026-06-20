/**
 * @file Unit tests for the pure boot-flags derivation.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { bootFlags_compute } from '../src/core/bootFlags.js';

describe('bootFlags_compute', () => {
  it('enables interactive defaults on a TTY', () => {
    const f = bootFlags_compute({ mode: 'interactive' } as any, true);
    expect(f).toEqual({
      isInteractiveSession: true,
      useAsciiBoot: false,
      prefetchPlugins: true,
      prefetchFeeds: true,
      prefetchPublicFeeds: true,
      prefetchJobs: true,
      showLogo: true,
    });
  });

  it('forces ASCII boot and hides the logo when not a TTY', () => {
    const f = bootFlags_compute({ mode: 'interactive' } as any, false);
    expect(f.useAsciiBoot).toBe(true);
    expect(f.showLogo).toBe(false);
  });

  it('disables prefetch/logo for execute mode', () => {
    const f = bootFlags_compute({ mode: 'execute' } as any, true);
    expect(f.isInteractiveSession).toBe(false);
    expect(f.prefetchPlugins).toBe(false);
    expect(f.prefetchFeeds).toBe(false);
    expect(f.prefetchPublicFeeds).toBe(false);
    expect(f.prefetchJobs).toBe(false);
    expect(f.showLogo).toBe(false);
  });

  it('publicFeeds requires feeds to be on', () => {
    const f = bootFlags_compute({ mode: 'interactive', prefetchFeeds: false } as any, true);
    expect(f.prefetchFeeds).toBe(false);
    expect(f.prefetchPublicFeeds).toBe(false);
  });

  it('honours explicit opt-outs', () => {
    const f = bootFlags_compute({ mode: 'interactive', prefetchPlugins: false, showLogo: false } as any, true);
    expect(f.prefetchPlugins).toBe(false);
    expect(f.showLogo).toBe(false);
    expect(f.prefetchJobs).toBe(true);
  });
});
