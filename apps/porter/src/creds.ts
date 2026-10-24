/**
 * @file Each person's credentials for other backends, kept on this host
 * under their ChRIS identity.
 *
 * The ChRIS login is the only login (docs/stratus.adoc, D14). A ChRIS
 * identity is the master, and what it needs to act in another backend hangs
 * off it here: today an OCI API key and its config, for `:stratus oci`. A
 * session porter starts for a person reads only that person's entry, so no
 * one reaches another's tenancy through the door. Nothing here crosses the
 * wire: the files are written on this host (an import, run here) and read by
 * the daemons porter starts here.
 *
 * @module
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { berthKey_compute } from '@fnndsc/calypso/berth';

/** One OCI profile, as `~/.oci/config` holds it. */
export interface OciProfile {
  user: string;
  fingerprint: string;
  tenancy: string;
  region: string;
  keyFile: string;
}

/**
 * Reads one profile out of an OCI config file.
 *
 * @param text - The file.
 * @param profile - The profile's name.
 * @returns The profile, or why it is not usable.
 */
export function ociProfile_read(text: string, profile: string = 'DEFAULT'): OciProfile | { error: string } {
  const values: Map<string, string> = new Map();
  let inProfile: boolean = false;
  for (const raw of text.split('\n')) {
    const line: string = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const section: RegExpMatchArray | null = line.match(/^\[(.+)\]$/);
    if (section !== null) { inProfile = section[1] === profile; continue; }
    if (!inProfile) continue;
    const equals: number = line.indexOf('=');
    if (equals > 0) values.set(line.slice(0, equals).trim(), line.slice(equals + 1).trim());
  }
  const missing: string[] = ['user', 'fingerprint', 'tenancy', 'region', 'key_file'].filter((name: string): boolean => !values.has(name));
  if (missing.length > 0) return { error: `profile ${profile} lacks ${missing.join(', ')}` };
  if (values.has('pass_phrase')) return { error: `profile ${profile}'s key has a passphrase; asking for one is not built yet` };
  return {
    user: values.get('user') as string,
    fingerprint: values.get('fingerprint') as string,
    tenancy: values.get('tenancy') as string,
    region: values.get('region') as string,
    keyFile: values.get('key_file') as string,
  };
}

/** Each person's credentials, under porter's state directory. */
export class CredentialStore {
  constructor(private readonly stateDir: string) {}

  /**
   * The folder one person's credentials for one backend live in.
   *
   * @param identity - The person's ChRIS identity (`<user>@<cube url>`).
   * @param backend - The backend (`oci`).
   * @returns The folder; not necessarily there.
   */
  folder_derive(identity: string, backend: string): string {
    return join(this.stateDir, 'creds', berthKey_compute(identity), backend);
  }

  /**
   * The OCI config a person's stratus session starts on, when one is kept.
   *
   * @param identity - The person's ChRIS identity.
   * @returns Its path, or null when this person has none.
   */
  ociConfig_find(identity: string): string | null {
    const path: string = join(this.folder_derive(identity, 'oci'), 'config');
    return existsSync(path) ? path : null;
  }

  /**
   * Files a person's existing OCI key under their ChRIS identity: the key
   * copied in, and a config naming the copy. Run on this host, by its
   * operator; never over the wire.
   *
   * @param identity - The person's ChRIS identity.
   * @param configPath - The OCI config to take the profile from.
   * @param profile - Which profile.
   * @returns What was kept, or why nothing was.
   */
  oci_import(identity: string, configPath: string, profile: string = 'DEFAULT'): { config: string; user: string; tenancy: string } | { error: string } {
    const source: string = home_expand(configPath);
    if (!existsSync(source)) return { error: `${source}: no such file` };
    const read: OciProfile | { error: string } = ociProfile_read(readFileSync(source, 'utf-8'), profile);
    if ('error' in read) return read;
    const keySource: string = home_expand(read.keyFile);
    if (!existsSync(keySource)) return { error: `${keySource}: the profile's key is not there` };
    const folder: string = this.folder_derive(identity, 'oci');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    chmodSync(folder, 0o700);
    const key: string = join(folder, 'key.pem');
    copyFileSync(keySource, key);
    chmodSync(key, 0o600);
    const config: string = join(folder, 'config');
    writeFileSync(config, `[DEFAULT]\nuser=${read.user}\nfingerprint=${read.fingerprint}\ntenancy=${read.tenancy}\nregion=${read.region}\nkey_file=${key}\n`, { encoding: 'utf-8', mode: 0o600 });
    chmodSync(config, 0o600);
    return { config, user: read.user, tenancy: read.tenancy };
  }
}

/**
 * Expands a leading `~`.
 *
 * @param path - A path.
 * @returns It, absolute.
 */
function home_expand(path: string): string {
  return resolve(path.startsWith('~') ? join(homedir(), path.slice(1)) : path);
}
