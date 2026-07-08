import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { token_generate, token_writeFile, token_matches } from '../src/daemon/token';

describe('token_generate', () => {
  it('produces a 64-char hex string (256 bits)', () => {
    const token = token_generate();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different token each call', () => {
    expect(token_generate()).not.toBe(token_generate());
  });
});

describe('token_writeFile', () => {
  it('writes the token to a user-only-readable file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'calypso-token-'));
    const path = join(dir, 'token');
    try {
      const token = token_generate();
      token_writeFile(token, path);
      expect(readFileSync(path, 'utf-8')).toBe(`${token}\n`);
      // Mode is 0600 (owner read/write only) on POSIX.
      const mode = statSync(path).mode & 0o777;
      expect(mode & 0o077).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('token_matches', () => {
  it('accepts an exact match', () => {
    const token = token_generate();
    expect(token_matches(token, token)).toBe(true);
  });

  it('rejects a different token of equal length', () => {
    expect(token_matches(token_generate(), token_generate())).toBe(false);
  });

  it('rejects a token of different length without throwing', () => {
    expect(token_matches('abcd', 'abcde')).toBe(false);
    expect(token_matches('', 'x')).toBe(false);
  });
});
