/**
 * @file The arrival greeting: what `motd` answers, dim, and nothing it refuses.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { BrasaEngine, OutputSink } from '@fnndsc/brasa';
import type { CommandEnvelope } from '@fnndsc/cumin';

// The sink boundary the greeting uses: a host sink, a scope that swaps it
// for the length of one call, and delivery to whichever is active.
let activeSink: OutputSink;
jest.unstable_mockModule('@fnndsc/brasa', () => ({
  sink_get: (): OutputSink => activeSink,
  sink_set: (sink: OutputSink): OutputSink => { const previous: OutputSink = activeSink; activeSink = sink; return previous; },
  sinkScope_run: async <T>(sink: OutputSink, fn: () => Promise<T>): Promise<T> => {
    const previous: OutputSink = activeSink;
    activeSink = sink;
    try { return await fn(); } finally { activeSink = previous; }
  },
  envelope_deliver: (envelope: CommandEnvelope): void => {
    if (envelope.rendered.length > 0) activeSink.data_write(envelope.rendered);
    if (envelope.renderedErr !== undefined && envelope.renderedErr.length > 0) activeSink.err_write(envelope.renderedErr);
  },
}));
// The greeting asks through the surface dispatch; here it is the engine's own line.
jest.unstable_mockModule('../src/core/surfaceDispatch.js', () => ({
  surfaceLine_execute: (engine: BrasaEngine, line: string): Promise<CommandEnvelope[]> => engine.line_execute(line),
}));
const { sink_set, envelope_deliver } = await import('@fnndsc/brasa');
const { greeting_print } = await import('../src/core/greeting.js');

/** An engine whose one line answers the given envelope, delivered as an engine delivers it. */
function engine_answering(envelope: CommandEnvelope): BrasaEngine {
  return {
    line_execute: async (): Promise<CommandEnvelope[]> => { envelope_deliver(envelope); return [envelope]; },
  } as unknown as BrasaEngine;
}

describe('greeting_print', () => {
  const written: string[] = [];
  const host: OutputSink = {
    data_write: (chunk: string | Buffer): void => { written.push(chunk.toString()); },
    err_write: (chunk: string | Buffer): void => { written.push(chunk.toString()); },
    status_write: (): void => undefined,
    progress_write: (): void => undefined,
  };
  let previous: OutputSink;
  let logged: string[];
  beforeEach(() => {
    written.length = 0;
    previous = sink_set(host);
    logged = [];
    jest.spyOn(console, 'log').mockImplementation((line?: unknown): void => { logged.push(String(line ?? '')); });
  });
  afterEach(() => {
    sink_set(previous);
    jest.restoreAllMocks();
  });

  it('prints what motd answers once, dim, and nothing through the session\'s sink', async () => {
    await greeting_print(engine_answering({ status: 'ok', rendered: 'Welcome, chris.\n' }));
    expect(logged.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ''))).toEqual(['Welcome, chris.', '']);
    expect(written).toEqual([]);
  });

  it('says nothing when the backend has no motd', async () => {
    await greeting_print(engine_answering({ status: 'error', rendered: '', renderedErr: 'chell: command not found: motd\n' }));
    expect(logged).toEqual([]);
    expect(written).toEqual([]);
  });

  it('says nothing when the ask throws', async () => {
    await greeting_print({ line_execute: async (): Promise<never> => { throw new Error('gone'); } } as unknown as BrasaEngine);
    expect(logged).toEqual([]);
  });
});
