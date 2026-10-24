/**
 * @file Each person's credentials for other backends, filed under their
 * ChRIS identity: an OCI profile read, a key copied in at mode 600.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore, ociProfile_read } from '../../src/creds.js';

const OWNER: string = 'rudolph@https://cube.example.org/api/v1/';

describe('the credential store', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'porter-creds-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads one profile, and refuses one that lacks a part or has a passphrase', () => {
    const text: string = '[DEFAULT]\nuser=u\nfingerprint=f\ntenancy=t\nregion=r\nkey_file=~/k.pem\n[OTHER]\nuser=x\n';
    expect(ociProfile_read(text)).toEqual({ user: 'u', fingerprint: 'f', tenancy: 't', region: 'r', keyFile: '~/k.pem' });
    expect(ociProfile_read(text, 'OTHER')).toEqual({ error: 'profile OTHER lacks fingerprint, tenancy, region, key_file' });
    expect(ociProfile_read(`${text.split('[OTHER]')[0]}pass_phrase=x\n`)).toMatchObject({ error: expect.stringContaining('has a passphrase') });
  });

  it('files a key under the person, mode 600, beside a config naming the copy', () => {
    writeFileSync(join(root, 'key.pem'), 'PRIVATE');
    writeFileSync(join(root, 'config'), `[DEFAULT]\nuser=u\nfingerprint=f\ntenancy=t\nregion=r\nkey_file=${join(root, 'key.pem')}\n`);
    const store: CredentialStore = new CredentialStore(join(root, 'state'));
    expect(store.ociConfig_find(OWNER)).toBeNull();
    const kept = store.oci_import(OWNER, join(root, 'config'));
    expect(kept).toMatchObject({ user: 'u', tenancy: 't' });
    const config: string = store.ociConfig_find(OWNER) as string;
    expect(statSync(config).mode & 0o777).toBe(0o600);
    expect(readFileSync(config, 'utf-8')).toContain(`key_file=${join(store.folder_derive(OWNER, 'oci'), 'key.pem')}`);
    expect(statSync(join(store.folder_derive(OWNER, 'oci'), 'key.pem')).mode & 0o777).toBe(0o600);
    expect(store.ociConfig_find('someone@https://cube.example.org/api/v1/')).toBeNull();
    expect(store.oci_import(OWNER, join(root, 'nope'))).toMatchObject({ error: expect.stringContaining('no such file') });
  });
});
