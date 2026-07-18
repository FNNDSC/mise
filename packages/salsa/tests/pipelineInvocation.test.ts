/**
 * @file Contract tests for preparing registered pipeline runtime overlays.
 *
 * These tests verify strict validation, precedence, and complete Workflow node output.
 *
 * @module
 */
import { pipelineInvocation_prepare } from '../src/pipelines/invocation';

describe('pipelineInvocation_prepare', () => {
  it('requires a YAML mapping with a plugin tree', () => {
    const manifest = {
      pipelineID: 1,
      name: 'minimal',
      rootIDs: [10],
      nodes: [{
        pipingID: 10, title: 'root', pluginName: 'pl-root', pluginVersion: '1',
        parentID: null, computeResourceName: 'host', parameterDefaults: [],
      }],
    };
    expect(pipelineInvocation_prepare({ manifest, parameterFile: [] }).ok).toBe(false);
    expect(pipelineInvocation_prepare({ manifest, parameterFile: {} }).ok).toBe(false);
  });

  it('enforces optional pipeline identity assertions', () => {
    const manifest = {
      pipelineID: 1,
      name: 'minimal',
      rootIDs: [10],
      nodes: [{
        pipingID: 10, title: 'root', pluginName: 'pl-root', pluginVersion: '1',
        parentID: null, computeResourceName: 'host', parameterDefaults: [],
      }],
    };
    expect(pipelineInvocation_prepare({
      manifest,
      parameterFile: { name: 'other', plugin_tree: { tree: [] } },
    }).ok).toBe(false);
    expect(pipelineInvocation_prepare({
      manifest,
      parameterFile: { pipeline_id: 2, plugin_tree: { tree: [] } },
    }).ok).toBe(false);
  });

  it('merges registered values, compute baseline, parameter file, and CLI by specificity', () => {
    const manifest = {
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
        computeResources: ['host', 'gpu'],
        cpuLimit: 2,
        memoryLimit: '4Gi',
        gpuLimit: 0,
        numberOfWorkers: 1,
        parameterDefaults: [
          { name: 'threshold', value: 0.4 },
          { name: 'plugininstances', value: '481' },
        ],
        parameterDefinitions: [
          { name: 'threshold', type: 'float', optional: true, default: 0.25 },
          { name: 'plugininstances', type: 'string', optional: true, default: '' },
        ],
      }],
    };

    const result = pipelineInvocation_prepare({
      manifest,
      globalCompute: 'host',
      parameterFile: {
        name: 'brain-preprocessing',
        pipeline_id: 27,
        plugin_tree: {
          tree: [{
            title: 'segmentation',
            plugin_name: 'pl-segmentation',
            plugin_version: '2.4.0',
            compute_resource_name: 'gpu',
            memory_limit: '8Gi',
            plugin_parameter_defaults: [{ name: 'threshold', default: 0.5 }],
          }],
        },
      },
      cliBindings: [
        { node: 'segmentation', field: 'threshold', value: 0.6 },
        { node: '@481', field: 'memory_limit', value: '12Gi' },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        pipelineID: 27,
        nodeOverrides: [{
          piping_id: 481,
          title: 'segmentation',
          compute_resource_name: 'gpu',
          cpu_limit: 2,
          memory_limit: '12Gi',
          gpu_limit: 0,
          number_of_workers: 1,
          plugin_parameter_defaults: [
            { name: 'threshold', default: 0.6 },
            { name: 'plugininstances', default: '481' },
          ],
        }],
      },
    });
  });

  it('rejects structural plugininstances as a runtime binding', () => {
    const result = pipelineInvocation_prepare({
      manifest: {
        pipelineID: 27,
        name: 'fan-in',
        rootIDs: [481],
        nodes: [{
          pipingID: 481,
          title: 'join',
          pluginName: 'pl-topologicalcopy',
          pluginVersion: '1.0.0',
          parentID: null,
          computeResourceName: 'host',
          parameterDefaults: [{ name: 'plugininstances', value: '480,481' }],
        }],
      },
      cliBindings: [{ node: 'join', field: 'plugininstances', value: '999' }],
    });

    expect(result.ok).toBe(false);
  });

  it('accepts unchanged plugininstances from a complete registered manifest as an assertion', () => {
    const result = pipelineInvocation_prepare({
      manifest: {
        pipelineID: 27,
        name: 'fan-in',
        rootIDs: [481],
        nodes: [{
          pipingID: 481,
          title: 'join',
          pluginName: 'pl-topologicalcopy',
          pluginVersion: '1.0.0',
          parentID: null,
          computeResourceName: 'host',
          parameterDefaults: [{ name: 'plugininstances', value: '480,481' }],
        }],
      },
      parameterFile: {
        name: 'fan-in',
        pipeline_id: 27,
        plugin_tree: { tree: [{
          piping_id: 481,
          title: 'join',
          plugin_name: 'pl-topologicalcopy',
          plugin_version: '1.0.0',
          plugin_parameter_defaults: [{ name: 'plugininstances', default: '480,481' }],
          child_indices: [],
        }] },
      },
    });

    expect(result.ok).toBe(true);
  });

  it('rejects a parameter not declared by the hosted plugin', () => {
    const result = pipelineInvocation_prepare({
      manifest: {
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
          parameterDefaults: [{ name: 'threshold', value: 0.4 }],
          parameterDefinitions: [{ name: 'threshold', type: 'float', optional: true }],
        }],
      },
      cliBindings: [{ node: 'segmentation', field: 'threshodl', value: 0.5 }],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects unknown parameter-file fields instead of ignoring typos', () => {
    const result = pipelineInvocation_prepare({
      manifest: {
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
          parameterDefaults: [],
        }],
      },
      parameterFile: {
        plugin_tree: { tree: [{ title: 'segmentation', memory_limt: '8Gi' }] },
      },
    });

    expect(result.ok).toBe(false);
  });

  it('rejects a node compute not available to its hosted plugin', () => {
    const result = pipelineInvocation_prepare({
      manifest: {
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
          computeResources: ['host'],
          parameterDefaults: [],
        }],
      },
      cliBindings: [{ node: 'segmentation', field: 'compute_resource_name', value: 'gpu' }],
    });

    expect(result.ok).toBe(false);
  });
  it('rejects duplicate parameter bindings inside one parameter file', () => {
    const result = pipelineInvocation_prepare({
      manifest: {
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
          parameterDefaults: [{ name: 'threshold', value: 0.4 }],
        }],
      },
      parameterFile: {
        plugin_tree: { tree: [{
          title: 'segmentation',
          plugin_parameter_defaults: [
            { name: 'threshold', default: 0.5 },
            { name: 'threshold', default: 0.6 },
          ],
        }] },
      },
    });

    expect(result.ok).toBe(false);
  });
  it('treats topology from a full registered manifest as a strict assertion', () => {
    const result = pipelineInvocation_prepare({
      manifest: {
        pipelineID: 27,
        name: 'linear',
        rootIDs: [10],
        nodes: [
          {
            pipingID: 10, title: 'root', pluginName: 'pl-root', pluginVersion: '1',
            parentID: null, computeResourceName: 'host', parameterDefaults: [],
          },
          {
            pipingID: 11, title: 'child', pluginName: 'pl-child', pluginVersion: '1',
            parentID: 10, computeResourceName: 'host', parameterDefaults: [],
          },
        ],
      },
      parameterFile: {
        plugin_tree: {
          root_index: 0,
          tree: [
            { piping_id: 10, title: 'root', child_indices: [] },
            { piping_id: 11, title: 'child', child_indices: [] },
          ],
        },
      },
    });

    expect(result.ok).toBe(false);
  });
  it('rejects a value incompatible with the hosted parameter type', () => {
    const result = pipelineInvocation_prepare({
      manifest: {
        pipelineID: 27,
        name: 'typed',
        rootIDs: [10],
        nodes: [{
          pipingID: 10, title: 'root', pluginName: 'pl-root', pluginVersion: '1',
          parentID: null, computeResourceName: 'host', parameterDefaults: [],
          parameterDefinitions: [{ name: 'iterations', type: 'integer', optional: false }],
        }],
      },
      cliBindings: [{ node: 'root', field: 'iterations', value: 'many' }],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects malformed node execution-control values before Workflow creation', () => {
    const result = pipelineInvocation_prepare({
      manifest: {
        pipelineID: 27,
        name: 'typed',
        rootIDs: [10],
        nodes: [{
          pipingID: 10, title: 'root', pluginName: 'pl-root', pluginVersion: '1',
          parentID: null, computeResourceName: 'host', parameterDefaults: [],
        }],
      },
      cliBindings: [{ node: 'root', field: 'number_of_workers', value: 1.5 }],
    });

    expect(result.ok).toBe(false);
  });

  it('accepts the ChRIS str alias for hosted string parameters', () => {
    const result = pipelineInvocation_prepare({
      manifest: {
        pipelineID: 27,
        name: 'typed',
        rootIDs: [10],
        nodes: [{
          pipingID: 10, title: 'root', pluginName: 'pl-root', pluginVersion: '1',
          parentID: null, computeResourceName: 'host', parameterDefaults: [],
          parameterDefinitions: [{ name: 'outputdir', type: 'str', optional: true }],
        }],
      },
      cliBindings: [{ node: 'root', field: 'outputdir', value: 'NIfTI files' }],
    });

    expect(result.ok).toBe(true);
  });
});
