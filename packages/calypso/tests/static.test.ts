import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { get, request as httpRequest, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import { CalypsoDaemon } from '../src/daemon/server';
import { bundledWebRoot_find, cacheControl_forPath, webRoot_resolve, webRootVersion_read } from '../src/daemon/static';
import type { HostedEngine } from '../src/daemon/engine';
import { CONTRACT_VERSION } from '@fnndsc/menu';
import type { CommandEnvelope } from '@fnndsc/cumin';

const TOKEN = 'test-attach-token';

/** A stub engine sufficient for transport tests. */
function stubEngine_create(): HostedEngine {
  return {
    line_execute: async (line: string): Promise<CommandEnvelope[]> => [
      { status: 'ok', rendered: `ran: ${line}` },
    ],
    line_complete: async (prefix: string) => ({ candidates: [], prefix }),
  };
}

/** Fetches a URL and resolves with status, headers, and body. */
function http_get(url: string): Promise<{ status: number; type: string; cache: string; body: string }> {
  return new Promise((resolve, reject) => {
    get(url, (response: IncomingMessage) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          type: String(response.headers['content-type'] ?? ''),
          cache: String(response.headers['cache-control'] ?? ''),
          body: Buffer.concat(chunks).toString('utf-8'),
        }),
      );
    }).on('error', reject);
  });
}

/** POSTs a body and reads the reply, for the delivery route. */
function http_post(url: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target: URL = new URL(url);
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: { 'content-length': Buffer.byteLength(body) },
      },
      (response: IncomingMessage) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }),
        );
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

describe('webRoot_resolve', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'calypso-webroot-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('picks the first candidate holding an index.html', () => {
    writeFileSync(path.join(root, 'index.html'), '<html></html>');
    expect(webRoot_resolve([undefined, '/no/such/dir', root])).toBe(path.resolve(root));
  });

  it('refuses a directory without an index.html', () => {
    expect(webRoot_resolve([root])).toBeNull();
  });

  it('returns null with no candidates', () => {
    expect(webRoot_resolve([undefined, undefined])).toBeNull();
  });
});

describe('webRootVersion_read', () => {
  it('reads the version from the package.json beside the app\'s dist directory', () => {
    const app: string = mkdtempSync(path.join(tmpdir(), 'argus-app-'));
    try {
      mkdirSync(path.join(app, 'dist'));
      writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: '@fnndsc/argus', version: '0.6.0' }));
      expect(webRootVersion_read(path.join(app, 'dist'))).toBe('0.6.0');
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it('says unknown when no manifest sits beside the web root', () => {
    const app: string = mkdtempSync(path.join(tmpdir(), 'argus-app-'));
    try {
      mkdirSync(path.join(app, 'dist'));
      expect(webRootVersion_read(path.join(app, 'dist'))).toBe('unknown');
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});

describe('bundledWebRoot_find', () => {
  it('answers the same from any working directory', () => {
    const fromHere: string | null = bundledWebRoot_find();
    const original: string = process.cwd();
    try {
      process.chdir(tmpdir());
      expect(bundledWebRoot_find()).toBe(fromHere);
    } finally {
      process.chdir(original);
    }
  });

  it('answers an absolute bundle path or nothing at all', () => {
    const found: string | null = bundledWebRoot_find();
    const wellFormed: boolean =
      found === null ||
      (path.isAbsolute(found) && found.endsWith(path.join('apps', 'argus', 'dist')));
    expect(wellFormed).toBe(true);
  });
});

describe('CalypsoDaemon static serving', () => {
  let daemon: CalypsoDaemon;
  let port: number;
  let webRoot: string;

  beforeEach(async () => {
    webRoot = mkdtempSync(path.join(tmpdir(), 'calypso-static-'));
    writeFileSync(path.join(webRoot, 'index.html'), '<html>argus</html>');
    mkdirSync(path.join(webRoot, 'assets'));
    writeFileSync(path.join(webRoot, 'assets', 'app.js'), 'console.log("argus");');
    daemon = new CalypsoDaemon({ engine: stubEngine_create(), token: TOKEN, webRoot });
    port = await daemon.start();
  });

  afterEach(async () => {
    await daemon.stop();
    rmSync(webRoot, { recursive: true, force: true });
  });

  it('serves index.html at the root path, and tells the browser not to keep it', async () => {
    const reply = await http_get(`http://127.0.0.1:${port}/`);
    expect(reply.status).toBe(200);
    expect(reply.type).toContain('text/html');
    expect(reply.body).toContain('argus');
    // The header travels, not just the policy function: a rebuilt surface
    // reaches an operator who reloads, which it did not when this was
    // silent.
    expect(reply.cache).toBe('no-store');
  });

  it('serves nested assets with their content type', async () => {
    const reply = await http_get(`http://127.0.0.1:${port}/assets/app.js`);
    expect(reply.status).toBe(200);
    expect(reply.type).toContain('text/javascript');
  });

  it('ignores query strings when resolving files', async () => {
    const reply = await http_get(`http://127.0.0.1:${port}/?token=abc123`);
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('argus');
  });

  it('refuses path traversal outside the web root', async () => {
    const reply = await http_get(`http://127.0.0.1:${port}/..%2f..%2fetc%2fpasswd`);
    expect(reply.status).toBe(404);
  });

  it('404s a missing file', async () => {
    const reply = await http_get(`http://127.0.0.1:${port}/no-such-file.css`);
    expect(reply.status).toBe(404);
  });

  it('still accepts a WebSocket attach on the same port', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const attached = await new Promise<Record<string, unknown>>((resolve, reject) => {
      ws.once('error', reject);
      ws.once('open', () => {
        ws.send(JSON.stringify({ type: 'attach', protocolVersion: CONTRACT_VERSION, token: TOKEN }));
      });
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(attached['type']).toBe('attached');
    ws.close();
  });
});

describe('CalypsoDaemon /vfs route', () => {
  let daemon: CalypsoDaemon;
  let port: number;

  /** A stub engine that serves one known file through file_read. */
  function vfsEngine_create(): HostedEngine {
    return {
      ...stubEngine_create(),
      file_read: async (filePath: string): Promise<Buffer> => {
        if (filePath === '/home/demo/brain.png') {
          return Buffer.from('png-bytes');
        }
        throw new Error('no such file');
      },
    };
  }

  beforeEach(async () => {
    daemon = new CalypsoDaemon({ engine: vfsEngine_create(), token: TOKEN });
    port = await daemon.start();
  });

  afterEach(async () => {
    await daemon.stop();
  });

  it('serves file bytes with the extension content type', async () => {
    const reply = await http_get(
      `http://127.0.0.1:${port}/vfs?path=${encodeURIComponent('/home/demo/brain.png')}&token=${TOKEN}`,
    );
    expect(reply.status).toBe(200);
    expect(reply.type).toContain('image/png');
    expect(reply.body).toBe('png-bytes');
  });

  it('refuses a bad token with 404', async () => {
    const reply = await http_get(
      `http://127.0.0.1:${port}/vfs?path=${encodeURIComponent('/home/demo/brain.png')}&token=wrong`,
    );
    expect(reply.status).toBe(404);
  });

  it('404s a read failure', async () => {
    const reply = await http_get(
      `http://127.0.0.1:${port}/vfs?path=${encodeURIComponent('/nope')}&token=${TOKEN}`,
    );
    expect(reply.status).toBe(404);
  });

  it('takes a posted file and hands the bytes to the engine', async () => {
    const written: Array<{ path: string; bytes: string }> = [];
    const taking = new CalypsoDaemon({
      engine: {
        ...stubEngine_create(),
        file_write: async (filePath: string, bytes: Buffer): Promise<void> => {
          written.push({ path: filePath, bytes: bytes.toString() });
        },
      },
      token: TOKEN,
    });
    const takingPort = await taking.start();
    try {
      const reply = await http_post(
        `http://127.0.0.1:${takingPort}/vfs?path=${encodeURIComponent('/home/demo/notes.txt')}&token=${TOKEN}`,
        'from a browser',
      );
      expect(reply.status).toBe(200);
      expect(written).toEqual([{ path: '/home/demo/notes.txt', bytes: 'from a browser' }]);
    } finally {
      await taking.stop();
    }
  });

  it('refuses a posted file with a bad token, and writes nothing', async () => {
    const written: string[] = [];
    const taking = new CalypsoDaemon({
      engine: {
        ...stubEngine_create(),
        file_write: async (filePath: string): Promise<void> => { written.push(filePath); },
      },
      token: TOKEN,
    });
    const takingPort = await taking.start();
    try {
      const reply = await http_post(`http://127.0.0.1:${takingPort}/vfs?path=/x&token=wrong`, 'x');
      expect(reply.status).toBe(404);
      expect(written).toEqual([]);
    } finally {
      await taking.stop();
    }
  });

  it('reports a refused write rather than claiming it landed', async () => {
    const taking = new CalypsoDaemon({
      engine: {
        ...stubEngine_create(),
        file_write: async (): Promise<void> => { throw new Error('the store said no'); },
      },
      token: TOKEN,
    });
    const takingPort = await taking.start();
    try {
      const reply = await http_post(`http://127.0.0.1:${takingPort}/vfs?path=/x&token=${TOKEN}`, 'x');
      expect(reply.status).toBe(502);
      expect(reply.body).toContain('the store said no');
    } finally {
      await taking.stop();
    }
  });

  it('404s a post when the engine offers no file_write', async () => {
    const reply = await http_post(
      `http://127.0.0.1:${port}/vfs?path=/x&token=${TOKEN}`,
      'x',
    );
    expect(reply.status).toBe(404);
  });

  it('404s when the engine offers no file_read', async () => {
    const bare = new CalypsoDaemon({ engine: stubEngine_create(), token: TOKEN });
    const barePort = await bare.start();
    try {
      const reply = await http_get(`http://127.0.0.1:${barePort}/vfs?path=/x&token=${TOKEN}`);
      expect(reply.status).toBe(404);
    } finally {
      await bare.stop();
    }
  });
});

describe('CalypsoDaemon without a web root', () => {
  it('404s plain HTTP while the wire still answers', async () => {
    const daemon = new CalypsoDaemon({ engine: stubEngine_create(), token: TOKEN });
    const port = await daemon.start();
    try {
      const reply = await http_get(`http://127.0.0.1:${port}/`);
      expect(reply.status).toBe(404);
    } finally {
      await daemon.stop();
    }
  });
});

/**
 * How long a browser may keep what the daemon serves.
 *
 * The defect this exists for: nothing said. With no `cache-control`, no
 * `etag` and no `last-modified`, a browser is free to guess and it guesses
 * that it may keep the page — so a rebuilt surface did not arrive at all.
 * The operator restarted the daemon, reloaded, and was served the same
 * `index.html`, which names the same old hashed assets, so the whole
 * surface stayed the previous build with nothing saying why.
 */
describe('cacheControl_forPath', () => {
  it('never lets a browser keep the page that names the assets', () => {
    expect(cacheControl_forPath('/web/index.html')).toBe('no-store');
    expect(cacheControl_forPath('/web/INDEX.HTML')).toBe('no-store');
  });

  it('lets a hashed asset be kept forever, since a new build is a new name', () => {
    expect(cacheControl_forPath('/web/assets/index-DaupQIyb.js')).toBe('public, max-age=31536000, immutable');
    expect(cacheControl_forPath('/web/assets/theme-a1b2c3d4e5.css')).toBe('public, max-age=31536000, immutable');
  });

  it('makes anything else revalidate, which is the safe answer for a name that can be reused', () => {
    expect(cacheControl_forPath('/web/favicon.ico')).toBe('no-cache');
    expect(cacheControl_forPath('/web/fonts/Meslo.woff2')).toBe('no-cache');
  });
});
