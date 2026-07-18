/**
 * @file Contract tests for resolving ambiguous dynamic `/bin` entry names.
 *
 * These tests ensure registered Pipelines win by identity even when their names
 * contain the plugin-like `-v` substring.
 *
 * @module
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { sink_set, type OutputSink } from '../src/core/sink.js';
import type { ProgressEvent } from '../src/core/progress.js';

const manifestGet = jest.fn();
const manifestBySlugGet = jest.fn();
const pipelinesGetAll = jest.fn();
const checkpointMark = jest.fn(() => 7);
const checkpointDrain = jest.fn();

jest.unstable_mockModule('@fnndsc/salsa', () => ({
  pipelineManifest_get: manifestGet,
  pipelineManifestBySlug_get: manifestBySlugGet,
  pipelines_getAll: pipelinesGetAll,
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  errorStack: { checkpoint_mark: checkpointMark, checkpoint_drain: checkpointDrain },
}));

const { binPipelineManifest_try } = await import('../src/lib/vfs/providers/binEntry.js');

interface ProgressSinkHarness {
  events: ProgressEvent[];
  sink_restore(): void;
}

function progressSink_install(): ProgressSinkHarness {
  jest.useFakeTimers();
  const events: ProgressEvent[] = [];
  const sink: OutputSink = {
    data_write: (): void => { /* not used */ },
    err_write: (): void => { /* not used */ },
    status_write: (): void => { /* not used */ },
    progress_write: (event: ProgressEvent): void => { events.push(event); },
  };
  const previousSink: OutputSink = sink_set(sink);
  return {
    events,
    sink_restore: (): void => {
      sink_set(previousSink);
      jest.useRealTimers();
    },
  };
}

describe('binPipelineManifest_try', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves a registered pipeline before plugin-like name parsing', async () => {
    const manifest = { pipelineID: 27, name: 'registration-v2_id27', rootIDs: [], nodes: [] };
    pipelinesGetAll.mockRejectedValue(new Error('global enumeration must not run'));
    manifestGet.mockRejectedValue(new Error('numeric Pipeline resolution must not repeat'));
    manifestBySlugGet.mockResolvedValue({ ok: true, value: manifest });

    await expect(binPipelineManifest_try('registration-v2_id27')).resolves.toBe(manifest);
    expect(manifestBySlugGet).toHaveBeenCalledWith('registration-v2_id27');
    expect(checkpointDrain).not.toHaveBeenCalled();
  });

  it('emits semantic progress only after a slow Pipeline read crosses the delay', async () => {
    const harness: ProgressSinkHarness = progressSink_install();
    let resolveManifest: ((value: unknown) => void) | undefined;
    manifestBySlugGet.mockReturnValue(new Promise((resolve: (value: unknown) => void) => {
      resolveManifest = resolve;
    }));

    try {
      const pending: Promise<unknown> = binPipelineManifest_try('example_pipeline_id42');
      await jest.advanceTimersByTimeAsync(299);
      expect(harness.events).toEqual([]);

      await jest.advanceTimersByTimeAsync(1);
      expect(harness.events).toEqual([{
        operation: 'pipeline',
        kind: 'inspection',
        phase: 'reading',
        label: 'Reading registered pipeline…',
        status: 'running',
      }]);

      resolveManifest?.({
        ok: true,
        value: { pipelineID: 42, name: 'Example Pipeline', rootIDs: [], nodes: [] },
      });
      await pending;
      expect(harness.events.at(-1)).toEqual({
        operation: 'pipeline',
        kind: 'inspection',
        phase: 'complete',
        label: 'Reading registered pipeline…',
        status: 'done',
      });
    } finally {
      harness.sink_restore();
    }
  });

  it('does not emit progress for a Pipeline manifest cache hit', async () => {
    const harness: ProgressSinkHarness = progressSink_install();
    manifestBySlugGet.mockResolvedValue({
      ok: true,
      value: { pipelineID: 42, name: 'Example Pipeline', rootIDs: [], nodes: [] },
    });

    try {
      await binPipelineManifest_try('example_pipeline_id42');
      await jest.runAllTimersAsync();
      expect(harness.events).toEqual([]);
    } finally {
      harness.sink_restore();
    }
  });

  it('reports failed semantic progress when a slow Pipeline read rejects', async () => {
    const harness: ProgressSinkHarness = progressSink_install();
    let rejectManifest: ((reason: Error) => void) | undefined;
    manifestBySlugGet.mockReturnValue(new Promise((
      _resolve: (value: unknown) => void,
      reject: (reason: Error) => void,
    ) => {
      rejectManifest = reject;
    }));

    try {
      const pending: Promise<unknown> = binPipelineManifest_try('example_pipeline_id42');
      const rejection: Promise<void> = expect(pending).rejects.toThrow('CUBE unavailable');
      await jest.advanceTimersByTimeAsync(300);
      rejectManifest?.(new Error('CUBE unavailable'));
      await rejection;
      expect(harness.events.at(-1)).toEqual({
        operation: 'pipeline',
        kind: 'inspection',
        phase: 'failed',
        label: 'Reading registered pipeline…',
        status: 'error',
      });
    } finally {
      harness.sink_restore();
    }
  });

  it('drains only failed pipeline-probe errors before plugin fallback', async () => {
    pipelinesGetAll.mockResolvedValue({ ok: true, value: [] });
    manifestBySlugGet.mockResolvedValue({ ok: false });

    await expect(binPipelineManifest_try('pl-example-v1.0.0')).resolves.toBeNull();
    expect(manifestGet).not.toHaveBeenCalled();
    expect(checkpointDrain).toHaveBeenCalledWith(7);
  });

  it('falls through when exact targeted Pipeline resolution fails', async () => {
    pipelinesGetAll.mockResolvedValue({ ok: false });
    manifestBySlugGet.mockResolvedValue({ ok: false });

    await expect(binPipelineManifest_try('pl-example-v1.0.0')).resolves.toBeNull();
    expect(manifestGet).not.toHaveBeenCalled();
    expect(checkpointDrain).toHaveBeenCalledWith(7);
  });

  it('falls through when an exact pipeline cannot produce a manifest', async () => {
    pipelinesGetAll.mockResolvedValue({
      ok: true,
      value: [{ id: 27, name: 'Registration v2', slug: 'registration-v2_id27' }],
    });
    manifestBySlugGet.mockResolvedValue({ ok: false });

    await expect(binPipelineManifest_try('registration-v2_id27')).resolves.toBeNull();
    expect(checkpointDrain).toHaveBeenCalledWith(7);
  });
});
