import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { get, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import { CalypsoDaemon } from '../src/daemon/server';
import { webRoot_resolve } from '../src/daemon/static';
import type { HostedEngine } from '../src/daemon/engine';
import { CONTRACT_VERSION } from '../src/protocol/version';
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
function http_get(url: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    get(url, (response: IncomingMessage) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          type: String(response.headers['content-type'] ?? ''),
          body: Buffer.concat(chunks).toString('utf-8'),
        }),
      );
    }).on('error', reject);
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

  it('serves index.html at the root path', async () => {
    const reply = await http_get(`http://127.0.0.1:${port}/`);
    expect(reply.status).toBe(200);
    expect(reply.type).toContain('text/html');
    expect(reply.body).toContain('argus');
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
