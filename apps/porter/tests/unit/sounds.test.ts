/**
 * @file The deployment's own sounds: served in place of the page's when the
 * sounds folder has them, by bare file name only, and the page's own
 * otherwise.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { soundOverride_read } from '../../src/app.js';

describe('soundOverride_read', () => {
  it('serves a sound from the folder, typed, and nothing else', async () => {
    const dir: string = await mkdtemp(join(tmpdir(), 'sounds-'));
    await writeFile(join(dir, 'press.mp3'), Buffer.from('beep'));
    // As the mount splits a request: the rest begins with a slash.
    const { mountUrl_split } = await import('../../src/app.js');
    const rest = mountUrl_split('/s/0123456789abcdef/sounds/press.mp3?v=1')!.rest;
    expect(rest).toBe('/sounds/press.mp3?v=1');
    expect(await soundOverride_read(dir, rest)).toEqual({ bytes: Buffer.from('beep'), type: 'audio/mpeg' });
    expect(await soundOverride_read(dir, 'sounds/press.mp3')).toEqual({ bytes: Buffer.from('beep'), type: 'audio/mpeg' });
    // Not in the folder, not a sound, or climbing out: the page's own is served.
    expect(await soundOverride_read(dir, 'sounds/arrive.mp3')).toBeNull();
    expect(await soundOverride_read(dir, 'index.html')).toBeNull();
    expect(await soundOverride_read(dir, '/sounds/../secret.mp3')).toBeNull();
    expect(await soundOverride_read(dir, '/sounds/sub/press.mp3')).toBeNull();
    expect(await soundOverride_read(null, 'sounds/press.mp3')).toBeNull();
  });

  it('names the sounds the folder keeps at sounds/index.json, and nothing when there is no folder', async () => {
    const dir: string = await mkdtemp(join(tmpdir(), 'sounds-'));
    await writeFile(join(dir, 'press.mp3'), Buffer.from('beep'));
    await writeFile(join(dir, 'arrive.wav'), Buffer.from('beep'));
    await writeFile(join(dir, 'notes.txt'), Buffer.from('not a sound'));
    const index = await soundOverride_read(dir, '/sounds/index.json');
    expect(index?.type).toBe('application/json; charset=utf-8');
    expect(JSON.parse(String(index?.bytes))).toEqual({ files: ['arrive.wav', 'press.mp3'] });
    expect(await soundOverride_read(null, '/sounds/index.json')).toBeNull();
  });
});
