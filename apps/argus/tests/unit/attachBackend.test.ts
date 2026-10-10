/**
 * @file Which backend a session runs over, as ARGUS reads the attach answer.
 */
import { describe, it, expect } from '@jest/globals';
import { attachBackend_get } from '../../src/calypso/client.js';

describe('the attached backend', () => {
  it('is the daemon\'s word, and ChRIS from a daemon older than the word', () => {
    expect(attachBackend_get({ session: 's', protocolVersion: 1, backend: 'null' })).toBe('null');
    expect(attachBackend_get({ session: 's', protocolVersion: 1 })).toBe('chris');
  });
});
