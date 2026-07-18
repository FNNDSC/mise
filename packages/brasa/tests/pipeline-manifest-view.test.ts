/**
 * @file Contract tests for registered pipeline manifest and parameter rendering.
 *
 * These tests keep the machine-readable `/bin` projection and contextual help stable.
 *
 * @module
 */
import { describe, expect, it } from '@jest/globals';
import {
  pipelineManifest_render,
  pipelineParameters_render,
} from '../src/builtins/res/pipeline.manifest.js';

describe('pipelineManifest_render', () => {
  it('renders the registered invocation manifest as pipeline-shaped YAML', () => {
    const yaml = pipelineManifest_render({
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
      }],
    });

    expect(yaml).toBe(
      'name: brain-preprocessing\n' +
      'pipeline_id: 27\n' +
      'plugin_tree:\n' +
      '  root_index: 0\n' +
      '  tree:\n' +
      '    - piping_id: 481\n' +
      '      title: segmentation\n' +
      '      plugin_name: pl-segmentation\n' +
      '      plugin_version: 2.4.0\n' +
      '      compute_resource_name: host\n' +
      '      cpu_limit: 2\n' +
      '      memory_limit: 8Gi\n' +
      '      gpu_limit: 1\n' +
      '      number_of_workers: 3\n' +
      '      plugin_parameter_defaults:\n' +
      '        - name: threshold\n' +
      '          default: 0.4\n' +
      '      child_indices: []\n',
    );
  });

  it('renders complete hosted parameters and node execution controls', () => {
    const rendered = pipelineParameters_render({
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
        memoryLimit: '8Gi',
        parameterDefaults: [{ name: 'threshold', value: 0.4 }],
        parameterDefinitions: [{
          name: 'threshold', type: 'float', optional: true, default: 0.25,
        }],
      }],
    });

    expect(rendered).toContain('segmentation [@481]');
    expect(rendered).toContain('--segmentation.compute_resource_name');
    expect(rendered).toContain('--segmentation.memory_limit');
    expect(rendered).toContain('--segmentation.threshold');
    expect(rendered).toContain('float');
    expect(rendered).toContain('0.4');
  });

  it('renders exact piping selectors when authored titles are not option-safe', () => {
    const rendered = pipelineParameters_render({
      pipelineID: 27,
      name: 'brain-preprocessing',
      rootIDs: [481],
      nodes: [{
        pipingID: 481,
        title: 'segmentation stage',
        pluginName: 'pl-segmentation',
        pluginVersion: '2.4.0',
        parentID: null,
        computeResourceName: 'host',
        parameterDefaults: [],
        parameterDefinitions: [{ name: 'threshold', type: 'float', optional: true }],
      }],
    });

    expect(rendered).toContain('--@481.threshold');
    expect(rendered).not.toContain('--segmentation stage.threshold');
  });
});
