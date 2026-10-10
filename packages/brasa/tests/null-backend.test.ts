/**
 * @file The null backend: a session with no commands and a filesystem in memory.
 */
import { describe, it, expect } from '@jest/globals';
import { nullBackend_make } from '../src/null/backend.js';

describe('the null backend', () => {
  it('has a home, an identity and a working directory kept for the session only', async () => {
    const backend = nullBackend_make({ user: 'ana' });
    expect(backend.id).toBe('null');
    expect(await backend.session.home_get()).toBe('/home/ana');
    expect(await backend.session.identity_get()).toEqual({ user: 'ana', where: 'memory', connected: true });
    expect(await backend.session.cwd_load()).toBeNull();
    await backend.session.cwd_save('/home/ana/docs');
    expect(await backend.session.cwd_load()).toBe('/home/ana/docs');
    expect(await nullBackend_make().session.cwd_load()).toBeNull();
  });

  it('holds its home and what it was seeded with, and nothing of a backend\'s own', async () => {
    const backend = nullBackend_make({ seed: { '/home/user/a.txt': 'alpha' } });
    const listed = await backend.vfs!.dispatcher.list('/home/user');
    expect(listed.ok && listed.value.map((item) => item.name)).toEqual(['a.txt']);
    expect(backend.fallback).toBeUndefined();
    expect(backend.elevate).toBeUndefined();
  });
});
