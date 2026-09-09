/**
 * @file The advertised host name is the fully qualified one when the
 * resolver knows it.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { hostFqdn_get, type HostResolvers } from '../src/daemon/host.js';

function resolvers_make(overrides: Partial<HostResolvers>): HostResolvers {
  return {
    hostname: (): string => 'pangea',
    lookup: async (): Promise<{ address: string }> => ({ address: '10.72.8.111' }),
    reverse: async (): Promise<string[]> => ['pangea.tch.harvard.edu'],
    ...overrides,
  };
}

describe('hostFqdn_get', () => {
  it('returns the fully qualified name the reverse record carries', async () => {
    expect(await hostFqdn_get(resolvers_make({}))).toBe('pangea.tch.harvard.edu');
  });

  it('prefers the first name with a domain when the reverse record lists several', async () => {
    expect(await hostFqdn_get(resolvers_make({
      reverse: async (): Promise<string[]> => ['pangea', 'pangea.tch.harvard.edu'],
    }))).toBe('pangea.tch.harvard.edu');
  });

  it('falls back to the bare hostname when the reverse record is bare too', async () => {
    expect(await hostFqdn_get(resolvers_make({ reverse: async (): Promise<string[]> => ['pangea'] }))).toBe('pangea');
  });

  it('falls back to the bare hostname when the resolver cannot answer', async () => {
    expect(await hostFqdn_get(resolvers_make({
      reverse: async (): Promise<string[]> => { throw new Error('ENOTFOUND'); },
    }))).toBe('pangea');
    expect(await hostFqdn_get(resolvers_make({
      lookup: async (): Promise<{ address: string }> => { throw new Error('ENOTFOUND'); },
    }))).toBe('pangea');
  });
});
