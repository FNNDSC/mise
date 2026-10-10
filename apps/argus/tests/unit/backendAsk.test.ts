/**
 * @file Which backend the session runs over, asked before the surface builds.
 */
import { describe, it, expect } from '@jest/globals';
import { backend_ask, backendUrl_build } from '../../src/calypso/routes.js';

const answering = (ok: boolean, body: unknown) => async (): Promise<{ ok: boolean; json(): Promise<unknown> }> => ({ ok, json: async () => body });

describe('asking the daemon its backend', () => {
  it('asks with the token, or bare behind a door that holds it', () => {
    expect(backendUrl_build('a b')).toBe('backend?token=a%20b');
    expect(backendUrl_build('')).toBe('backend');
  });

  it('is the daemon\'s word, and ChRIS from a daemon that cannot say', async () => {
    expect(await backend_ask('t', answering(true, { backend: 'null' }))).toBe('null');
    expect(await backend_ask('t', answering(true, { backend: null }))).toBe('chris');
    expect(await backend_ask('t', answering(false, null))).toBe('chris');
    expect(await backend_ask('t', async () => { throw new Error('offline'); })).toBe('chris');
  });
});
