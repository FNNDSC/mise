import { CONTRACT_VERSION, version_isCompatible } from '../src/protocol/version';

describe('contract version', () => {
  it('exposes a positive integer contract version', () => {
    expect(Number.isInteger(CONTRACT_VERSION)).toBe(true);
    expect(CONTRACT_VERSION).toBeGreaterThan(0);
  });

  it('accepts an exact-major match', () => {
    expect(version_isCompatible(CONTRACT_VERSION)).toBe(true);
  });

  it('refuses any other major', () => {
    expect(version_isCompatible(CONTRACT_VERSION + 1)).toBe(false);
    expect(version_isCompatible(CONTRACT_VERSION - 1)).toBe(false);
  });
});
