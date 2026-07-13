/**
 * @file Unit tests for the output sink seam.
 */
import { jest, describe, it, expect, afterEach } from '@jest/globals';
import type { CommandEnvelope } from '@fnndsc/cumin';
import {
  ansi_strip,
  StdoutSink,
  BufferSink,
  CaptureSink,
  PipeCaptureSink,
  sink_get,
  sink_set,
  sink_dataLine,
  sink_errLine,
  sinkScope_run,
  envelope_deliver,
  envelopeHandler_wrap,
  type OutputSink,
} from '../src/core/sink.js';
import type { ProgressRenderer } from '../src/core/progress.js';

afterEach(() => {
  sink_set(new StdoutSink());
  jest.restoreAllMocks();
});

describe('StdoutSink', () => {
  it('writes data to process.stdout', () => {
    const writeSpy: jest.SpiedFunction<typeof process.stdout.write> = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    new StdoutSink().data_write('hello\n');
    expect(writeSpy).toHaveBeenCalledWith('hello\n');
  });

  it('writes status to process.stdout', () => {
    const writeSpy: jest.SpiedFunction<typeof process.stdout.write> = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    new StdoutSink().status_write('\rspinning');
    expect(writeSpy).toHaveBeenCalledWith('\rspinning');
  });

  it('delegates progress to its renderer', () => {
    const write = jest.fn();
    const renderer = { write } as unknown as ProgressRenderer;
    const event = { operation: 'upload', phase: 'transferring', current: 1, total: 2, unit: 'files', status: 'running' } as const;
    new StdoutSink(renderer).progress_write(event);
    expect(write).toHaveBeenCalledWith(event);
  });
});

describe('BufferSink', () => {
  it('accumulates data chunks in order', () => {
    const sink: BufferSink = new BufferSink();
    sink.data_write('one ');
    sink.data_write(Buffer.from('two'));
    expect(sink.text_get()).toBe('one two');
  });

  it('drops status writes', () => {
    const sink: BufferSink = new BufferSink();
    sink.status_write('transient');
    expect(sink.text_get()).toBe('');
  });

  it('drops progress writes', () => {
    const sink: BufferSink = new BufferSink();
    sink.progress_write({ operation: 'download', phase: 'transferring', current: 1, total: 2, unit: 'files' });
    expect(sink.text_get()).toBe('');
  });
});

describe('sink_set / sink_get', () => {
  it('defaults to a stdout sink', () => {
    expect(sink_get()).toBeInstanceOf(StdoutSink);
  });

  it('installs a sink and returns the previous one', () => {
    const buffer: BufferSink = new BufferSink();
    const previous: OutputSink = sink_set(buffer);
    expect(previous).toBeInstanceOf(StdoutSink);
    expect(sink_get()).toBe(buffer);
  });
});

describe('envelope_deliver', () => {
  it('writes rendered text to the active sink data channel', () => {
    const buffer: BufferSink = new BufferSink();
    sink_set(buffer);
    const envelope: CommandEnvelope = { status: 'ok', rendered: 'result\n' };
    envelope_deliver(envelope);
    expect(buffer.text_get()).toBe('result\n');
  });

  it('writes nothing for an empty rendered string', () => {
    const buffer: BufferSink = new BufferSink();
    sink_set(buffer);
    envelope_deliver({ status: 'ok', rendered: '' });
    expect(buffer.text_get()).toBe('');
  });

  it('writes renderedErr to the err channel, not the data channel', () => {
    const buffer: BufferSink = new BufferSink();
    sink_set(buffer);
    const errSpy: jest.SpiedFunction<typeof process.stderr.write> = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    envelope_deliver({
      status: 'error',
      rendered: '',
      renderedErr: 'cd: /nope: No such file or directory\n',
    });
    expect(buffer.text_get()).toBe('');
    expect(errSpy).toHaveBeenCalledWith('cd: /nope: No such file or directory\n');
  });

  it('does not present the structured errors field', () => {
    const errSpy: jest.SpiedFunction<typeof console.error> = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    sink_set(new BufferSink());
    envelope_deliver({
      status: 'error',
      rendered: '',
      errors: [{ type: 'error', message: 'machine detail' }],
    });
    expect(errSpy).not.toHaveBeenCalled();
  });
});

describe('err channel', () => {
  it('StdoutSink routes err_write to process.stderr', () => {
    const errSpy: jest.SpiedFunction<typeof process.stderr.write> = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    new StdoutSink().err_write('boom\n');
    expect(errSpy).toHaveBeenCalledWith('boom\n');
  });

  it('BufferSink passes err_write through to process.stderr without capturing', () => {
    const errSpy: jest.SpiedFunction<typeof process.stderr.write> = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const sink: BufferSink = new BufferSink();
    sink.err_write('warn\n');
    expect(errSpy).toHaveBeenCalledWith('warn\n');
    expect(sink.text_get()).toBe('');
  });
});

describe('envelopeHandler_wrap', () => {
  it('delivers the handler envelope through the active sink', async () => {
    const buffer: BufferSink = new BufferSink();
    sink_set(buffer);
    const handler: (args: string[]) => Promise<CommandEnvelope> = async (_args: string[]): Promise<CommandEnvelope> => ({
      status: 'ok',
      rendered: 'wrapped\n',
    });
    await envelopeHandler_wrap(handler)([]);
    expect(buffer.text_get()).toBe('wrapped\n');
  });

  it('passes arguments through to the handler', async () => {
    sink_set(new BufferSink());
    const seen: string[][] = [];
    const handler: (args: string[]) => Promise<CommandEnvelope> = async (args: string[]): Promise<CommandEnvelope> => {
      seen.push(args);
      return { status: 'ok', rendered: '' };
    };
    await envelopeHandler_wrap(handler)(['--title', 'x']);
    expect(seen).toEqual([['--title', 'x']]);
  });

  it('tolerates a handler that resolves without an envelope', async () => {
    const buffer: BufferSink = new BufferSink();
    sink_set(buffer);
    const stub: (args: string[]) => Promise<CommandEnvelope> = (async () => undefined) as unknown as (args: string[]) => Promise<CommandEnvelope>;
    await expect(envelopeHandler_wrap(stub)([])).resolves.toBeUndefined();
    expect(buffer.text_get()).toBe('');
  });
});

describe('CaptureSink', () => {
  it('buffers data and err channels separately', () => {
    const capture: CaptureSink = new CaptureSink(new BufferSink());
    capture.data_write('out ');
    capture.data_write(Buffer.from('bytes'));
    capture.err_write('bad\n');
    expect(capture.dataText_get()).toBe('out bytes');
    expect(capture.errText_get()).toBe('bad\n');
  });

  it('passes status through to the live sink', () => {
    const live: BufferSink = new BufferSink();
    const statusSeen: string[] = [];
    const liveSpy: OutputSink = {
      data_write: (chunk: string | Buffer): void => live.data_write(chunk),
      err_write: (chunk: string | Buffer): void => live.err_write(chunk),
      status_write: (text: string): void => { statusSeen.push(text); },
      progress_write: (): void => { /* not used */ },
    };
    const capture: CaptureSink = new CaptureSink(liveSpy);
    capture.status_write('\rspinning');
    expect(statusSeen).toEqual(['\rspinning']);
    expect(capture.dataText_get()).toBe('');
  });

  it('passes progress through to the live sink', () => {
    const progressSeen: string[] = [];
    const liveSpy: OutputSink = {
      data_write: (): void => { /* not used */ },
      err_write: (): void => { /* not used */ },
      status_write: (): void => { /* not used */ },
      progress_write: (event): void => { progressSeen.push(event.operation); },
    };
    const capture: CaptureSink = new CaptureSink(liveSpy);
    capture.progress_write({ operation: 'pull', phase: 'watching', status: 'running' });
    expect(progressSeen).toEqual(['pull']);
    expect(capture.dataText_get()).toBe('');
  });

  it('optionally forwards captured data and err to the live sink', () => {
    const liveData: string[] = [];
    const liveErr: string[] = [];
    const liveSpy: OutputSink = {
      data_write: (chunk: string | Buffer): void => { liveData.push(chunk.toString()); },
      err_write: (chunk: string | Buffer): void => { liveErr.push(chunk.toString()); },
      status_write: (): void => { /* not used */ },
      progress_write: (): void => { /* not used */ },
    };
    const capture: CaptureSink = new CaptureSink(liveSpy, { forwardEnvelopeOutput: true });
    capture.data_write('out');
    capture.err_write('err');
    expect(capture.dataText_get()).toBe('out');
    expect(capture.errText_get()).toBe('err');
    expect(liveData).toEqual(['out']);
    expect(liveErr).toEqual(['err']);
  });
});

describe('PipeCaptureSink', () => {
  it('ANSI-strips text writes and keeps binary writes raw, in order', () => {
    const pipe: PipeCaptureSink = new PipeCaptureSink();
    pipe.data_write('\x1b[32mgreen\x1b[0m ');
    pipe.data_write(Buffer.from([0x00, 0x01, 0xff]));
    const buffer: Buffer = pipe.buffer_get();
    expect(buffer.subarray(0, 6).toString('utf-8')).toBe('green ');
    expect(Array.from(buffer.subarray(6))).toEqual([0x00, 0x01, 0xff]);
  });

  it('passes the err channel through to stderr and drops status/progress', () => {
    const pipe: PipeCaptureSink = new PipeCaptureSink();
    const errSpy: jest.SpiedFunction<typeof process.stderr.write> = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    pipe.err_write('oops\n');
    pipe.status_write('spinner');
    pipe.progress_write({} as never);
    expect(errSpy).toHaveBeenCalledWith('oops\n');
    expect(pipe.buffer_get().length).toBe(0);
  });
});

describe('sink line writers', () => {
  it('sink_dataLine writes a line to the active data channel', () => {
    const buffer: BufferSink = new BufferSink();
    sink_set(buffer);
    sink_dataLine('hello');
    expect(buffer.text_get()).toBe('hello\n');
  });

  it('sink_errLine writes a line to the active err channel', () => {
    const errSpy: jest.SpiedFunction<typeof process.stderr.write> = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    sink_set(new BufferSink());
    sink_errLine('bad');
    expect(errSpy).toHaveBeenCalledWith('bad\n');
  });
});

describe('sinkScope_run', () => {
  it('scopes the sink for the callback and restores it afterwards', async () => {
    const host: BufferSink = new BufferSink();
    sink_set(host);
    const scoped: BufferSink = new BufferSink();
    const seen: OutputSink = await sinkScope_run(scoped, async (): Promise<OutputSink> => {
      sink_get().data_write('inside');
      return sink_get();
    });
    expect(seen).toBe(scoped);
    expect(scoped.text_get()).toBe('inside');
    expect(host.text_get()).toBe('');
    expect(sink_get()).toBe(host);
  });
});

describe('ansi_strip', () => {
  it('removes SGR color sequences', () => {
    expect(ansi_strip('\x1b[32mgreen\x1b[0m plain')).toBe('green plain');
  });

  it('removes cursor and erase sequences', () => {
    expect(ansi_strip('\x1b[K\x1b[2Jtext\x1b[1;31mred')).toBe('textred');
  });

  it('leaves plain text untouched', () => {
    expect(ansi_strip('just text\n')).toBe('just text\n');
  });
});
