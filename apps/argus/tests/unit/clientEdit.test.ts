/**
 * @file The session asks this surface to edit a file: the client hands it to
 * the host's editor pane and answers the waiting command at once that it
 * opened, or refuses in words when there is no pane to open.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { CONTRACT_VERSION } from '@fnndsc/menu';
import { ArgusClient, type ClientHandlers, type SurfaceEdit } from '../../src/calypso/client.js';

/** A socket the test drives: it records what the client sends. */
class FakeSocket {
  public static last: FakeSocket | null = null;
  public sent: Array<Record<string, unknown>> = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: (() => void) | null = null;

  constructor(_url: string) {
    FakeSocket.last = this;
    queueMicrotask((): void => this.onopen?.());
  }

  public send(text: string): void {
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }

  public close(): void { /* nothing to release */ }

  public deliver(message: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

/** Attaches a client over the fake socket with the given handlers. */
async function client_attach(handlers: ClientHandlers): Promise<FakeSocket> {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
  const attaching: Promise<unknown> = ArgusClient.session_attach('ws://test', 'token', handlers);
  await Promise.resolve();
  const socket: FakeSocket = FakeSocket.last as FakeSocket;
  socket.deliver({ type: 'attached', session: 's', protocolVersion: CONTRACT_VERSION });
  await attaching;
  socket.sent = [];
  return socket;
}

describe('an edit the session asks of this surface', () => {
  beforeEach((): void => { FakeSocket.last = null; });

  it('opens the pane with the path and answers that it opened, saving nothing', async () => {
    const seen: SurfaceEdit[] = [];
    const socket: FakeSocket = await client_attach({ edit_receive: (request: SurfaceEdit): boolean => { seen.push(request); return true; } });
    socket.deliver({ type: 'edit', editId: 'e1', content: 'the note', extension: '.txt', path: '/proc/jobs/feed_12/note' });
    expect(seen).toEqual([{ content: 'the note', extension: '.txt', path: '/proc/jobs/feed_12/note' }]);
    expect(socket.sent).toEqual([{ type: 'editResult', editId: 'e1', content: 'the note', changed: false, opened: true }]);
  });

  it('refuses in words when the host has no editor pane', async () => {
    const socket: FakeSocket = await client_attach({});
    socket.deliver({ type: 'edit', editId: 'e2', content: 'x' });
    expect(socket.sent).toEqual([{ type: 'editError', editId: 'e2', reason: 'the argus surface cannot open an editor' }]);
  });

  it('refuses when the pane did not open, and carries the pane\'s own reason when it threw', async () => {
    const declined: FakeSocket = await client_attach({ edit_receive: (): boolean => false });
    declined.deliver({ type: 'edit', editId: 'e3', content: 'x', path: '/home/u/a.txt' });
    expect(declined.sent).toEqual([{ type: 'editError', editId: 'e3', reason: 'the editor pane did not open' }]);

    const threw: FakeSocket = await client_attach({ edit_receive: (): boolean => { throw new Error('a.txt: binary file'); } });
    threw.deliver({ type: 'edit', editId: 'e4', content: 'x' });
    expect(threw.sent).toEqual([{ type: 'editError', editId: 'e4', reason: 'a.txt: binary file' }]);
  });
});
