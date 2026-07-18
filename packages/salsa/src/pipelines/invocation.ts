/**
 * @file Pure preparation of one registered Pipeline Workflow invocation.
 *
 * This module validates sparse or complete YAML overlays, applies global/file/CLI
 * precedence, and produces the complete `nodes_info` payload CUBE expects. It
 * assumes the manifest has already been fetched from the authenticated CUBE.
 *
 * @module
 */
import { Err, Ok, Result, errorStack } from '@fnndsc/cumin';
import type {
  PipelineManifest,
  PipelineManifestNode,
  PipelineManifestParameterDefault,
} from './manifest.js';

/** Hosted plugin parameter schema used to validate one runtime binding. */
export interface PipelineParameterDefinition {
  /** Hosted parameter name. */
  name: string;
  /** CUBE parameter type. */
  type: string;
  /** Whether the hosted plugin permits omission. */
  optional: boolean;
  /** Plugin-declared default. */
  default?: unknown;
  /** Plugin-declared help text. */
  help?: string;
}

/** Surface-neutral binding of one value to one pipeline node field. */
export interface PipelineInvocationBinding {
  /** Unique node title or exact `@<piping-id>` selector. */
  node: string;
  /** Hosted parameter name or reserved execution-control name. */
  field: string;
  /** Typed runtime value. */
  value: unknown;
}

/** Complete CUBE `nodes_info` entry for one plugin piping. */
export interface PreparedWorkflowNode {
  /** CUBE plugin piping ID. */
  piping_id: number;
  /** Authored node title. */
  title: string;
  /** Effective compute placement. */
  compute_resource_name: string;
  /** Effective CPU limit. */
  cpu_limit?: unknown;
  /** Effective memory limit. */
  memory_limit?: unknown;
  /** Effective GPU limit. */
  gpu_limit?: unknown;
  /** Effective worker count. */
  number_of_workers?: unknown;
  /** Complete registered parameter values plus runtime overrides. */
  plugin_parameter_defaults: Array<{ name: string; default: unknown }>;
}

/** Fully resolved Pipeline Workflow creation input. */
export interface PreparedPipelineInvocation {
  /** Registered Pipeline ID. */
  pipelineID: number;
  /** Complete merged Workflow node override set. */
  nodeOverrides: PreparedWorkflowNode[];
}

/** Inputs accepted by pure pipeline invocation preparation. */
export interface PipelineInvocationPrepareOptions {
  /** Selected registered Pipeline manifest. */
  manifest: PipelineManifest;
  /** Baseline compute placement for every piping. */
  globalCompute?: string;
  /** Parsed CFS YAML overlay. */
  parameterFile?: unknown;
  /** Explicit node-qualified command or GUI bindings. */
  cliBindings?: PipelineInvocationBinding[];
}

interface InvocationNode extends PipelineManifestNode {
  computeResources?: string[];
  parameterDefinitions?: PipelineParameterDefinition[];
}

type UnknownRecord = Record<string, unknown>;

const EXECUTION_FIELDS: ReadonlySet<string> = new Set([
  'compute_resource_name',
  'cpu_limit',
  'memory_limit',
  'gpu_limit',
  'number_of_workers',
]);
const DOCUMENT_FIELDS: ReadonlySet<string> = new Set(['name', 'pipeline_id', 'plugin_tree']);
const PLUGIN_TREE_FIELDS: ReadonlySet<string> = new Set(['root_index', 'tree']);
const NODE_FIELDS: ReadonlySet<string> = new Set([
  'piping_id', 'title', 'plugin_name', 'plugin_version',
  'compute_resource_name', 'cpu_limit', 'memory_limit', 'gpu_limit', 'number_of_workers',
  'plugin_parameter_defaults', 'child_indices',
]);
const PARAMETER_FIELDS: ReadonlySet<string> = new Set(['name', 'default']);

function record_is(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fields_validate(record: UnknownRecord, allowed: ReadonlySet<string>, location: string): boolean {
  const unknown: string | undefined = Object.keys(record).find((field: string): boolean => !allowed.has(field));
  if (unknown === undefined) return true;
  errorStack.stack_push('error', `Unknown ${location} field '${unknown}'.`);
  return false;
}

function node_resolve(nodes: InvocationNode[], selector: string): InvocationNode | null {
  if (selector.startsWith('@') && /^@\d+$/.test(selector)) {
    const pipingID: number = Number(selector.slice(1));
    return nodes.find((node: InvocationNode): boolean => node.pipingID === pipingID) ?? null;
  }
  const matches: InvocationNode[] = nodes.filter((node: InvocationNode): boolean => node.title === selector);
  return matches.length === 1 ? matches[0] : null;
}

function executionField_set(node: PreparedWorkflowNode, field: string, value: unknown): void {
  if (field === 'compute_resource_name') node.compute_resource_name = String(value);
  else if (field === 'cpu_limit') node.cpu_limit = value;
  else if (field === 'memory_limit') node.memory_limit = value;
  else if (field === 'gpu_limit') node.gpu_limit = value;
  else if (field === 'number_of_workers') node.number_of_workers = value;
}

function executionValue_isValid(field: string, value: unknown): boolean {
  if (field === 'compute_resource_name') return typeof value === 'string' && value.trim().length > 0;
  if (field === 'gpu_limit' || field === 'number_of_workers') {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
  }
  return (typeof value === 'number' && Number.isFinite(value) && value >= 0) ||
    (typeof value === 'string' && value.trim().length > 0);
}

function parameter_set(node: PreparedWorkflowNode, name: string, value: unknown): void {
  const current: { name: string; default: unknown } | undefined = node.plugin_parameter_defaults
    .find((parameter: { name: string; default: unknown }): boolean => parameter.name === name);
  if (current) current.default = value;
  else node.plugin_parameter_defaults.push({ name, default: value });
}

function parameter_known(node: InvocationNode, name: string): boolean {
  if (node.parameterDefinitions !== undefined) {
    return node.parameterDefinitions.some((parameter: PipelineParameterDefinition): boolean => parameter.name === name);
  }
  return node.parameterDefaults.some((parameter): boolean => parameter.name === name);
}

function parameter_valueValid(node: InvocationNode, name: string, value: unknown): boolean {
  const definition: PipelineParameterDefinition | undefined = node.parameterDefinitions
    ?.find((parameter: PipelineParameterDefinition): boolean => parameter.name === name);
  if (!definition || value === null || value === undefined) return true;
  const type: string = definition.type.toLowerCase();
  if (type === 'integer' || type === 'int') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'float' || type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean' || type === 'bool') return typeof value === 'boolean';
  if (type === 'str' || type === 'string' || type === 'path' || type === 'unextpath') {
    return typeof value === 'string';
  }
  return false;
}

/**
 * Build the complete `nodes_info` override set for one Workflow invocation.
 *
 * @param options - Registered manifest and optional global, file, and CLI overlays.
 * @returns Prepared invocation, or an error after strict validation fails.
 */
export function pipelineInvocation_prepare(
  options: PipelineInvocationPrepareOptions,
): Result<PreparedPipelineInvocation> {
  const manifest: PipelineManifest = options.manifest;
  const nodes: InvocationNode[] = manifest.nodes as InvocationNode[];
  const preparedByID: Map<number, PreparedWorkflowNode> = new Map();

  for (const node of nodes) {
    preparedByID.set(node.pipingID, {
      piping_id: node.pipingID,
      title: node.title,
      compute_resource_name: options.globalCompute ?? node.computeResourceName,
      cpu_limit: node.cpuLimit,
      memory_limit: node.memoryLimit,
      gpu_limit: node.gpuLimit,
      number_of_workers: node.numberOfWorkers,
      plugin_parameter_defaults: node.parameterDefaults.map((parameter) => ({
        name: parameter.name,
        default: parameter.value,
      })),
    });
  }

  if (options.parameterFile !== undefined) {
    if (!record_is(options.parameterFile)) {
      errorStack.stack_push('error', 'Parameter file must contain a YAML mapping.');
      return Err();
    }
    const document: UnknownRecord = options.parameterFile;
    if (!fields_validate(document, DOCUMENT_FIELDS, 'parameter-file')) return Err();
    if (document.name !== undefined && document.name !== manifest.name) {
      errorStack.stack_push('error', `Parameter file names pipeline '${String(document.name)}', not '${manifest.name}'.`);
      return Err();
    }
    if (document.pipeline_id !== undefined && document.pipeline_id !== manifest.pipelineID) {
      errorStack.stack_push('error', `Parameter file pipeline_id ${String(document.pipeline_id)} does not match ${manifest.pipelineID}.`);
      return Err();
    }
    const pluginTree: unknown = document.plugin_tree;
    if (record_is(pluginTree) && !fields_validate(pluginTree, PLUGIN_TREE_FIELDS, 'plugin_tree')) return Err();
    if (record_is(pluginTree) && pluginTree.root_index !== undefined) {
      const expectedRootIndex: number = manifest.nodes.findIndex(
        (node: PipelineManifestNode): boolean => node.pipingID === manifest.rootIDs[0],
      );
      if (pluginTree.root_index !== expectedRootIndex) {
        errorStack.stack_push('error', 'Parameter-file root_index does not match the registered pipeline.');
        return Err();
      }
    }
    const tree: unknown = record_is(pluginTree) ? pluginTree.tree : undefined;
    if (!Array.isArray(tree)) {
      errorStack.stack_push('error', 'Parameter file must contain plugin_tree.tree.');
      return Err();
    }
    const fileBindingsSeen: Set<string> = new Set();
    for (const rawNode of tree) {
      if (!record_is(rawNode)) {
        errorStack.stack_push('error', 'Each parameter-file node must be a mapping.');
        return Err();
      }
      if (!fields_validate(rawNode, NODE_FIELDS, 'pipeline node')) return Err();
      const selector: string = rawNode.piping_id !== undefined
        ? `@${String(rawNode.piping_id)}`
        : String(rawNode.title ?? '');
      const source: InvocationNode | null = node_resolve(nodes, selector);
      if (!source) {
        errorStack.stack_push('error', `Unknown or ambiguous pipeline node '${selector}'.`);
        return Err();
      }
      if (rawNode.title !== undefined && rawNode.title !== source.title) {
        errorStack.stack_push('error', `Node title assertion does not match piping ${source.pipingID}.`);
        return Err();
      }
      if (rawNode.plugin_name !== undefined && rawNode.plugin_name !== source.pluginName) {
        errorStack.stack_push('error', `Plugin assertion does not match node '${source.title}'.`);
        return Err();
      }
      if (rawNode.plugin_version !== undefined && rawNode.plugin_version !== source.pluginVersion) {
        errorStack.stack_push('error', `Plugin version assertion does not match node '${source.title}'.`);
        return Err();
      }
      if (rawNode.child_indices !== undefined) {
        if (!Array.isArray(rawNode.child_indices)) return Err();
        const expectedChildren: number[] = manifest.nodes
          .map((candidate: PipelineManifestNode, index: number): [PipelineManifestNode, number] => [candidate, index])
          .filter(([candidate]: [PipelineManifestNode, number]): boolean => candidate.parentID === source.pipingID)
          .map(([, index]: [PipelineManifestNode, number]): number => index);
        const supplied: unknown[] = rawNode.child_indices;
        if (supplied.length !== expectedChildren.length || supplied.some(
          (value: unknown, index: number): boolean => value !== expectedChildren[index],
        )) {
          errorStack.stack_push('error', `child_indices assertion does not match node '${source.title}'.`);
          return Err();
        }
      }
      const prepared: PreparedWorkflowNode = preparedByID.get(source.pipingID) as PreparedWorkflowNode;
      for (const field of EXECUTION_FIELDS) {
        if (rawNode[field] !== undefined) {
          if (!executionValue_isValid(field, rawNode[field])) {
            errorStack.stack_push('error', `Invalid ${field} value on node '${source.title}'.`);
            return Err();
          }
          const bindingKey: string = `${source.pipingID}.${field}`;
          if (fileBindingsSeen.has(bindingKey)) {
            errorStack.stack_push('error', `Duplicate parameter-file binding '${source.title}.${field}'.`);
            return Err();
          }
          fileBindingsSeen.add(bindingKey);
          executionField_set(prepared, field, rawNode[field]);
        }
      }
      const defaults: unknown = rawNode.plugin_parameter_defaults;
      if (defaults !== undefined) {
        if (!Array.isArray(defaults)) return Err();
        for (const rawParameter of defaults) {
          if (!record_is(rawParameter) || typeof rawParameter.name !== 'string') return Err();
          if (!fields_validate(rawParameter, PARAMETER_FIELDS, 'parameter')) return Err();
          if (rawParameter.name === 'plugininstances') {
            const registered: PipelineManifestParameterDefault | undefined = source.parameterDefaults.find(
              (parameter: PipelineManifestParameterDefault): boolean => parameter.name === 'plugininstances',
            );
            if (!registered || rawParameter.default !== registered.value) {
              errorStack.stack_push('error', 'plugininstances encodes pipeline topology and cannot be overridden.');
              return Err();
            }
            continue;
          }
          if (!parameter_known(source, rawParameter.name)) {
            errorStack.stack_push('error', `Unknown parameter '${rawParameter.name}' on node '${source.title}'.`);
            return Err();
          }
          if (!parameter_valueValid(source, rawParameter.name, rawParameter.default)) {
            errorStack.stack_push('error', `Invalid ${rawParameter.name} value on node '${source.title}'.`);
            return Err();
          }
          const bindingKey: string = `${source.pipingID}.${rawParameter.name}`;
          if (fileBindingsSeen.has(bindingKey)) {
            errorStack.stack_push('error', `Duplicate parameter-file binding '${source.title}.${rawParameter.name}'.`);
            return Err();
          }
          fileBindingsSeen.add(bindingKey);
          parameter_set(prepared, rawParameter.name, rawParameter.default);
        }
      }
    }
  }

  for (const binding of options.cliBindings ?? []) {
    const source: InvocationNode | null = node_resolve(nodes, binding.node);
    if (!source) {
      errorStack.stack_push('error', `Unknown or ambiguous pipeline node '${binding.node}'.`);
      return Err();
    }
    const prepared: PreparedWorkflowNode = preparedByID.get(source.pipingID) as PreparedWorkflowNode;
    if (EXECUTION_FIELDS.has(binding.field)) {
      if (!executionValue_isValid(binding.field, binding.value)) {
        errorStack.stack_push('error', `Invalid ${binding.field} value on node '${source.title}'.`);
        return Err();
      }
      executionField_set(prepared, binding.field, binding.value);
    } else {
      if (binding.field === 'plugininstances') {
        errorStack.stack_push('error', 'plugininstances encodes pipeline topology and cannot be overridden.');
        return Err();
      }
      if (!parameter_known(source, binding.field)) {
        errorStack.stack_push('error', `Unknown parameter '${binding.field}' on node '${source.title}'.`);
        return Err();
      }
      if (!parameter_valueValid(source, binding.field, binding.value)) {
        errorStack.stack_push('error', `Invalid ${binding.field} value on node '${source.title}'.`);
        return Err();
      }
      parameter_set(prepared, binding.field, binding.value);
    }
  }

  let computeInvalid: boolean = false;
  for (const source of nodes) {
    const effective: string = (preparedByID.get(source.pipingID) as PreparedWorkflowNode).compute_resource_name;
    if (source.computeResources !== undefined && !source.computeResources.includes(effective)) {
      errorStack.stack_push(
        'error',
        `Node '${source.title}' (${source.pluginName} v${source.pluginVersion}) is not registered on compute '${effective}'.`,
      );
      computeInvalid = true;
    }
  }
  if (computeInvalid) return Err();

  return Ok({ pipelineID: manifest.pipelineID, nodeOverrides: [...preparedByID.values()] });
}
