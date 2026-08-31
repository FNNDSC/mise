/**
 * Pipeline package store tests: durable restore, lookup, and the sweep's
 * fetch-only-unseen behavior.
 */
import { mkdtempSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const context_getSingle = jest.fn(async () => ({ URL: 'http://cube.test/api/v1/' }));
const pipelines_list = jest.fn();
const pipeline_get = jest.fn();
const client_get = jest.fn(async () => ({}));
const pipelineManifestForPipeline_get = jest.fn();

jest.mock('../src/context/index', () => ({ context_getSingle }));
jest.mock('../src/pipelines/manifest', () => ({ pipelineManifestForPipeline_get }));
jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  pipelines_list,
  pipeline_get,
  chrisConnection: { client_get },
}));

import {
  pipelinePackage_find,
  pipelinePackagesPath_get,
  pipelinePackages_all,
  pipelinePackages_restore,
  pipelinePackages_sweep,
} from '../src/pipelines/packages';
import { pipelineDiagram_get } from '../src/pipelines/diagram';

const MANIFEST = {
  pipelineID: 7,
  name: 'brainy',
  rootIDs: [1],
  nodes: [{ pipingID: 1, title: 'root', pluginName: 'pl-dircopy', pluginVersion: '1.0',
    parentID: null, computeResourceName: 'host',
    parameterDefaults: [
      { name: 'label', value: 'x' },
      { name: 'plugininstances', value: '2,3' },
    ] }],
};

describe('pipeline package store', () => {
  it('restores a durable file and finds packages by name, slug, and id', async () => {
    const root: string = mkdtempSync(join(tmpdir(), 'pkg-'));
    writeFileSync(pipelinePackagesPath_get('http://cube.test/api/v1/', root), JSON.stringify({
      schema: 1,
      savedAt: 'now',
      packages: [
        { id: 7, name: 'brainy', slug: 'brainy_x1', authors: 'a', manifest: MANIFEST },
        { id: 9, name: 'broken (no manifest)' },
      ],
    }));
    await pipelinePackages_restore(root);
    expect(pipelinePackages_all().map((p) => p.id)).toEqual([7]);
    expect(pipelinePackage_find('brainy')?.id).toBe(7);
    expect(pipelinePackage_find('brainy_x1')?.id).toBe(7);
    expect(pipelinePackage_find('7')?.id).toBe(7);
    expect(pipelinePackage_find('unknown')).toBeNull();
  });

  it('sweeps only unseen pipelines and persists the grown store', async () => {
    // The store still holds pipeline 7 from the restore above (same key).
    pipelines_list.mockResolvedValue({ ok: true, value: [
      { id: 7, name: 'brainy' },
      { id: 8, name: 'newcomer', authors: 'b' },
    ] });
    pipeline_get.mockResolvedValue({});
    pipelineManifestForPipeline_get.mockResolvedValue({ ok: true, value: { ...MANIFEST, pipelineID: 8, name: 'newcomer' } });

    const root: string = mkdtempSync(join(tmpdir(), 'pkg-'));
    await pipelinePackages_sweep(root);

    expect(pipeline_get).toHaveBeenCalledTimes(1);
    expect(pipeline_get).toHaveBeenCalledWith(expect.anything(), 8);
    expect(pipelinePackage_find('newcomer')?.id).toBe(8);

    const saved = JSON.parse(await readFile(pipelinePackagesPath_get('http://cube.test/api/v1/', root), 'utf8'));
    expect(saved.packages.map((p: { id: number }) => p.id).sort()).toEqual([7, 8]);
    expect(pipelinePackages_all().map((p) => p.name)).toEqual(['brainy', 'newcomer']);
  });

  it('serves a diagram straight from the package store, wire-free', async () => {
    // 'brainy' is in the store from the tests above; the diagram path must
    // answer from it without resolving or fetching anything.
    const result = await pipelineDiagram_get('brainy');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pipelineID).toBe(7);
      expect(result.value.rootIDs).toEqual([1]);
      expect(result.value.nodes[0]).toMatchObject({
        id: 1,
        pluginName: 'pl-dircopy',
        parentID: null,
        joinParentIDs: [2, 3],
        arguments: [
          { name: 'label', value: 'x' },
          { name: 'plugininstances', value: '2,3' },
        ],
      });
    }
  });
});
