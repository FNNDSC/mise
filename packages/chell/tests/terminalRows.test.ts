/**
 * @file Rows are not newlines: the counter reads what the terminal does.
 *
 * @module
 */
import { describe, expect, it } from '@jest/globals';
import { RowCounter, streamRows_track, type RowStream } from '../src/lib/terminalRows.js';

describe('RowCounter', () => {
  it('counts a wrapped line as the rows it occupies, and an exactly-full line as one', () => {
    const counter = new RowCounter({ columns: 40 });
    expect(counter.count(`${'x'.repeat(100)}\n`)).toBe(3);
    expect(counter.count(`${'x'.repeat(40)}\n`)).toBe(1);
    expect(counter.rows_get()).toBe(4);
  });

  it('keeps the column of an unterminated write and carries it into the next', () => {
    const counter = new RowCounter({ columns: 40 });
    expect(counter.count('x'.repeat(30))).toBe(0);
    expect(counter.column_get()).toBe(30);
    expect(counter.count(`${'y'.repeat(20)}\n`)).toBe(2);
  });

  it('treats a carriage return as a redraw: a spinner\'s frames never wrap', () => {
    const counter = new RowCounter({ columns: 40 });
    for (let frame: number = 0; frame < 50; frame++) counter.count(`\r${'-'.repeat(30)} ${frame}`);
    expect(counter.rows_get()).toBe(0);
    expect(counter.column_get()).toBe(33);
  });

  it('nets a save-move-paint-restore to nothing, as the screen does', () => {
    const counter = new RowCounter({ columns: 80 });
    counter.count('one\ntwo\n');
    counter.count('\x1b[s');
    counter.count('\x1b[2A\r');
    counter.count(`\r${'art'.repeat(10)}\x1b[1B`);
    counter.count('\x1b[u');
    expect(counter.rows_get()).toBe(2);
    expect(counter.column_get()).toBe(0);
  });

  it('ignores escapes, which occupy no columns', () => {
    const counter = new RowCounter({ columns: 80 });
    expect(counter.count(`\x1b[32m${'x'.repeat(70)}\x1b[0m\n`)).toBe(1);
  });
});

describe('streamRows_track', () => {
  function stream_make(): RowStream & { out: string[] } {
    const stream: RowStream & { out: string[] } = {
      out: [],
      columns: 80,
      write(chunk: string | Uint8Array): boolean {
        stream.out.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    };
    return stream;
  }

  it('counts every write that passes, lets a raw write past, and unhooks cleanly', () => {
    const stream = stream_make();
    const tracked = streamRows_track(stream);
    stream.write('a\n');
    stream.write('b\n');
    tracked.write_raw('\x1b[s\x1b[1A\rB\x1b[u');
    expect(tracked.counter.rows_get()).toBe(2);
    expect(stream.out).toHaveLength(3);
    tracked.stop();
    stream.write('c\n');
    expect(tracked.counter.rows_get()).toBe(2);
  });

  it('lets two streams on one screen share a counter', () => {
    const out = stream_make();
    const err = stream_make();
    const tracked = streamRows_track(out);
    streamRows_track(err, tracked.counter);
    out.write('a\n');
    err.write('warning\n');
    expect(tracked.counter.rows_get()).toBe(2);
  });
});
