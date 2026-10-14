/**
 * @file Links: a web address that opens ARGUS at a path.
 *
 * `url <path>` (chell) and LINK (here) put a path in the address's
 * fragment: `https://titan.tch.harvard.edu/#/proc/jobs/feed_4389/pl-x_7`.
 * The fragment survives the door's login redirects (a browser carries it
 * across a redirect that names none), so the page that finally opens still
 * holds it, and lands there once: a feed or a node in RUNS, through the
 * same jump RUNS's JUMP TO takes, anything else in FILES. Landing never
 * moves the session's working directory: the console is the operator's.
 *
 * @module
 */

/** Where a link lands. */
export type LinkLanding =
  | { kind: 'runs'; target: string }
  | { kind: 'folder'; path: string };

/**
 * Reads where a link's fragment points.
 *
 * A path that ends at a feed (`feed_4389`) or a node (`pl-dicom_repack_639204`)
 * lands in RUNS on it; a path inside a node's `data`, or anywhere else,
 * opens in FILES — a file opens its folder.
 *
 * @param hash - The address's fragment, `#` included.
 * @returns The landing, or null when the fragment names no path.
 */
export function linkLanding_parse(hash: string): LinkLanding | null {
  if (!hash.startsWith('#/')) return null;
  let path: string;
  try {
    path = decodeURI(hash.slice(1));
  } catch {
    return null;
  }
  path = path.replace(/\/+$/, '') || '/';
  const segments: string[] = path.split('/').filter((segment: string): boolean => segment !== '');
  const last: string = segments[segments.length - 1] ?? '';
  const inData: boolean = segments.includes('data');
  if (!inData && (/^feed_\d+$/.test(last) || (/^[\w.-]+_\d+$/.test(last) && segments.some((segment: string): boolean => /^feed_\d+$/.test(segment))))) {
    return { kind: 'runs', target: last };
  }
  const isFile: boolean = /\.[A-Za-z0-9]{1,8}$/.test(last) && !/_\d+$/.test(last);
  return { kind: 'folder', path: isFile ? `/${segments.slice(0, -1).join('/')}` : path };
}

/**
 * The address a link opens: the page's own origin, with the path as its
 * fragment. Through the door that origin is the door; the page's own path
 * (a session's `/s/<key>/`, its token) is never shared.
 *
 * @param origin - The page's origin (`location.origin`).
 * @param absolutePath - The path the link opens.
 * @returns The link.
 */
export function link_compose(origin: string, absolutePath: string): string {
  return `${origin.replace(/\/+$/, '')}/#${encodeURI(absolutePath)}`;
}
