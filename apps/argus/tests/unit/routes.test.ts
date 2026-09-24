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
import { pageMount_of, wireUrl_resolve, vfsUrl_build, downloadUrl_build, door_isPresent, doorUrl_build, type PageLocation, byteUrl_absolute } from '../../src/calypso/routes.js';

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

describe('byteUrl_absolute: the image loaders get a URL that loads', () => {
  // A DICOM or NIfTI view fails without a word when this is wrong: every
  // slice is an invalid URL. Pinned at the root and behind a door.
  it('resolves a byte URL under a door\'s /s/<key>/ prefix, keeping the prefix', () => {
    const url: string = byteUrl_absolute(vfsUrl_build('/home/radstar/uploads/SAG-anon/0001.dcm', ''), 'http://pangea.tch.harvard.edu:4180/s/56dfb37d9b35f209/');
    expect(url).toBe('http://pangea.tch.harvard.edu:4180/s/56dfb37d9b35f209/vfs?path=%2Fhome%2Fradstar%2Fuploads%2FSAG-anon%2F0001.dcm');
  });

  it('resolves a byte URL at the root, with its token', () => {
    const url: string = byteUrl_absolute(vfsUrl_build('/home/u/a.nii.gz', 'tok'), 'http://127.0.0.1:38167/?token=tok');
    expect(url).toBe('http://127.0.0.1:38167/vfs?path=%2Fhome%2Fu%2Fa.nii.gz&token=tok');
  });

  it('never glues a host to a path without its slash — the regression that broke every image', () => {
    for (const page of ['http://h:4180/s/key/', 'http://h:1/?token=t', 'https://titan.tch.harvard.edu/s/k/']) {
      const url: string = byteUrl_absolute(vfsUrl_build('/x.dcm', ''), page);
      const parsed: URL = new URL(url);
      expect(parsed.pathname.endsWith('/vfs')).toBe(true);
      expect(`wadouri:${url}`.startsWith('wadouri:http')).toBe(true);
    }
  });
});
