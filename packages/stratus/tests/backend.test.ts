/**
 * @file The backend descriptor a session over a cloud runs with.
 */
import { describe, it, expect } from '@jest/globals';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FakeDriver, fakeCloud_sample } from '../src/cloud/fake/driver.js';
import { stratusBackend_make } from '../src/backend.js';
import { STRATUS_ITEM_KINDS, stratusName_colorize, CONTAINER_TYPES, stateTone_paint } from '../src/vfs/look.js';
import { envelopeHandler_get } from '@fnndsc/brasa/core';
import { harborCheckout_make } from './support/harborCheckout.js';

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
    // Once the tenancy is known, it and its fixed folders are entered without asking.
    expect(made.backend.vfs?.structural).toEqual([
      '/', '/net', '/net/oci', '/net/oci/fnndsc', '/net/oci/fnndsc/regions', '/net/oci/fnndsc/domains',
      ...['instances', 'networks', 'loadbalancers', 'volumes', 'buckets', 'dns'].map((kind) => `/net/oci/fnndsc/${kind}`),
    ]);
  });

  it('prompts with the user, the tenancy, the working directory or home, and the last command', async () => {
    const configDir = mkdtempSync(path.join(tmpdir(), 'stratus-backend-'));
    const made = stratusBackend_make({ driver: new FakeDriver(fakeCloud_sample()), configDir });
    await made.backend.session.init();
    expect(await made.backend.prompt!()).toEqual({
      user: 'rudolph', uri: 'fnndsc', cwd: '/net/oci/fnndsc/domains', pacsserver: null, physicalMode: false, lastExitCode: 0, lastCommandDurationMs: 0,
      segments: expect.arrayContaining([expect.objectContaining({ key: 'cloud', value: 'OCI', tone: 'leader' }), expect.objectContaining({ key: 'cwd', value: '/net/oci/fnndsc/domains' })]),
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
    expect(await made.backend.prompt!()).toMatchObject({ user: 'disconnected', uri: '', cwd: '/net/oci', segments: [{ key: 'cloud', value: 'OCI ✗', tone: 'alert' }, { key: 'cwd', value: '/net/oci' }] });
  });
});

describe('the backend\'s domains', () => {
  it('shows the daemon\'s domains under the tenancy and registers domain', async () => {
    const root = harborCheckout_make();
    const made = stratusBackend_make({ driver: new FakeDriver(fakeCloud_sample()), configDir: mkdtempSync(path.join(tmpdir(), 'stratus-backend-')), domains: [{ name: 'harbor', root }] });
    await made.backend.session.init();
    const listing = await made.backend.vfs!.dispatcher.list('/net/oci/fnndsc/domains');
    expect(listing.ok && listing.value.map((item) => [item.name, item.owner])).toEqual([['harbor', 'rudolph']]);
    expect(made.domains.domain_read('harbor')?.cluster).toBe('harbor.oci.chrisproject.org');
    const answer = await envelopeHandler_get('domain')!(['status']);
    expect(answer.rendered).toContain('harbor.oci.chrisproject.org');
  });
});

describe('the stratus look', () => {
  it('marks containers, regions, zones, domains as containers and colours by state first', () => {
    for (const type of CONTAINER_TYPES) expect(STRATUS_ITEM_KINDS.find((kind) => kind.type === type)).toMatchObject({ mark: 'c', container: true });
    expect(STRATUS_ITEM_KINDS.find((kind) => kind.type === 'shape')).toMatchObject({ container: true });
    const sizeColumn = STRATUS_ITEM_KINDS.find((kind) => kind.type === 'compartment')!.sizeColumn!;
    const plainColumn = (text: string | null): string | null => (text === null ? null : text.replace(/\x1b\[[0-9;]*m/g, ''));
    expect(plainColumn(sizeColumn({ name: 'a', type: 'compartment', size: 0, owner: 'o', date: '', status: 'active' }))).toBe('active      ');
    expect(plainColumn(sizeColumn({ name: 'a', type: 'compartment', size: 0, owner: 'o', date: '', status: 'odd' }))).toBe('odd         ');
    for (const type of ['instance', 'network', 'subnet', 'securitygroup', 'loadbalancer', 'volume', 'bucket', 'dnszone', 'kind']) {
      expect(STRATUS_ITEM_KINDS.find((kind) => kind.type === type)).toMatchObject({ container: true });
    }
    expect(STRATUS_ITEM_KINDS.find((kind) => kind.type === 'object')?.container).toBeUndefined();
    expect(STRATUS_ITEM_KINDS.find((kind) => kind.type === 'step')).toMatchObject({ mark: 'S', container: true });
    expect(STRATUS_ITEM_KINDS.find((kind) => kind.type === 'secret')).toMatchObject({ mark: '!' });
    for (const state of ['done', 'unknown', 'expired', 'not done']) expect(stateTone_paint(state, state).replace(/\x1b\[[0-9;]*m/g, '')).toBe(state);
    const count = STRATUS_ITEM_KINDS.find((kind) => kind.type === 'kind')!.sizeColumn!;
    expect(count({ name: 'instances', type: 'kind', size: 3, owner: 'o', date: '' })).toBeNull();
    expect(count({ name: 'instances', type: 'kind', size: 0, owner: 'o', date: '', status: 'uncounted' })).toBe('-       ');
    expect(stratusName_colorize('instances', 'kind').replace(/\x1b\[[0-9;]*m/g, '')).toBe('instances');
    expect(sizeColumn({ name: 'a', type: 'compartment', size: 0, owner: 'o', date: '' })).toBeNull();
    const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');
    for (const [type, status] of [['compartment', 'active'], ['instance', 'stopped'], ['instance', 'PROVISIONING'], ['instance', 'failed'], ['compartment', undefined], ['region', undefined], ['domain', undefined], ['shape', undefined], ['file', undefined], ['instance', 'odd']] as const) {
      expect(plain(stratusName_colorize('x', type, status))).toBe('x');
    }
  });
});
