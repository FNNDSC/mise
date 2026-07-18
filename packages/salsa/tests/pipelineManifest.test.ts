/**
 * @file Contract tests for fetching CUBE-specific registered pipeline manifests.
 *
 * These tests verify piping identity, plugin metadata, defaults, and execution controls.
 *
 * @module
 */
const pipeline_resolve = jest.fn();
const client_get = jest.fn();
const pipeline_createWorkflow = jest.fn();
const cumin_pipelines_list = jest.fn();
const pipelineFile_getTextByPath = jest.fn();
const resources_getAll = jest.fn();
const resourceFields_get = jest.fn();

jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  pipeline_resolve: (...args: unknown[]): unknown => pipeline_resolve(...args),
  chrisConnection: { client_get: (...args: unknown[]): unknown => client_get(...args) },
  pipeline_createWorkflow: (...args: unknown[]): unknown => pipeline_createWorkflow(...args),
  pipelines_list: (...args: unknown[]): unknown => cumin_pipelines_list(...args),
  pipelineFile_getTextByPath: (...args: unknown[]): unknown => pipelineFile_getTextByPath(...args),
  ChRISPipelineGroup: class {
    asset = { resources_getAll, resourceFields_get };
  },
}));

import {
  pipelineManifest_get,
  pipelineManifestForPipeline_get,
} from '../src/pipelines/manifest';
import {
  pipeline_run,
  pipelines_list,
  pipelines_listAll,
  pipelineFields_get,
  pipelines_getAll,
  pipelineManifestBySlug_get,
  pipeline_sourceGet,
} from '../src/pipelines';
import { pipelineDiagram_get } from '../src/pipelines/diagram';

type ManifestResult = Awaited<ReturnType<typeof pipelineManifest_get>>;

beforeEach(() => jest.clearAllMocks());

describe('pipelineManifest_get', () => {
  it('fails cleanly when no authenticated CUBE client is available', async () => {
    pipeline_resolve.mockResolvedValue({ ok: true, value: { id: 27, name: 'brain' } });
    client_get.mockResolvedValue(null);
    expect((await pipelineManifest_get('brain')).ok).toBe(false);
  });

  it('fails cleanly when the resolved pipeline disappears', async () => {
    pipeline_resolve.mockResolvedValue({ ok: true, value: { id: 27, name: 'brain' } });
    client_get.mockResolvedValue({ getPipeline: async () => null });
    expect((await pipelineManifest_get('brain')).ok).toBe(false);
  });

  it('turns CUBE projection errors into a failed manifest result', async () => {
    pipeline_resolve.mockResolvedValue({ ok: true, value: { id: 27, name: 'brain' } });
    client_get.mockResolvedValue({ getPipeline: async () => { throw new Error('down'); } });
    expect((await pipelineManifest_get('brain')).ok).toBe(false);
  });

  it('projects the registered invocation without waiting for hosted plugin metadata', async () => {
    pipeline_resolve.mockResolvedValue({ ok: true, value: { id: 27, name: 'brain' } });
    client_get.mockResolvedValue({
      getPipeline: async () => ({
        getPluginPipings: async () => ({
          getItems: () => [{
            data: {
              id: 481,
              title: 'segmentation',
              plugin_name: 'pl-segmentation',
              plugin_version: '2.4.0',
              previous_id: null,
            },
            getPlugin: async () => { throw new Error('hosted metadata must not be fetched'); },
          }],
        }),
        getDefaultParameters: async () => ({
          data: [{ plugin_piping_id: 481, param_name: 'threshold', value: 0.4 }],
        }),
      }),
    });

    const result: ManifestResult = await pipelineManifest_get('brain', { detail: 'registered' });

    expect(result).toEqual({
      ok: true,
      value: {
        pipelineID: 27,
        name: 'brain',
        rootIDs: [481],
        nodes: [{
          pipingID: 481,
          title: 'segmentation',
          pluginName: 'pl-segmentation',
          pluginVersion: '2.4.0',
          parentID: null,
          computeResourceName: 'host',
          cpuLimit: undefined,
          memoryLimit: undefined,
          gpuLimit: undefined,
          numberOfWorkers: undefined,
          parameterDefaults: [{ name: 'threshold', value: 0.4 }],
          computeResources: undefined,
          parameterDefinitions: undefined,
        }],
      },
    });
  });

  it('serves a repeated registered manifest from the connection-scoped cache', async () => {
    pipeline_resolve
      .mockResolvedValueOnce({ ok: true, value: { id: 27, name: 'cached-brain' } })
      .mockRejectedValue(new Error('resolution must not repeat'));
    const getPipeline = jest.fn()
      .mockResolvedValueOnce({
        getPluginPipings: async () => ({
          getItems: () => [{
            data: {
              id: 481,
              title: 'segmentation',
              plugin_name: 'pl-segmentation',
              plugin_version: '2.4.0',
              previous_id: null,
            },
          }],
        }),
        getDefaultParameters: async () => ({ data: [] }),
      })
      .mockRejectedValue(new Error('Pipeline must not be fetched twice'));
    client_get.mockResolvedValue({ getPipeline });

    const first: ManifestResult = await pipelineManifest_get('cached-brain', { detail: 'registered' });
    const repeated: ManifestResult = await pipelineManifest_get('cached-brain', { detail: 'registered' });

    expect(first.ok).toBe(true);
    expect(repeated).toEqual(first);
  });

  it('projects an already resolved Pipeline without resolving it again', async () => {
    pipeline_resolve.mockRejectedValue(new Error('Pipeline is already resolved'));
    client_get.mockResolvedValue({
      getPipeline: async () => ({
        getPluginPipings: async () => ({ getItems: () => [] }),
        getDefaultParameters: async () => ({ data: [] }),
      }),
    });

    expect(await pipelineManifestForPipeline_get(
      { id: 42, name: 'Example Pipeline' },
      {
        getPluginPipings: async () => ({ getItems: () => [] }),
        getDefaultParameters: async () => ({ data: [] }),
      },
      { detail: 'registered' },
    )).toEqual({
      ok: true,
      value: {
        pipelineID: 42,
        name: 'Example Pipeline',
        rootIDs: [],
        nodes: [],
      },
    });
  });

  it('fails an already-resolved projection while disconnected', async () => {
    client_get.mockResolvedValue(null);

    expect((await pipelineManifestForPipeline_get(
      { id: 42, name: 'Example Pipeline' },
      {
        getPluginPipings: async () => ({ getItems: () => [] }),
        getDefaultParameters: async () => ({ data: [] }),
      },
      { detail: 'registered' },
    )).ok).toBe(false);
  });

  it('projects CUBE pipeline and piping identities with stored invocation defaults', async () => {
    pipeline_resolve.mockResolvedValue({
      ok: true,
      value: { id: 27, name: 'brain-preprocessing' },
    });
    client_get.mockResolvedValue({
      getPipeline: async () => ({
        getPluginPipings: async () => ({
          getItems: () => [{
            data: {
              id: 481,
              title: 'segmentation',
              plugin_name: 'pl-segmentation',
              plugin_version: '2.4.0',
              previous_id: null,
            },
            getPlugin: async () => ({
              getPluginParameters: async () => ({
                getItems: () => [{
                  data: {
                    name: 'threshold',
                    type: 'float',
                    optional: true,
                    default: 0.25,
                    help: 'Segmentation threshold',
                  },
                }],
              }),
              getPluginComputeResources: async () => ({
                getItems: () => [{ data: { name: 'host' } }, { data: { name: 'gpu' } }],
              }),
            }),
          }],
        }),
        getDefaultParameters: async () => ({
          data: [{
            plugin_piping_id: 481,
            param_name: 'threshold',
            value: 0.4,
            plugin_piping_cpu_limit: 2,
            plugin_piping_memory_limit: '8Gi',
            plugin_piping_gpu_limit: 1,
            plugin_piping_number_of_workers: 3,
          }],
        }),
      }),
    });

    const result = await pipelineManifest_get('brain-preprocessing');

    expect(result).toEqual({
      ok: true,
      value: {
        pipelineID: 27,
        name: 'brain-preprocessing',
        rootIDs: [481],
        nodes: [{
          pipingID: 481,
          title: 'segmentation',
          pluginName: 'pl-segmentation',
          pluginVersion: '2.4.0',
          parentID: null,
          computeResourceName: 'host',
          cpuLimit: 2,
          memoryLimit: '8Gi',
          gpuLimit: 1,
          numberOfWorkers: 3,
          parameterDefaults: [{ name: 'threshold', value: 0.4 }],
          computeResources: ['host', 'gpu'],
          parameterDefinitions: [{
            name: 'threshold',
            type: 'float',
            optional: true,
            default: 0.25,
            help: 'Segmentation threshold',
          }],
        }],
      },
    });
  });

  it('reuses hosted metadata when one versioned Plugin appears in multiple nodes', async () => {
    pipeline_resolve.mockResolvedValue({
      ok: true,
      value: { id: 31, name: 'repeated-plugin' },
    });
    const hostedPlugin = {
      getPluginParameters: async () => ({
        getItems: () => [{ data: { name: 'label', type: 'str', optional: true } }],
      }),
      getPluginComputeResources: async () => ({
        getItems: () => [{ data: { name: 'host' } }],
      }),
    };
    client_get.mockResolvedValue({
      getPipeline: async () => ({
        getPluginPipings: async () => ({
          getItems: () => [{
            data: {
              id: 1, title: 'first', plugin_name: 'pl-repeat',
              plugin_version: '1.0.0', previous_id: null,
            },
            getPlugin: async () => hostedPlugin,
          }, {
            data: {
              id: 2, title: 'second', plugin_name: 'pl-repeat',
              plugin_version: '1.0.0', previous_id: 1,
            },
            getPlugin: async () => { throw new Error('metadata must be shared'); },
          }],
        }),
        getDefaultParameters: async () => ({ data: [] }),
      }),
    });

    const result: ManifestResult = await pipelineManifest_get('repeated-plugin');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nodes.map((node) => node.parameterDefinitions)).toEqual([
        [{ name: 'label', type: 'str', optional: true, default: undefined, help: undefined }],
        [{ name: 'label', type: 'str', optional: true, default: undefined, help: undefined }],
      ]);
    }
  });

  it('evicts failed hosted metadata so a later projection can retry', async () => {
    pipeline_resolve.mockResolvedValue({
      ok: true,
      value: { id: 31, name: 'retry-metadata' },
    });
    const getPlugin = jest.fn()
      .mockRejectedValueOnce(new Error('temporary metadata failure'))
      .mockResolvedValue({
        getPluginParameters: async () => ({ getItems: () => [] }),
        getPluginComputeResources: async () => ({ getItems: () => [] }),
      });
    client_get.mockResolvedValue({
      getPipeline: async () => ({
        getPluginPipings: async () => ({
          getItems: () => [{
            data: {
              id: 1, title: 'retry', plugin_name: 'pl-retry',
              plugin_version: '1.0.0', previous_id: null,
            },
            getPlugin,
          }],
        }),
        getDefaultParameters: async () => ({ data: [] }),
      }),
    });

    expect((await pipelineManifest_get('retry-metadata')).ok).toBe(false);
    expect((await pipelineManifest_get('retry-metadata')).ok).toBe(true);
    expect(getPlugin).toHaveBeenCalledTimes(2);
  });

  it('runs one prepared overlay as the complete Workflow node override set', async () => {
    pipeline_resolve.mockResolvedValue({ ok: true, value: { id: 27, name: 'brain-preprocessing' } });
    client_get.mockResolvedValue({
      getPipeline: async () => ({
        getPluginPipings: async () => ({
          getItems: () => [{
            data: {
              id: 481, title: 'segmentation', plugin_name: 'pl-segmentation',
              plugin_version: '2.4.0', previous_id: null,
            },
            getPlugin: async () => ({
              getPluginParameters: async () => ({
                getItems: () => [{ data: { name: 'threshold', type: 'float', optional: true } }],
              }),
              getPluginComputeResources: async () => ({
                getItems: () => [{ data: { name: 'host' } }, { data: { name: 'gpu' } }],
              }),
            }),
          }],
        }),
        getDefaultParameters: async () => ({
          data: [{ plugin_piping_id: 481, param_name: 'threshold', value: 0.4 }],
        }),
      }),
    });
    pipeline_createWorkflow.mockResolvedValue({
      ok: true, value: { workflowId: 90, pluginInstanceIds: [901] },
    });

    const result = await pipeline_run('brain-preprocessing', 99, {
      parameterFile: {
        plugin_tree: { tree: [{ title: 'segmentation', compute_resource_name: 'gpu' }] },
      },
      cliBindings: [{ node: 'segmentation', field: 'threshold', value: 0.6 }],
    });

    expect(result).toEqual({ ok: true, value: { workflowId: 90, pluginInstanceIds: [901] } });
    expect(pipeline_createWorkflow).toHaveBeenCalledWith(27, {
      previousPluginInstId: 99,
      nodeOverrides: [{
        piping_id: 481,
        title: 'segmentation',
        compute_resource_name: 'gpu',
        cpu_limit: undefined,
        memory_limit: undefined,
        gpu_limit: undefined,
        number_of_workers: undefined,
        plugin_parameter_defaults: [{ name: 'threshold', default: 0.6 }],
      }],
    });
  });

  it('projects the same registered CUBE data as a diagram DAG', async () => {
    pipeline_resolve.mockResolvedValue({ ok: true, value: { id: 27, name: 'brain-preprocessing' } });
    client_get.mockResolvedValue({
      getPipeline: async () => ({
        getPluginPipings: async () => ({
          getItems: () => [
            { data: { id: 10, title: 'root', plugin_name: 'pl-root', previous_id: null } },
            { data: { id: 11, title: 'join', plugin_name: 'pl-topologicalcopy', previous_id: 10 } },
          ],
        }),
        getDefaultParameters: async () => ({
          data: [
            { plugin_piping_id: 10, param_name: 'label', value: 'input' },
            { plugin_piping_id: 11, param_name: 'plugininstances', value: '10,12' },
          ],
        }),
      }),
    });

    const result = await pipelineDiagram_get('brain-preprocessing');

    expect(result).toEqual({
      ok: true,
      value: {
        pipelineID: 27,
        name: 'brain-preprocessing',
        rootIDs: [10],
        nodes: [
          {
            id: 10, title: 'root', pluginName: 'pl-root', parentID: null,
            joinParentIDs: [], arguments: [{ name: 'label', value: 'input' }],
          },
          {
            id: 11, title: 'join', pluginName: 'pl-topologicalcopy', parentID: 10,
            joinParentIDs: [12], arguments: [{ name: 'plugininstances', value: '10,12' }],
          },
        ],
      },
    });
  });

  it('lists registered pipelines through the public Salsa projection', async () => {
    cumin_pipelines_list.mockResolvedValue({
      ok: true,
      value: [{ id: 27, name: 'brain', category: 'analysis' }],
    });

    expect(await pipelines_list('brain')).toEqual({
      tableData: [{ id: 27, name: 'brain', category: 'analysis' }],
      selectedFields: ['id', 'name', 'authors', 'category', 'description'],
    });
  });

  it('returns no listing when CUBE has no registered pipelines', async () => {
    cumin_pipelines_list.mockResolvedValue({ ok: true, value: [] });
    expect(await pipelines_list()).toBeNull();
  });

  it('exposes paged pipeline lists and field names through the resource group', async () => {
    resources_getAll.mockResolvedValue({ tableData: [{ id: 27 }] });
    resourceFields_get.mockResolvedValue({ fields: ['id', 'name'] });

    expect(await pipelines_listAll({ limit: 2 })).toEqual({ tableData: [{ id: 27 }] });
    expect(await pipelineFields_get()).toEqual(['id', 'name']);
  });

  it('returns no field list when pipeline metadata is unavailable', async () => {
    resourceFields_get.mockResolvedValue(null);
    expect(await pipelineFields_get()).toBeNull();
  });

  it('adds stable /bin slugs to all registered pipelines', async () => {
    cumin_pipelines_list.mockResolvedValue({
      ok: true,
      value: [{ id: 27, name: 'Brain Pipeline' }],
    });
    client_get.mockResolvedValue({
      getPipelineSourceFiles: async () => ({
        getItems: () => [{ data: { fname: '/PIPELINES/brain.yaml', pipeline_id: 27 } }],
      }),
    });

    const result = await pipelines_getAll();

    expect(result).toEqual({
      ok: true,
      value: [{ id: 27, name: 'Brain Pipeline', slug: 'brain_id27' }],
    });
  });

  it('projects one exact /bin slug without enumerating or fetching the Pipeline twice', async () => {
    cumin_pipelines_list.mockRejectedValue(new Error('global enumeration must not run'));
    const getPipelineSourceFiles = jest.fn().mockResolvedValue({
      getItems: () => [{
        data: {
          fname: '/PIPELINES/example_pipeline.yaml',
        },
      }],
    });
    const getPipeline = jest.fn().mockImplementation(async (id: number) => ({
        data: { id, name: 'Example Pipeline' },
        getPluginPipings: async () => ({ getItems: () => [] }),
        getDefaultParameters: async () => ({ data: [] }),
      }));
    client_get.mockResolvedValue({
      getPipeline,
      getPipelineSourceFiles,
    });

    expect(await pipelineManifestBySlug_get('example_pipeline_id42')).toEqual({
      ok: true,
      value: {
        pipelineID: 42,
        name: 'Example Pipeline',
        rootIDs: [],
        nodes: [],
      },
    });
    expect(getPipeline).toHaveBeenCalledTimes(1);
    expect(getPipelineSourceFiles).toHaveBeenCalledWith({ pipeline_id: 42, limit: 1000 });
  });

  it('serves repeated exact slug resolution from the connection-scoped cache', async () => {
    const getPipeline = jest.fn()
      .mockResolvedValueOnce({
        data: { id: 128, name: 'Cached Pipeline' },
        getPluginPipings: async () => ({ getItems: () => [] }),
        getDefaultParameters: async () => ({ data: [] }),
      })
      .mockRejectedValue(new Error('Pipeline must not be resolved twice'));
    const getPipelineSourceFiles = jest.fn()
      .mockResolvedValueOnce({ getItems: () => [] })
      .mockRejectedValue(new Error('Source files must not be resolved twice'));
    client_get.mockResolvedValue({ getPipeline, getPipelineSourceFiles });

    const first: ManifestResult = await pipelineManifestBySlug_get('Cached_Pipeline_id128');
    const repeated: ManifestResult = await pipelineManifestBySlug_get('Cached_Pipeline_id128');

    expect(first.ok).toBe(true);
    expect(repeated).toEqual(first);
    expect(getPipeline).toHaveBeenCalledTimes(1);
    expect(getPipelineSourceFiles).toHaveBeenCalledTimes(1);
  });

  it('does not let an exact slug cache bypass later name ambiguity checks', async () => {
    pipeline_resolve.mockResolvedValue({ ok: false });
    client_get.mockResolvedValue({
      getPipeline: async (id: number) => ({
        data: { id, name: 'Shared Name' },
        getPluginPipings: async () => ({ getItems: () => [] }),
        getDefaultParameters: async () => ({ data: [] }),
      }),
      getPipelineSourceFiles: async () => ({ getItems: () => [] }),
    });

    expect((await pipelineManifestBySlug_get('Shared_Name_id42')).ok).toBe(true);
    expect((await pipelineManifest_get('Shared Name', { detail: 'registered' })).ok).toBe(false);
    expect(pipeline_resolve).toHaveBeenCalledWith('Shared Name');
  });

  it('fails exact slug resolution while disconnected', async () => {
    client_get.mockResolvedValue(null);
    expect((await pipelineManifestBySlug_get('example_pipeline_id42')).ok).toBe(false);
  });

  it('turns targeted slug lookup errors into a failed result', async () => {
    client_get.mockResolvedValue({
      getPipeline: async () => { throw new Error('temporary lookup failure'); },
      getPipelineSourceFiles: async () => ({ getItems: () => [] }),
    });

    expect((await pipelineManifestBySlug_get('example_pipeline_id42')).ok).toBe(false);
  });

  it('cannot build /bin pipeline entries while disconnected', async () => {
    client_get.mockResolvedValue(null);
    expect((await pipelines_getAll()).ok).toBe(false);
  });

  it('returns the exact registered authoring source separately from the manifest', async () => {
    pipeline_resolve.mockResolvedValue({ ok: true, value: { id: 27, name: 'brain' } });
    client_get.mockResolvedValue({
      getPipelineSourceFiles: async () => ({
        getItems: () => [{ data: { fname: '/PIPELINES/brain.yaml' } }],
      }),
    });
    pipelineFile_getTextByPath.mockResolvedValue({ ok: true, value: 'name: brain\n' });

    expect(await pipeline_sourceGet('brain')).toEqual({ ok: true, value: 'name: brain\n' });
  });

  it('cannot read authoring source while disconnected', async () => {
    pipeline_resolve.mockResolvedValue({ ok: true, value: { id: 27, name: 'brain' } });
    client_get.mockResolvedValue(null);
    expect((await pipeline_sourceGet('brain')).ok).toBe(false);
  });

  it('reports a registered pipeline with no source file', async () => {
    pipeline_resolve.mockResolvedValue({ ok: true, value: { id: 27, name: 'brain' } });
    client_get.mockResolvedValue({
      getPipelineSourceFiles: async () => ({ getItems: () => [] }),
    });
    expect((await pipeline_sourceGet('brain')).ok).toBe(false);
  });

});
