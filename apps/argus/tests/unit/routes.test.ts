/**
 * @file The wire and the byte route are derived from where the page is.
 *
 * At the daemon's root the addresses are what they always were; behind a
 * door's `/s/<identity>/` prefix, on an `https:` origin, they follow the
 * page — which is the whole reason the derivation exists.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { pageMount_of, wireUrl_resolve, vfsUrl_build, downloadUrl_build, door_isPresent, doorUrl_build, type PageLocation } from '../../src/calypso/routes.js';

const atRoot: PageLocation = { protocol: 'http:', host: '127.0.0.1:41785', pathname: '/', search: '?token=abc' };
const behindDoor: PageLocation = { protocol: 'https:', host: 'titan.tch.harvard.edu', pathname: '/s/chris@cube/', search: '?door' };

describe('pageMount_of', () => {
  it('is the root for a root page', () => {
    expect(pageMount_of('/')).toBe('/');
    expect(pageMount_of('/index.html')).toBe('/');
  });
  it('is the prefix directory behind a door, named or not', () => {
    expect(pageMount_of('/s/chris@cube/')).toBe('/s/chris@cube/');
    expect(pageMount_of('/s/chris@cube/index.html')).toBe('/s/chris@cube/');
  });
});

describe('wireUrl_resolve', () => {
  it('is the serving origin at the root, as before', () => {
    expect(wireUrl_resolve(atRoot)).toBe('ws://127.0.0.1:41785/');
  });
  it('follows the page behind a door: its scheme, its host, its mount', () => {
    expect(wireUrl_resolve(behindDoor)).toBe('wss://titan.tch.harvard.edu/s/chris@cube/');
  });
  it('still honours a ?ws= override for the dev server', () => {
    expect(wireUrl_resolve({ ...atRoot, search: '?ws=ws://127.0.0.1:9999' })).toBe('ws://127.0.0.1:9999');
  });
});

describe('vfsUrl_build', () => {
  it('is relative to the page, carrying the token the page holds', () => {
    expect(vfsUrl_build('/home/chris/a b.txt', 'abc')).toBe('vfs?path=%2Fhome%2Fchris%2Fa%20b.txt&token=abc');
  });
  it('carries no token when a door holds it', () => {
    expect(vfsUrl_build('/home/chris/a.txt', '')).toBe('vfs?path=%2Fhome%2Fchris%2Fa.txt');
  });
});

describe('downloadUrl_build', () => {
  it('is the bytes route asked for an attachment', () => {
    expect(downloadUrl_build('/home/chris/a.csv', 'abc')).toBe('vfs?path=%2Fhome%2Fchris%2Fa.csv&token=abc&download=1');
    expect(downloadUrl_build('/home/chris/a.csv', '')).toBe('vfs?path=%2Fhome%2Fchris%2Fa.csv&download=1');
  });
});

describe('door_isPresent', () => {
  it('reads the bare flag a door sends the browser with', () => {
    expect(door_isPresent('?door')).toBe(true);
    expect(door_isPresent('?door=1&x=y')).toBe(true);
    expect(door_isPresent('?token=abc')).toBe(false);
    expect(door_isPresent('')).toBe(false);
  });
});

describe('doorUrl_build', () => {
  it('finds the door two directories above the mount', () => {
    expect(doorUrl_build('/s/0123456789abcdef/', 'logout')).toBe('/logout');
    expect(doorUrl_build('/s/0123456789abcdef/index.html', 'login')).toBe('/login');
  });
  it('keeps whatever a front put in front of the door', () => {
    expect(doorUrl_build('/porter/s/0123456789abcdef/', 'logout')).toBe('/porter/logout');
  });
});
