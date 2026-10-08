/**
 * @file A login never lands on a kernel older than the door's: what a
 * berth says it runs against what the porter ships.
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { berth_behind, installed_read, porterVersion_read, versionReport_build, DOOR_PACKAGES } from '../../src/versions.js';

const berth = (versions?: Record<string, string>) => ({ identity: 'chris@https://cube/api/v1/', url: 'ws://127.0.0.1:1', token: 't', ...(versions === undefined ? {} : { versions }) });

describe('berth_behind', () => {
  it('names each package the daemon runs older than the door ships, and nothing when current', () => {
    const installed = { brasa: '0.33.0', calypso: '0.19.5', chell: '5.10.4' };
    expect(berth_behind(berth({ brasa: '0.33.0', calypso: '0.19.5', chell: '5.10.4' }), installed)).toEqual([]);
    expect(berth_behind(berth({ brasa: '0.31.5', calypso: '0.19.5', chell: '5.10.4' }), installed)).toEqual(['brasa 0.31.5 → 0.33.0']);
    expect(berth_behind(berth({ brasa: '0.31.5', calypso: '0.19.2' }), installed)).toEqual(['brasa 0.31.5 → 0.33.0', 'calypso 0.19.2 → 0.19.5']);
  });

  it('treats a berth without versions as behind (it predates the door that keeps them), and ignores packages the door cannot name', () => {
    expect(berth_behind(berth(), { brasa: '0.33.0' })).toHaveLength(1);
    expect(berth_behind(berth(), {})).toEqual([]);
    expect(berth_behind(berth({ brasa: '0.33.0', chell: '5.10.4' }), { brasa: '0.33.0' })).toEqual([]);
  });

  it('reads what this tree ships', () => {
    const installed = installed_read();
    expect(DOOR_PACKAGES.length).toBe(3);
    expect(typeof installed['calypso']).toBe('string');
  });
});

describe('porter --version', () => {
  it('says the door\'s version, then the session code it serves, one aligned line each', () => {
    expect(versionReport_build({ brasa: '0.33.3', calypso: '0.19.7', chell: '5.11.2' }, '0.6.3')).toBe([
      'porter   0.6.3',
      'brasa    0.33.3',
      'calypso  0.19.7',
      'chell    5.11.2',
    ].join('\n'));
  });

  it('reads its own version from its package', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(porterVersion_read()).toBe(manifest.version);
  });
});
