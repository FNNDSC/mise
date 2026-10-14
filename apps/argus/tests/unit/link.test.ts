/**
 * Links land where they point: a feed or node in RUNS, a folder or a
 * file's folder in FILES; a link is the page's origin with the path as its
 * fragment, never the session's own path or token.
 */
import { describe, it, expect } from '@jest/globals';
import { link_compose, linkLanding_parse } from '../../src/app/link.js';

describe('linkLanding_parse', () => {
  it('lands a feed or a node in RUNS', () => {
    expect(linkLanding_parse('#/proc/jobs/feed_4389')).toEqual({ kind: 'runs', target: 'feed_4389' });
    expect(linkLanding_parse('#/home/sandip.samal/feeds/feed_4389/pl-dircopy_547557/pl-dicom_repack_639204')).toEqual({ kind: 'runs', target: 'pl-dicom_repack_639204' });
    expect(linkLanding_parse('#/proc/jobs/feed_4389/pl-dicom_repack_639204/')).toEqual({ kind: 'runs', target: 'pl-dicom_repack_639204' });
  });

  it("opens a node's data, and anything else, in FILES; a file opens its folder", () => {
    expect(linkLanding_parse('#/home/s/feeds/feed_4389/pl-x_7/data/sub_1')).toEqual({ kind: 'folder', path: '/home/s/feeds/feed_4389/pl-x_7/data/sub_1' });
    expect(linkLanding_parse('#/home/s/feeds/feed_4389/pl-x_7/data/sub_1/0-0-0223.dcm')).toEqual({ kind: 'folder', path: '/home/s/feeds/feed_4389/pl-x_7/data/sub_1' });
    expect(linkLanding_parse('#/home/rudolph/uploads')).toEqual({ kind: 'folder', path: '/home/rudolph/uploads' });
    expect(linkLanding_parse(`#${encodeURI('/home/s/uploads/3d anon')}`)).toEqual({ kind: 'folder', path: '/home/s/uploads/3d anon' });
  });

  it('ignores a fragment that names no path', () => {
    expect(linkLanding_parse('')).toBeNull();
    expect(linkLanding_parse('#token')).toBeNull();
    expect(linkLanding_parse('#/%E0%A4%A')).toBeNull();
  });
});

describe('link_compose', () => {
  it("is the page's origin with the path as its fragment, round-tripping", () => {
    const link: string = link_compose('https://titan.tch.harvard.edu', '/home/s/uploads/3d anon');
    expect(link).toBe('https://titan.tch.harvard.edu/#/home/s/uploads/3d%20anon');
    expect(linkLanding_parse(link.slice(link.indexOf('#')))).toEqual({ kind: 'folder', path: '/home/s/uploads/3d anon' });
  });
});
