/**
 * @file The door file: written 0600 in the user's config dir, refused when loose, the default door remembered.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { chmod, mkdtemp, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  doorsDir_get, doorHost_of, doorFile_path, doorFile_write, doorFile_read, doorFile_remove, doorFiles_list,
  doorDefault_read, doorDefault_write, doorDefault_clear, doorCredential_resolve, door_carriesTokens, days_until, type DoorFile,
} from '../src/remote/doorFile.js';

let home: string;
let env: NodeJS.ProcessEnv;
const file: DoorFile = { door: 'https://titan.tch.harvard.edu/', user: 'chris', name: 'chris@pangea', token: 'pdt_x', minted: '2026-10-06T00:00:00.000Z', expires: '2026-11-05T00:00:00.000Z' };

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'chell-doors-'));
  env = { XDG_CONFIG_HOME: home };
});
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

describe('the door file', () => {
  it('lives under the user\'s config dir, named by the door\'s host, written 0600 in a 0700 dir', async () => {
    expect(doorsDir_get(env)).toBe(join(home, 'chell', 'doors'));
    expect(doorHost_of('https://titan.tch.harvard.edu/')).toBe('titan.tch.harvard.edu');
    expect(doorHost_of('http://pangea.tch.harvard.edu:4180/')).toBe('pangea.tch.harvard.edu_4180');
    const path: string = doorFile_write(file, env);
    expect(path).toBe(doorFile_path(file.door, env));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(doorsDir_get(env))).mode & 0o777).toBe(0o700);
    expect(doorFile_read(file.door, env)).toEqual(file);
    expect(doorFiles_list(env)).toEqual(['titan.tch.harvard.edu']);
    expect(doorFile_remove(file.door, env)).toBe(true);
    expect(doorFile_read(file.door, env)).toBeNull();
    expect(doorFile_remove(file.door, env)).toBe(false);
  });

  it('refuses a loose file by name, and one that is not a door file', async () => {
    const path: string = doorFile_write(file, env);
    await chmod(path, 0o644);
    expect(doorFile_read(file.door, env)).toMatchObject({ refused: expect.stringContaining('readable by others (mode 0644)') });
    await chmod(path, 0o600);
    expect(doorFile_read(file.door, env)).toEqual(file);
    // Another uid's file: the check names the owner.
    expect(doorFile_read(file.door, env, 424242)).toMatchObject({ refused: expect.stringContaining('is not yours') });
    await writeFile(path, '{"door":"x"}', { mode: 0o600 });
    expect(doorFile_read(file.door, env)).toMatchObject({ refused: expect.stringContaining('is not a door file') });
    await writeFile(path, 'not json', { mode: 0o600 });
    expect(doorFile_read(file.door, env)).toMatchObject({ refused: expect.stringContaining('does not parse') });
  });

  it('remembers one default door and forgets it only when it is the one named', async () => {
    expect(doorDefault_read(env)).toBeNull();
    doorDefault_write('https://titan.tch.harvard.edu/', env);
    expect(doorDefault_read(env)).toBe('https://titan.tch.harvard.edu/');
    doorDefault_clear('https://other/', env);
    expect(doorDefault_read(env)).toBe('https://titan.tch.harvard.edu/');
    doorDefault_clear('https://titan.tch.harvard.edu/', env);
    expect(doorDefault_read(env)).toBeNull();
  });

  it('the host\'s CHELL_DOOR is the default for a user who chose none; the user\'s own wins', () => {
    expect(doorDefault_read({ ...env, CHELL_DOOR: 'https://titan/' })).toBe('https://titan/');
    doorDefault_write('https://mine/', env);
    expect(doorDefault_read({ ...env, CHELL_DOOR: 'https://titan/' })).toBe('https://mine/');
  });

  it('resolves a credential by precedence: the environment, then the file, else none; a loose file is a refusal', async () => {
    expect(doorCredential_resolve(file.door, env)).toEqual({ kind: 'none' });
    doorFile_write(file, env);
    expect(doorCredential_resolve(file.door, env)).toEqual({ kind: 'token', token: 'pdt_x', user: 'chris', source: 'file', name: 'chris@pangea', expires: file.expires });
    expect(doorCredential_resolve(file.door, { ...env, CHELL_DOOR_TOKEN: 'pdt_env', CHELL_DOOR_USER: 'kim' })).toEqual({ kind: 'token', token: 'pdt_env', user: 'kim', source: 'env', name: null, expires: null });
    await chmod(doorFile_path(file.door, env), 0o640);
    expect(doorCredential_resolve(file.door, env)).toMatchObject({ refused: expect.stringContaining('readable by others') });
  });

  it('a token travels over https or to loopback, never over plain http to another host', () => {
    expect(door_carriesTokens('https://titan.tch.harvard.edu/')).toBe(true);
    expect(door_carriesTokens('http://127.0.0.1:4190/')).toBe(true);
    expect(door_carriesTokens('http://localhost:4180/')).toBe(true);
    expect(door_carriesTokens('http://pangea.tch.harvard.edu:4180/')).toBe(false);
    expect(days_until('2026-11-05T00:00:00.000Z', Date.parse('2026-10-06T12:00:00Z'))).toBe(29);
    expect(days_until('2026-10-01T00:00:00.000Z', Date.parse('2026-10-06T12:00:00Z'))).toBeLessThan(0);
  });

  it('an empty dir lists nothing and a missing dir reads as no default', async () => {
    await mkdir(join(home, 'chell', 'doors'), { recursive: true });
    expect(doorFiles_list(env)).toEqual([]);
    expect(doorDefault_read(env)).toBeNull();
  });
});
