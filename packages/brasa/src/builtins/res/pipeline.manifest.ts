/**
 * @file ChELL views over the registered CUBE pipeline invocation manifest.
 *
 * This module renders the complete machine-readable `/bin` YAML projection and
 * contextual human parameter help. It depends only on Salsa's typed manifest;
 * fetching and invocation remain outside this presentation boundary.
 *
 * @module
 */
import { dump as yamlDump } from 'js-yaml';
import type {
  PipelineManifest,
  PipelineManifestNode,
  PipelineManifestParameterDefault,
} from '@fnndsc/salsa';

interface ManifestYamlNode {
  piping_id: number;
  title: string;
  plugin_name: string;
  plugin_version: string;
  compute_resource_name: string;
  cpu_limit?: unknown;
  memory_limit?: unknown;
  gpu_limit?: unknown;
  number_of_workers?: unknown;
  plugin_parameter_defaults?: Array<{ name: string; default: unknown }>;
  child_indices?: number[];
}

/**
 * Render the machine-readable registered executable exposed by `/bin`.
 *
 * @param manifest - Complete CUBE-specific registered Pipeline manifest.
 * @returns YAML that can be passed back unchanged as a parameter file.
 */
export function pipelineManifest_render(manifest: PipelineManifest): string {
  const indexByPiping: Map<number, number> = new Map(
    manifest.nodes.map((node: PipelineManifestNode, index: number): [number, number] => [node.pipingID, index]),
  );
  const tree: ManifestYamlNode[] = manifest.nodes.map((node: PipelineManifestNode): ManifestYamlNode => {
    const children: number[] = manifest.nodes
      .filter((candidate: PipelineManifestNode): boolean => candidate.parentID === node.pipingID)
      .map((candidate: PipelineManifestNode): number => indexByPiping.get(candidate.pipingID) as number);
    const yamlNode: ManifestYamlNode = {
      piping_id: node.pipingID,
      title: node.title,
      plugin_name: node.pluginName,
      plugin_version: node.pluginVersion,
      compute_resource_name: node.computeResourceName,
      cpu_limit: node.cpuLimit,
      memory_limit: node.memoryLimit,
      gpu_limit: node.gpuLimit,
      number_of_workers: node.numberOfWorkers,
    };
    if (node.parameterDefaults.length > 0) {
      yamlNode.plugin_parameter_defaults = node.parameterDefaults.map((parameter) => ({
        name: parameter.name,
        default: parameter.value,
      }));
    }
    yamlNode.child_indices = children;
    return yamlNode;
  });
  const rootIndex: number = indexByPiping.get(manifest.rootIDs[0]) ?? 0;
  return yamlDump({
    name: manifest.name,
    pipeline_id: manifest.pipelineID,
    plugin_tree: { root_index: rootIndex, tree },
  }, { lineWidth: -1, noRefs: true });
}

const EXECUTION_VALUES: ReadonlyArray<{
  field: string;
  value: (node: PipelineManifestNode) => unknown;
}> = [
  { field: 'compute_resource_name', value: (node) => node.computeResourceName },
  { field: 'cpu_limit', value: (node) => node.cpuLimit },
  { field: 'memory_limit', value: (node) => node.memoryLimit },
  { field: 'gpu_limit', value: (node) => node.gpuLimit },
  { field: 'number_of_workers', value: (node) => node.numberOfWorkers },
];

/**
 * Render contextual, human-readable compound options for one pipeline.
 *
 * @param manifest - Complete manifest including hosted parameter definitions.
 * @returns Human-readable node, execution-control, and parameter listing.
 */
export function pipelineParameters_render(manifest: PipelineManifest): string {
  const lines: string[] = [`${manifest.name} [pipeline ${manifest.pipelineID}]`, ''];
  for (const node of manifest.nodes) {
    const titleUsable: boolean = /^[A-Za-z0-9_-]+$/.test(node.title) &&
      manifest.nodes.filter((candidate: PipelineManifestNode): boolean => candidate.title === node.title).length === 1;
    const selector: string = titleUsable ? node.title : `@${node.pipingID}`;
    lines.push(`${node.title} [@${node.pipingID}]  ${node.pluginName} v${node.pluginVersion}`);
    lines.push('  Execution controls:');
    for (const execution of EXECUTION_VALUES) {
      const value: unknown = execution.value(node);
      lines.push(`    --${selector}.${execution.field}  ${value === undefined ? '(unset)' : String(value)}`);
    }
    lines.push('  Plugin parameters:');
    for (const parameter of node.parameterDefinitions ?? []) {
      const stored: PipelineManifestParameterDefault | undefined = node.parameterDefaults.find(
        (candidate: PipelineManifestParameterDefault): boolean => candidate.name === parameter.name,
      );
      const effective: unknown = stored?.value ?? parameter.default;
      const requirement: string = parameter.optional ? 'optional' : 'required';
      lines.push(
        `    --${selector}.${parameter.name}  ${parameter.type}  ${requirement}  ` +
        `${effective === undefined || effective === null ? '(unset)' : String(effective)}`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
