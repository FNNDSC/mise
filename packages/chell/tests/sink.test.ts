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
  sink_get,
  sink_set,
  envelope_deliver,
  envelopeHandler_wrap,
  printingHandler_wrap,
  type OutputSink,
} from '../src/core/sink.js';
import { TerminalProgressRenderer } from '../src/core/progressRenderer.js';

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
    const renderer = { write } as unknown as TerminalProgressRenderer;
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

describe('printingHandler_wrap', () => {
  it('captures console.log output into the envelope rendered text', async () => {
    sink_set(new BufferSink());
    const handler = async (_args: string[]): Promise<void> => {
      console.log('table row');
    };
    const envelope: CommandEnvelope = await printingHandler_wrap(handler)([]);
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toBe('table row\n');
  });

  it('captures console.error output into renderedErr', async () => {
    sink_set(new BufferSink());
    const handler = async (_args: string[]): Promise<void> => {
      console.error('bad thing');
    };
    const envelope: CommandEnvelope = await printingHandler_wrap(handler)([]);
    expect(envelope.renderedErr).toBe('bad thing\n');
  });

  it('captures direct process.stdout.write output', async () => {
    sink_set(new BufferSink());
    const handler = async (_args: string[]): Promise<void> => {
      process.stdout.write('raw chunk');
    };
    const envelope: CommandEnvelope = await printingHandler_wrap(handler)([]);
    expect(envelope.rendered).toBe('raw chunk');
  });

  it('streams captured output live when the active sink opts in', async () => {
    const liveData: string[] = [];
    const liveErr: string[] = [];
    const liveSink: OutputSink & { liveEnvelopeOutput: true } = {
      liveEnvelopeOutput: true,
      data_write: (chunk: string | Buffer): void => { liveData.push(chunk.toString()); },
      err_write: (chunk: string | Buffer): void => { liveErr.push(chunk.toString()); },
      status_write: (): void => { /* not used */ },
      progress_write: (): void => { /* not used */ },
    };
    sink_set(liveSink);
    const handler = async (_args: string[]): Promise<void> => {
      console.log('live row');
      console.error('live err');
    };
    const envelope: CommandEnvelope = await printingHandler_wrap(handler)([]);
    expect(envelope.rendered).toBe('live row\n');
    expect(envelope.renderedErr).toBe('live err\n');
    expect(liveData).toEqual(['live row\n']);
    expect(liveErr).toEqual(['live err\n']);
  });

  it('captures Uint8Array stdout writes', async () => {
    sink_set(new BufferSink());
    const handler = async (_args: string[]): Promise<void> => {
      process.stdout.write(new Uint8Array(Buffer.from('raw bytes')) as unknown as string);
    };
    const envelope: CommandEnvelope = await printingHandler_wrap(handler)([]);
    expect(envelope.rendered).toBe('raw bytes');
  });

  it('serializes non-string console arguments', async () => {
    sink_set(new BufferSink());
    const handler = async (_args: string[]): Promise<void> => {
      console.log('count:', 3);
    };
    const envelope: CommandEnvelope = await printingHandler_wrap(handler)([]);
    expect(envelope.rendered).toBe('count: 3\n');
  });

  it('derives error status from a handler-set exit code', async () => {
    sink_set(new BufferSink());
    const previousExitCode: number = typeof process.exitCode === 'number' ? process.exitCode : 0;
    process.exitCode = 0;
    const handler = async (_args: string[]): Promise<void> => {
      process.exitCode = 1;
    };
    const envelope: CommandEnvelope = await printingHandler_wrap(handler)([]);
    expect(envelope.status).toBe('error');
    process.exitCode = previousExitCode;
  });

  it('restores console and sink even when the handler throws', async () => {
    const buffer: BufferSink = new BufferSink();
    sink_set(buffer);
    const originalLog: typeof console.log = console.log;
    const handler = async (_args: string[]): Promise<void> => {
      throw new Error('boom');
    };
    await expect(printingHandler_wrap(handler)([])).rejects.toThrow('boom');
    expect(console.log).toBe(originalLog);
    expect(sink_get()).toBe(buffer);
  });

  it('passes arguments through to the wrapped handler', async () => {
    sink_set(new BufferSink());
    const seen: string[][] = [];
    const handler = async (args: string[]): Promise<void> => {
      seen.push(args);
    };
    await printingHandler_wrap(handler)(['--limit', '2']);
    expect(seen).toEqual([['--limit', '2']]);
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
