/**
 * @file Tests for the attach note.
 *
 * The note carries an attach token into a world-readable directory, so what
 * matters is not that it writes but *how*: owner-only, never through something
 * planted at the path, and gone when the daemon is.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import { existsSync, readFileSync, statSync, symlinkSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachFile_path, attachFile_write, attachFile_remove } from '../src/daemon/attachFile.js';

afterEach(() => {
  attachFile_remove();
});

describe('attachFile', () => {
  it('writes the lines it was given', () => {
    const path = attachFile_write(['wire: ws://host:1', 'token: secret']);

    expect(path).toBe(attachFile_path());
    expect(readFileSync(path as string, 'utf8')).toBe('wire: ws://host:1\ntoken: secret\n');
  });

  it('is readable only by its owner', () => {
    // The directory is world-readable, so the mode is the only thing standing
    // between the token and everyone else on the machine.
    const path = attachFile_write(['token: secret']) as string;

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('replaces a stale note rather than appending to one', () => {
    attachFile_write(['old']);
    const path = attachFile_write(['new']) as string;

    expect(readFileSync(path, 'utf8')).toBe('new\n');
  });

  it('refuses to write through a symlink planted at the path', () => {
    // Without exclusive creation, another user could point this path at a file
    // of their choosing and have the daemon write a token into it.
    const decoy = join(mkdtempSync(join(tmpdir(), 'attach-decoy-')), 'target');
    writeFileSync(decoy, 'untouched');
    rmSync(attachFile_path(), { force: true });
    symlinkSync(decoy, attachFile_path());

    try {
      const path = attachFile_write(['token: secret']);

      // Either the write was refused, or it landed on the real path — never
      // through the link into the decoy.
      expect(readFileSync(decoy, 'utf8')).toBe('untouched');
      if (path !== null) {
        expect(statSync(path).isSymbolicLink()).toBe(false);
      }
    } finally {
      rmSync(attachFile_path(), { force: true });
      rmSync(decoy, { force: true });
    }
  });

  it('removes the note, and does not complain when there is none', () => {
    attachFile_write(['token: secret']);
    attachFile_remove();

    expect(existsSync(attachFile_path())).toBe(false);
    expect(() => attachFile_remove()).not.toThrow();
  });
});
