/**
 * @file Static file serving for the daemon's HTTP side.
 *
 * The daemon's WebSocket contract rides an HTTP server; this module gives
 * that server something to say to a plain GET. When the host configures a
 * web root (the built argus bundle), the daemon serves it, so opening the
 * daemon's URL in a browser yields the web surface with zero extra install.
 * Serving is deliberately minimal: GET and HEAD only, no directory listings,
 * no caching headers, and every resolved path is contained within the root.
 * The daemon binds loopback only, so this is an operator-local convenience,
 * not a hosting story.
 *
 * @module
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Content types for web-bundle assets and the file kinds `/vfs` serves. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

/**
 * Resolves the content type a path's extension implies.
 *
 * @param filePath - The path whose extension to inspect.
 * @returns The content type; a binary octet-stream when unrecognized.
 */
export function contentType_forPath(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * How long a browser may keep one file.
 *
 * The bundle is two kinds of file with opposite needs. The assets carry a
 * content hash in their names, so a changed asset is a NEW name and the old
 * one can be kept forever. `index.html` keeps its name and is the thing
 * that NAMES those assets, so a stale copy pins a browser to the whole of
 * an old surface.
 *
 * Sending nothing, which is what this did, is not neutral: with no
 * `cache-control`, no `etag` and no `last-modified`, a browser is free to
 * guess, and it guesses that it may keep the page. A rebuilt surface then
 * does not arrive at all — the operator restarts the daemon, reloads, and
 * is served the same page naming the same old assets, with nothing on
 * either side saying why.
 *
 * @param filePath - The file being served.
 * @returns The `cache-control` value for it.
 */
export function cacheControl_forPath(filePath: string): string {
  const name: string = path.basename(filePath).toLowerCase();
  if (name.endsWith('.html')) return 'no-store';
  // A hashed name is its own validator: a different build is a different
  // URL, so this copy is good forever.
  return /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(name)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

/**
 * Picks the first candidate directory that holds a servable web bundle.
 *
 * A candidate qualifies when it exists and contains an `index.html`; the
 * marker distinguishes a built bundle from an arbitrary directory, so the
 * daemon never serves a tree that merely happens to exist.
 *
 * @param candidates - Directories to probe, in preference order. Empty or
 *   undefined entries are skipped.
 * @returns The absolute path of the first qualifying candidate, or null when
 *   none qualifies.
 */
export function webRoot_resolve(candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const resolved: string = path.resolve(candidate);
    if (existsSync(path.join(resolved, 'index.html'))) {
      return resolved;
    }
  }
  return null;
}

/**
 * How many directory levels above this module may hold a source checkout.
 *
 * A built calypso sits at `packages/calypso/dist/daemon/`, four levels below
 * the checkout root; the extra margin covers a workspace symlinked through
 * `node_modules/@fnndsc/calypso`.
 */
/**
 * Reads the version of the app a web root was built from.
 *
 * The bundle carries no manifest of its own; the app's package.json sits
 * beside its dist directory in the checkout that built it.
 *
 * @param webRoot - The resolved web root (the app's dist directory).
 * @returns The app's version, or `unknown` when no package.json is beside it.
 */
export function webRootVersion_read(webRoot: string): string {
  try {
    const manifest: { version?: unknown } = JSON.parse(
      readFileSync(path.join(webRoot, '..', 'package.json'), 'utf8'),
    ) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

const CHECKOUT_SEARCH_DEPTH: number = 6;

/**
 * Finds the argus bundle belonging to the checkout that built this calypso.
 *
 * The daemon is launched from wherever the operator happens to stand, so the
 * working directory cannot locate the bundle; this walks up from this module's
 * own path instead, which ties the served surface to the same tree as the
 * engine serving it. A published install has no such enclosing checkout and
 * simply finds nothing.
 *
 * @returns The absolute bundle directory, or null when no checkout encloses
 *   this module.
 */
export function bundledWebRoot_find(): string | null {
  let directory: string = path.dirname(fileURLToPath(import.meta.url));
  for (let level: number = 0; level < CHECKOUT_SEARCH_DEPTH; level++) {
    const candidate: string = path.join(directory, 'apps', 'argus', 'dist');
    if (existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
    const parent: string = path.dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  return null;
}

/**
 * Answers one plain HTTP request from the web root.
 *
 * Resolution: the URL path is decoded, stripped of its query, and joined to
 * the root; `/` serves `index.html`. A resolved path escaping the root (via
 * `..` or an absolute segment) is refused with 404 rather than 403, so the
 * response does not confirm what exists outside the root. Methods other than
 * GET and HEAD receive 405.
 *
 * @param root - The absolute web root directory to serve from.
 * @param request - The incoming HTTP request.
 * @param response - The response to write.
 */
export function staticRequest_handle(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('method not allowed');
    return;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent((request.url ?? '/').split('?')[0]);
  } catch {
    notFound_send(response);
    return;
  }
  if (decodedPath.includes('\0')) {
    notFound_send(response);
    return;
  }
  const relativePath: string = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const resolvedPath: string = path.resolve(root, relativePath);
  if (resolvedPath !== root && !resolvedPath.startsWith(root + path.sep)) {
    notFound_send(response);
    return;
  }
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    notFound_send(response);
    return;
  }

  response.writeHead(200, {
    'content-type': contentType_forPath(resolvedPath),
    'cache-control': cacheControl_forPath(resolvedPath),
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  const stream = createReadStream(resolvedPath);
  stream.on('error', () => {
    // The file vanished between stat and read; the socket gets a clean end.
    response.destroy();
  });
  stream.pipe(response);
}

/**
 * Writes a plain 404.
 *
 * @param response - The response to write.
 */
function notFound_send(response: ServerResponse): void {
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('not found');
}
