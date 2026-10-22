/**
 * @file The `domain` subject `expect` asks: a step's state, the last verify,
 * the domain's class and what it costs an hour, read and never changed.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeDriver, fakeCloud_sample } from '../src/cloud/fake/driver.js';
import { DomainStore, type DomainRecord } from '../src/domain/state.js';
import { SPEC_DEFAULT } from '../src/domain/spec.js';
import { domainExpectSubject_make } from '../src/domain/expect.js';

const NOW: Date = new Date('2026-10-22T12:00:00Z');

describe('the domain subject', () => {
  let root: string;
  let store: DomainStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'domain-expect-'));
    store = new DomainStore(join(root, 'domains'));
    const record: DomainRecord = {
      name: 'quay', created: NOW.toISOString(), region: 'us-ashburn-1', baseDomain: 'oci.chrisproject.org',
      steps: { run: { state: 'done' }, verify: { state: 'done', note: '10 of 10 pass' } }, ids: {},
      compartmentId: 'ocid1.compartment.oc1..harbor',
    };
    store.create(record, SPEC_DEFAULT);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const subject = () => domainExpectSubject_make({ store, driver: new FakeDriver(fakeCloud_sample()), now: (): Date => NOW });

  it('reads a step, the last verify and the class from the domain\'s state', async () => {
    expect(await subject().read({ target: 'quay', property: 'step', words: ['run'], deep: false })).toEqual({ got: 'done' });
    expect(await subject().read({ target: 'quay', property: 'step', words: ['dns'], deep: false })).toEqual({ got: 'not done' });
    expect(await subject().read({ target: 'quay', property: 'verify', words: [], deep: false })).toEqual({ got: '10' });
    expect(await subject().read({ target: 'quay', property: 'class', words: [], deep: false })).toEqual({ got: 'built' });
  });

  it('prices the compartment, as spend does', async () => {
    const reading = await subject().read({ target: 'quay', property: 'cost', words: [], deep: false });
    expect(Number(reading.got)).toBeGreaterThan(0);
  });

  it('refuses a domain it does not keep, and a verify never run, by name', async () => {
    expect((await subject().read({ target: 'pier', property: 'class', words: [], deep: false })).refusal).toBe('no domain "pier" is kept in this session (kept: quay)');
    store.record_update('quay', (record: DomainRecord): void => { delete record.steps['verify']; });
    expect((await subject().read({ target: 'quay', property: 'verify', words: [], deep: false })).refusal).toBe('quay has not been verified here yet: domain verify quay');
  });
});
