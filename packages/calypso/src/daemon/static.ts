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
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';

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

  response.writeHead(200, { 'content-type': contentType_forPath(resolvedPath) });
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
