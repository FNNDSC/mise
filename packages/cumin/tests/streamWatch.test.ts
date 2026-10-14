/**
 * The stall watchdog: a stream that keeps moving passes untouched; one that
 * falls silent is failed with a sentence saying how long and how far.
 */
import { PassThrough, Readable } from 'node:stream';
import { stream_watchStalls } from '../src/io/streamWatch';

async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('stream_watchStalls', () => {
  it('passes a moving stream through whole', async () => {
    const watched: Readable = stream_watchStalls(Readable.from([Buffer.from('ab'), Buffer.from('cd')]), 200, 'file 1');
    expect((await drain(watched)).toString()).toBe('abcd');
  });

  it('fails a stream that never sends a byte, saying so', async () => {
    const silent: PassThrough = new PassThrough();
    const watched: Readable = stream_watchStalls(silent, 50, 'file 30916964');
    await expect(drain(watched)).rejects.toThrow('CUBE sent no bytes of file 30916964 for 0 s');
    expect(silent.destroyed).toBe(true);
  });

  it('fails a stream that stops partway, naming how far it got', async () => {
    const source: PassThrough = new PassThrough();
    const watched: Readable = stream_watchStalls(source, 60, 'file 7');
    source.write(Buffer.from('12345'));
    await expect(drain(watched)).rejects.toThrow('CUBE stopped sending file 7 after 5 bytes');
  });

  it('a slow stream that keeps moving is never failed', async () => {
    const source: PassThrough = new PassThrough();
    const watched: Readable = stream_watchStalls(source, 80, 'file 9');
    const draining: Promise<Buffer> = drain(watched);
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      source.write(Buffer.from('x'));
    }
    source.end();
    expect((await draining).toString()).toBe('xxxx');
  });

  it('passes a source error on', async () => {
    const source: PassThrough = new PassThrough();
    const watched: Readable = stream_watchStalls(source, 1000, 'file 3');
    const draining: Promise<Buffer> = drain(watched);
    source.destroy(new Error('socket hang up'));
    await expect(draining).rejects.toThrow('socket hang up');
  });
});
