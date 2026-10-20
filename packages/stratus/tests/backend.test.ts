/**
 * @file The backend descriptor a session over a cloud runs with.
 */
import { describe, it, expect } from '@jest/globals';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FakeDriver, fakeCloud_sample } from '../src/cloud/fake/driver.js';
import { stratusBackend_make } from '../src/backend.js';
import { STRATUS_ITEM_KINDS, stratusName_colorize, CONTAINER_TYPES } from '../src/vfs/look.js';

describe('stratusBackend_make', () => {
  it('is the stratus backend over the driver, with the tenancy mounted and the look installed', async () => {
    const configDir = mkdtempSync(path.join(tmpdir(), 'stratus-backend-'));
    const made = stratusBackend_make({ driver: new FakeDriver(fakeCloud_sample()), configDir, cacheLifeMs: 1000 });
    expect(made.backend.id).toBe('stratus');
    expect(made.backend.vfs?.structural).toEqual(['/', '/net', '/net/oci']);
    expect(made.backend.completion?.rootWords).toEqual(['net']);
    expect(made.backend.listingLook?.kinds.find((kind) => kind.type === 'compartment')).toMatchObject({ container: true });
    const net = await made.backend.vfs!.dispatcher.list('/net');
    expect(net.ok && net.value.map((item) => item.name)).toEqual(['oci']);
    await made.backend.session.init();
    expect(await made.backend.session.identity_get()).toEqual({ user: 'rudolph', where: 'fnndsc', connected: true });
    const tenancy = await made.backend.vfs!.dispatcher.list('/net/oci/fnndsc');
    expect(tenancy.ok && tenancy.value.map((item) => item.name)).toContain('harbor-oci');
  });

  it('prompts with the user, the tenancy, the working directory or home, and the last command', async () => {
    const configDir = mkdtempSync(path.join(tmpdir(), 'stratus-backend-'));
    const made = stratusBackend_make({ driver: new FakeDriver(fakeCloud_sample()), configDir });
    await made.backend.session.init();
    expect(await made.backend.prompt!()).toEqual({
      user: 'rudolph', uri: 'fnndsc', cwd: '/net/oci/fnndsc/domains', pacsserver: null, physicalMode: false, lastExitCode: 0, lastCommandDurationMs: 0,
    });
    await made.backend.session.cwd_save('/net/oci/fnndsc/harbor-oci');
    expect(await made.backend.prompt!({ lastExitCode: 1, lastCommandDurationMs: 42 })).toMatchObject({ cwd: '/net/oci/fnndsc/harbor-oci', lastExitCode: 1, lastCommandDurationMs: 42 });
  });

  it('prompts as disconnected when the credential does not work', async () => {
    const broken = new (class extends FakeDriver {
      override async identity_get(): Promise<never> { throw new Error('no key'); }
    })(fakeCloud_sample());
    const made = stratusBackend_make({ driver: broken, configDir: mkdtempSync(path.join(tmpdir(), 'stratus-backend-')) });
    await made.backend.session.init();
    expect(await made.backend.prompt!()).toMatchObject({ user: 'disconnected', uri: '', cwd: '/net/oci' });
  });
});

describe('the stratus look', () => {
  it('marks containers, regions, zones, domains as containers and colours by state first', () => {
    for (const type of CONTAINER_TYPES) expect(STRATUS_ITEM_KINDS.find((kind) => kind.type === type)).toMatchObject({ mark: 'c', container: true });
    expect(STRATUS_ITEM_KINDS.find((kind) => kind.type === 'shape')).toMatchObject({ container: true });
    const sizeColumn = STRATUS_ITEM_KINDS.find((kind) => kind.type === 'compartment')!.sizeColumn!;
    expect(sizeColumn({ name: 'a', type: 'compartment', size: 0, owner: 'o', date: '', status: 'active' })).toBe('active');
    expect(sizeColumn({ name: 'a', type: 'compartment', size: 0, owner: 'o', date: '' })).toBeNull();
    const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');
    for (const [type, status] of [['compartment', 'active'], ['instance', 'stopped'], ['instance', 'PROVISIONING'], ['instance', 'failed'], ['compartment', undefined], ['region', undefined], ['domain', undefined], ['shape', undefined], ['file', undefined], ['instance', 'odd']] as const) {
      expect(plain(stratusName_colorize('x', type, status))).toBe('x');
    }
  });
});
