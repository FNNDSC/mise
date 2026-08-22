/**
 * Tests for the correlated request broker: settle/fail correlation, origin
 * validation, close-guard rejection, and close-listener hygiene. A bare
 * EventEmitter stands in for the WebSocket.
 */
import { EventEmitter } from 'events';
import { RequestBroker } from '../src/daemon/broker';
import type { WebSocket } from 'ws';

function socket_make(): WebSocket {
  return new EventEmitter() as unknown as WebSocket;
}

describe('RequestBroker', () => {
  it('resolves a request settled from its origin socket', async () => {
    const broker = new RequestBroker<string>('p', 'gone');
    const socket = socket_make();
    let sentId: string = '';
    const reply = broker.open(socket, (id) => { sentId = id; });
    broker.settle(socket, sentId, 'answer');
    await expect(reply).resolves.toBe('answer');
  });

  it('generates distinct prefixed ids', async () => {
    const broker = new RequestBroker<string>('p', 'gone');
    const socket = socket_make();
    const ids: string[] = [];
    const a = broker.open(socket, (id) => ids.push(id));
    const b = broker.open(socket, (id) => ids.push(id));
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids.every((id) => id.startsWith('p'))).toBe(true);
    broker.settle(socket, ids[0], 'one');
    broker.settle(socket, ids[1], 'two');
    await expect(a).resolves.toBe('one');
    await expect(b).resolves.toBe('two');
  });

  it('rejects a request failed from its origin socket', async () => {
    const broker = new RequestBroker<string>('p', 'gone');
    const socket = socket_make();
    let sentId: string = '';
    const reply = broker.open(socket, (id) => { sentId = id; });
    broker.fail(socket, sentId, 'surface said no');
    await expect(reply).rejects.toThrow('surface said no');
  });

  it('ignores settles and failures from a socket other than the origin', async () => {
    const broker = new RequestBroker<string>('p', 'gone');
    const origin = socket_make();
    const intruder = socket_make();
    let sentId: string = '';
    const reply = broker.open(origin, (id) => { sentId = id; });
    broker.settle(intruder, sentId, 'forged');
    broker.fail(intruder, sentId, 'forged failure');
    // Still pending: only the origin may settle.
    broker.settle(origin, sentId, 'real');
    await expect(reply).resolves.toBe('real');
  });

  it('rejects with the disconnect reason when the origin closes first', async () => {
    const broker = new RequestBroker<string>('p', 'surface disconnected');
    const socket = socket_make();
    const reply = broker.open(socket, () => undefined);
    (socket as unknown as EventEmitter).emit('close');
    await expect(reply).rejects.toThrow('surface disconnected');
  });

  it('removes its close listener once settled (no per-request leak)', async () => {
    const broker = new RequestBroker<string>('p', 'gone');
    const socket = socket_make();
    const emitter = socket as unknown as EventEmitter;
    let sentId: string = '';
    const reply = broker.open(socket, (id) => { sentId = id; });
    expect(emitter.listenerCount('close')).toBe(1);
    broker.settle(socket, sentId, 'done');
    await reply;
    expect(emitter.listenerCount('close')).toBe(0);
  });

  it('ignores settles for unknown ids', () => {
    const broker = new RequestBroker<string>('p', 'gone');
    const socket = socket_make();
    expect(() => broker.settle(socket, 'p999', 'nothing')).not.toThrow();
    expect(() => broker.fail(socket, 'p999', 'nothing')).not.toThrow();
  });

  it('supports caller-supplied ids via openWithId', async () => {
    const broker = new RequestBroker<number>('r', 'gone');
    const socket = socket_make();
    const reply = broker.openWithId('42', socket, (id) => expect(id).toBe('42'));
    broker.settle(socket, '42', 7);
    await expect(reply).resolves.toBe(7);
  });
});
