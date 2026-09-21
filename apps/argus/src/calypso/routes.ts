/**
 * @file Where the wire and the byte route are, from where the page is.
 *
 * The daemon serves this bundle, its WebSocket, and `/vfs` from one origin
 * at its root, and for a long time the page said so in absolute terms:
 * `ws://<host>` and `/vfs?…`. Behind a door — the porter, which proxies one
 * identity's daemon under `/s/<identity>/` on an origin it shares with
 * every other identity — the root is somebody else's, and `ws:` on an
 * `https:` page is refused outright. So every address is derived from the
 * page's own: the directory the page was served from is where its daemon
 * answers, whatever prefix stands in front of it, and the socket scheme
 * follows the page's.
 *
 * Kept free of the DOM so it can be proved under jest with a plain
 * location.
 *
 * @module
 */

/** The parts of `window.location` the routes are derived from. */
export interface PageLocation {
  /** `http:` or `https:`. */
  protocol: string;
  /** Host and port, as the page was served. */
  host: string;
  /** The page's path; its directory is the daemon's mount. */
  pathname: string;
  /** The query string, `?` included. */
  search: string;
}

/**
 * The directory the page was served from, with its trailing slash.
 *
 * `/` at the daemon's root; `/s/chris@cube/` behind a door. A page named
 * explicitly (`/s/chris@cube/index.html`) resolves to the same directory.
 *
 * @param pathname - The page's path.
 * @returns The mount, always beginning and ending with `/`.
 */
export function pageMount_of(pathname: string): string {
  const cut: number = pathname.lastIndexOf('/');
  return cut <= 0 ? '/' : pathname.slice(0, cut + 1);
}

/**
 * Resolves the daemon's WebSocket URL: a `?ws=` override first, else the
 * page's own origin and mount, on the socket scheme the page's implies.
 *
 * @param location - The page's location.
 * @returns The WebSocket URL to attach to.
 */
export function wireUrl_resolve(location: PageLocation): string {
  const override: string | null = new URLSearchParams(location.search).get('ws');
  if (override !== null && override.length > 0) {
    return override;
  }
  const scheme: string = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}${pageMount_of(location.pathname)}`;
}

/**
 * Builds the URL serving one path's bytes, relative to the page's mount.
 *
 * The token rides the query only when the page holds one: behind a door the
 * door holds it and puts it on the proxied request itself, and a page that
 * appended an empty token would only be saying so in the URL bar.
 *
 * @param path - The ChRIS path whose bytes are wanted.
 * @param token - The attach token, or the empty string when a door holds it.
 * @returns A URL the browser resolves against the page's own location.
 */
export function vfsUrl_build(path: string, token: string): string {
  const query: string = `path=${encodeURIComponent(path)}`;
  return token.length > 0
    ? `vfs?${query}&token=${encodeURIComponent(token)}`
    : `vfs?${query}`;
}

/**
 * Whether the page came through a door that holds its token.
 *
 * The porter sends a logged-in browser to `…/?door`: no token in the URL,
 * because the door puts the token on the proxied attach itself. The page
 * then attaches at once, with an empty token, rather than asking for one
 * it will never be shown.
 *
 * @param search - The page's query string.
 * @returns True when a door stands in front of this page.
 */
export function door_isPresent(search: string): boolean {
  return new URLSearchParams(search).has('door');
}
