/**
 * @file Unit tests for the output sink seam.
 */
import { jest, describe, it, expect, afterEach } from '@jest/globals';
import type { CommandEnvelope } from '@fnndsc/cumin';
import {
  StdoutSink,
  BufferSink,
  sink_get,
  sink_set,
  envelope_deliver,
  envelopeHandler_wrap,
  type OutputSink,
} from '../src/core/sink.js';

afterEach(() => {
  sink_set(new StdoutSink());
  jest.restoreAllMocks();
});

describe('StdoutSink', () => {
  it('writes data to process.stdout', () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    new StdoutSink().data('hello\n');
    expect(writeSpy).toHaveBeenCalledWith('hello\n');
  });

  it('writes status to process.stdout', () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    new StdoutSink().status('\rspinning');
    expect(writeSpy).toHaveBeenCalledWith('\rspinning');
  });
});

describe('BufferSink', () => {
  it('accumulates data chunks in order', () => {
    const sink = new BufferSink();
    sink.data('one ');
    sink.data(Buffer.from('two'));
    expect(sink.text_get()).toBe('one two');
  });

  it('drops status writes', () => {
    const sink = new BufferSink();
    sink.status('transient');
    expect(sink.text_get()).toBe('');
  });
});

describe('sink_set / sink_get', () => {
  it('defaults to a stdout sink', () => {
    expect(sink_get()).toBeInstanceOf(StdoutSink);
  });

  it('installs a sink and returns the previous one', () => {
    const buffer = new BufferSink();
    const previous: OutputSink = sink_set(buffer);
    expect(previous).toBeInstanceOf(StdoutSink);
    expect(sink_get()).toBe(buffer);
  });
});

describe('envelope_deliver', () => {
  it('writes rendered text to the active sink data channel', () => {
    const buffer = new BufferSink();
    sink_set(buffer);
    const envelope: CommandEnvelope = { status: 'ok', rendered: 'result\n' };
    envelope_deliver(envelope);
    expect(buffer.text_get()).toBe('result\n');
  });

  it('writes nothing for an empty rendered string', () => {
    const buffer = new BufferSink();
    sink_set(buffer);
    envelope_deliver({ status: 'ok', rendered: '' });
    expect(buffer.text_get()).toBe('');
  });

  it('reports error detail on the process error stream', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    sink_set(new BufferSink());
    envelope_deliver({
      status: 'error',
      rendered: '',
      errors: [{ type: 'error', message: 'it broke' }],
    });
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('it broke'));
  });
});

describe('envelopeHandler_wrap', () => {
  it('delivers the handler envelope through the active sink', async () => {
    const buffer = new BufferSink();
    sink_set(buffer);
    const handler = async (_args: string[]): Promise<CommandEnvelope> => ({
      status: 'ok',
      rendered: 'wrapped\n',
    });
    await envelopeHandler_wrap(handler)([]);
    expect(buffer.text_get()).toBe('wrapped\n');
  });

  it('passes arguments through to the handler', async () => {
    sink_set(new BufferSink());
    const seen: string[][] = [];
    const handler = async (args: string[]): Promise<CommandEnvelope> => {
      seen.push(args);
      return { status: 'ok', rendered: '' };
    };
    await envelopeHandler_wrap(handler)(['--title', 'x']);
    expect(seen).toEqual([['--title', 'x']]);
  });

  it('tolerates a handler that resolves without an envelope', async () => {
    const buffer = new BufferSink();
    sink_set(buffer);
    const stub = (async () => undefined) as unknown as (args: string[]) => Promise<CommandEnvelope>;
    await expect(envelopeHandler_wrap(stub)([])).resolves.toBeUndefined();
    expect(buffer.text_get()).toBe('');
  });
});
