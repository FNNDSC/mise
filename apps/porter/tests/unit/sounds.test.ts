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
    expect(await soundOverride_read(dir, 'sounds/press.mp3?v=1')).toEqual({ bytes: Buffer.from('beep'), type: 'audio/mpeg' });
    // Not in the folder, not a sound, or climbing out: the page's own is served.
    expect(await soundOverride_read(dir, 'sounds/arrive.mp3')).toBeNull();
    expect(await soundOverride_read(dir, 'index.html')).toBeNull();
    expect(await soundOverride_read(dir, 'sounds/../secret.mp3')).toBeNull();
    expect(await soundOverride_read(null, 'sounds/press.mp3')).toBeNull();
  });
});
