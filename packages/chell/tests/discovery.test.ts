/**
 * @file Tests for same-user daemon discovery (path, write, read).
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import { rmSync, writeFileSync } from 'fs';
import { discovery_path, discovery_write, discovery_read } from '../src/remote/discovery.js';

afterEach(() => {
  rmSync(discovery_path(), { force: true });
});

describe('discovery', () => {
  it('derives a per-user path under the temp directory', () => {
    expect(discovery_path()).toContain('chell-calypso-');
  });

  it('round-trips the url and token', () => {
    discovery_write({ url: 'ws://127.0.0.1:4321', token: 'abc123' });
    expect(discovery_read()).toEqual({ url: 'ws://127.0.0.1:4321', token: 'abc123' });
  });

  it('returns null when no daemon has advertised', () => {
    rmSync(discovery_path(), { force: true });
    expect(discovery_read()).toBeNull();
  });

  it('returns null for a malformed or incomplete discovery file', () => {
    writeFileSync(discovery_path(), 'not json');
    expect(discovery_read()).toBeNull();
    writeFileSync(discovery_path(), JSON.stringify({ url: 'ws://x' }));
    expect(discovery_read()).toBeNull();
  });
});
