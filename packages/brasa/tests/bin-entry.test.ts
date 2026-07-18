/**
 * @file Contract tests for resolving ambiguous dynamic `/bin` entry names.
 *
 * These tests ensure registered Pipelines win by identity even when their names
 * contain the plugin-like `-v` substring.
 *
 * @module
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

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
