/**
 * @file Builtin pipeline command.
 *
 * Manages registered ChRIS pipelines. Subcommands:
 * - `list`   — list all registered pipelines
 * - `info`   — show a pipeline's nodes and default parameters
 * - `run`    — instantiate a pipeline as a workflow on the current context node
 * - `source` — display the pipeline's YAML source file
 * - `diagram` — render the registered pipeline as a shallow tree or SignalFlow YAML
 *
 * Pipelines also appear as executables in `/bin` (colored distinctly from plugins)
 * and can be invoked directly by name. `cat /bin/<name>` returns its registered manifest.
 *
 * @module
 */

import chalk from 'chalk';
import {
  chrisContext,
  errorStack,
  pipeline_resolve,
  procCache_get,
  type CommandEnvelope,
  type PipelineRecord,
  type Result,
  type StackMessage,
  envelope_ok,
  envelope_error,
} from '@fnndsc/cumin';
import {
  pipelines_list,
  pipeline_run,
  pipeline_sourceGet,
  pipelineManifest_get,
  fileContent_get,
  type PipelineManifest,
  type PipelineRunOptions,
  type WorkflowResult,
  procCache_refresh,
} from '@fnndsc/salsa';
import { load as yamlLoad } from 'js-yaml';
import { pipelineFields_fetch } from '@fnndsc/chili/commands/pipeline/fields.js';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { args_checkHasHelpFlag, help_render } from '../help.js';
import { sink_get, sink_dataLine, sink_errLine } from '../../core/sink.js';
import { pipelineRunArgs_parse, type PipelineRunOverrides } from './pipeline.args.js';
import { pipelineDiagram_handle, type PipelineDiagramMode } from './pipeline.diagram.js';
import { pipelineParameters_render } from './pipeline.manifest.js';
import { path_resolve } from '../utils.js';

/**
 * Handles `pipeline list [search]`.
 *
 * @param args - Command arguments.
 */
async function pipelineList_handle(args: string[]): Promise<void> {
  const search: string | undefined = args[1];
  const data = await pipelines_list(search);
  if (!data || data.tableData.length === 0) {
    sink_dataLine(chalk.yellow('No pipelines registered.'));
    return;
  }
  sink_dataLine('');
  sink_dataLine(
    `  ${chalk.bold('ID'.padEnd(6))}${chalk.bold('Name'.padEnd(40))}${chalk.bold('Category'.padEnd(16))}${chalk.bold('Authors')}`
  );
  sink_dataLine(`  ${chalk.gray('─'.repeat(80))}`);
  for (const row of data.tableData) {
    const id: string = String(row.id ?? '').padEnd(6);
    const name: string = String(row.name ?? '').padEnd(40);
    const cat: string = String(row.category ?? '').padEnd(16);
    const authors: string = String(row.authors ?? '');
    sink_dataLine(`  ${chalk.cyan(id)}${chalk.magenta(name)}${chalk.gray(cat)}${chalk.gray(authors)}`);
  }
  sink_dataLine('');
}

/**
 * Handles `pipeline info <name|id>`.
 *
 * @param args - Command arguments.
 * @returns Command envelope whose status matches resolution and manifest fetching.
 */
async function pipelineInfo_handle(args: string[]): Promise<CommandEnvelope> {
  const nameOrId: string | undefined = args[1];
  if (!nameOrId) {
    sink_errLine(chalk.red('Usage: pipeline info <name|id>'));
    process.exitCode = 1;
    return envelope_error('');
  }
  const result: Result<PipelineRecord> = await pipeline_resolve(nameOrId);
  if (!result.ok) {
    const err: StackMessage | undefined = errorStack.stack_pop();
    sink_errLine(chalk.red(`pipeline info: ${err?.message ?? 'not found'}`));
    process.exitCode = 1;
    return envelope_error('');
  }
  const p: PipelineRecord = result.value;
  sink_dataLine('');
  sink_dataLine(`${chalk.bold.magenta(p.name)}  ${chalk.gray(`[id: ${p.id}]`)}`);
  if (p.description) sink_dataLine(chalk.white(`  ${p.description}`));
  if (p.authors)     sink_dataLine(chalk.gray(`  Authors: ${p.authors}`));
  if (p.category)    sink_dataLine(chalk.gray(`  Category: ${p.category}`));
  sink_dataLine(chalk.gray(`  Locked: ${p.locked ? 'yes' : 'no'}`));
  const manifestResult: Result<PipelineManifest> = await pipelineManifest_get(nameOrId);
  if (!manifestResult.ok) {
    const err: StackMessage | undefined = errorStack.stack_pop();
    sink_errLine(chalk.red(`pipeline info: ${err?.message ?? 'manifest unavailable'}`));
    process.exitCode = 1;
    return envelope_error('');
  }
  sink_dataLine(pipelineParameters_render(manifestResult.value as PipelineManifest));
  return envelope_ok('');
}

/**
 * Resolves the "previous" plugin-instance id for `pipeline run`, from the
 * explicit override or the current plugin context.
 *
 * @param previousOverride - Explicit `--previous` value, if any.
 * @returns The instance id, or null if it could not be resolved (error printed).
 */
async function pipelineRun_previousInstId(previousOverride: number | undefined): Promise<number | null> {
  if (previousOverride !== undefined) return previousOverride;

  const contextStr: string | null = await chrisContext.ChRISplugin_get();
  if (!contextStr) {
    sink_errLine(chalk.red('pipeline run: no plugin instance in context.'));
    sink_errLine(chalk.gray('  Navigate to a feed node first, or use --previous <id>'));
    process.exitCode = 1;
    return null;
  }
  const previousInstId: number = parseInt(contextStr, 10);
  if (isNaN(previousInstId)) {
    sink_errLine(chalk.red(`pipeline run: invalid context instance '${contextStr}'`));
    process.exitCode = 1;
    return null;
  }
  return previousInstId;
}

/**
 * Handles `pipeline run <name|id> [--compute <r>] [--previous <id>]`.
 *
 * @param args - Command arguments.
 * @returns Command envelope whose status matches Workflow creation.
 */
async function pipelineRun_handle(args: string[]): Promise<CommandEnvelope> {
  const nameOrId: string | undefined = args[1];
  if (!nameOrId) {
    sink_errLine(chalk.red('Usage: pipeline run <name|id> [--compute <resource>] [--previous <inst_id>]'));
    process.exitCode = 1;
    return envelope_error('');
  }

  const parsed: PipelineRunOverrides = pipelineRunArgs_parse(args);
  const { computeOverride, previousOverride } = parsed;
  if (parsed.parseError !== null) {
    sink_errLine(chalk.red(`pipeline run: ${parsed.parseError}`));
    process.exitCode = 1;
    return envelope_error('');
  }

  const previousInstId: number | null = await pipelineRun_previousInstId(previousOverride);
  if (previousInstId === null) return envelope_error('');

  const pipelineResult: Result<PipelineRecord> = await pipeline_resolve(nameOrId);
  if (!pipelineResult.ok) {
    const err: StackMessage | undefined = errorStack.stack_pop();
    sink_errLine(chalk.red(`pipeline run: ${err?.message ?? 'pipeline not found'}`));
    process.exitCode = 1;
    return envelope_error('');
  }

  sink_dataLine(chalk.gray(`Running pipeline '${pipelineResult.value.name}' on instance ${previousInstId}...`));

  let parameterFile: unknown;
  if (parsed.paramFile !== undefined) {
    const resolvedPath: string = await path_resolve(parsed.paramFile);
    const virtualPrefix: string | undefined = ['/bin', '/usr', '/etc', '/proc', '/net']
      .find((prefix: string): boolean => resolvedPath === prefix || resolvedPath.startsWith(`${prefix}/`));
    if (virtualPrefix !== undefined) {
      sink_errLine(chalk.red(`pipeline run: --paramFile must name a readable CFS file, not '${resolvedPath}'`));
      process.exitCode = 1;
      return envelope_error('');
    }
    const contentResult: Result<string> = await fileContent_get(resolvedPath);
    if (!contentResult.ok) {
      const err: StackMessage | undefined = errorStack.stack_pop();
      sink_errLine(chalk.red(`pipeline run: ${err?.message ?? `cannot read ${resolvedPath}`}`));
      process.exitCode = 1;
      return envelope_error('');
    }
    try {
      parameterFile = yamlLoad(contentResult.value);
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      sink_errLine(chalk.red(`pipeline run: invalid parameter YAML: ${message}`));
      process.exitCode = 1;
      return envelope_error('');
    }
  }
  const hasInvocationOptions: boolean = computeOverride !== undefined || parameterFile !== undefined || parsed.bindings.length > 0;
  const invocationOptions: PipelineRunOptions | undefined = hasInvocationOptions ? {
    globalCompute: computeOverride,
    parameterFile,
    cliBindings: parsed.bindings,
  } : undefined;
  const runResult: Result<WorkflowResult> = await pipeline_run(nameOrId, previousInstId, invocationOptions);
  if (!runResult.ok) {
    const err: StackMessage | undefined = errorStack.stack_pop();
    sink_errLine(chalk.red(`pipeline run: ${err?.message ?? 'workflow creation failed'}`));
    process.exitCode = 1;
    return envelope_error('');
  }

  const { workflowId, pluginInstanceIds } = runResult.value;
  const feedID: number | undefined = procCache_get().instance_get(previousInstId)?.feedID;
  if (feedID !== undefined) {
    try {
      await procCache_refresh(feedID);
    } catch {
      // Workflow creation succeeded; the background/full reconciliation remains authoritative.
    }
  }
  sink_dataLine(chalk.green(`✓ Workflow ${workflowId} created — ${pluginInstanceIds.length} node(s) queued`));
  sink_dataLine(chalk.gray(`  Instance IDs: ${pluginInstanceIds.join(', ')}`));
  return envelope_ok('');
}

/**
 * Handles `pipeline source <name|id>`.
 *
 * @param args - Command arguments.
 * @returns Command envelope whose status matches source retrieval.
 */
async function pipelineSource_handle(args: string[]): Promise<CommandEnvelope> {
  const nameOrId: string | undefined = args[1];
  if (!nameOrId) {
    sink_errLine(chalk.red('Usage: pipeline source <name|id>'));
    process.exitCode = 1;
    return envelope_error('');
  }
  const sourceResult: Result<string> = await pipeline_sourceGet(nameOrId);
  if (!sourceResult.ok) {
    const err: StackMessage | undefined = errorStack.stack_pop();
    sink_errLine(chalk.red(`pipeline source: ${err?.message ?? 'source not found'}`));
    process.exitCode = 1;
    return envelope_error('');
  }
  sink_dataLine(sourceResult.value);
  return envelope_ok('');
}

/**
 * Handles `pipeline inspect`: lists available pipeline fields.
 */
async function pipelineInspect_handle(): Promise<void> {
  const fields: string[] | null = await pipelineFields_fetch();
  if (fields && fields.length > 0) {
    sink_get().data_write(table_render(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Pipeline fields', justification: 'center' } }));
  } else {
    sink_dataLine(chalk.gray('No fields found.'));
  }
}

/** Parsed arguments for `pipeline diagram`. */
interface PipelineDiagramArgs {
  specifier: string;
  withArguments: boolean;
  signalflow: boolean;
}

/** Parses diagram flags while preserving every non-flag word as the search specifier. */
function pipelineDiagramArgs_parse(args: string[]): PipelineDiagramArgs {
  const words: string[] = [];
  let withArguments: boolean = false;
  let signalflow: boolean = false;
  for (const argument of args.slice(1)) {
    if (argument === '--withargs') withArguments = true;
    else if (argument === '--signalflow') signalflow = true;
    else words.push(argument);
  }
  return { specifier: words.join(' ').trim(), withArguments, signalflow };
}

/** Handles shallow and SignalFlow pipeline diagram output. */
async function pipelineDiagramCommand_handle(args: string[]): Promise<CommandEnvelope> {
  const parsed: PipelineDiagramArgs = pipelineDiagramArgs_parse(args);
  if (!parsed.specifier) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('Usage: pipeline diagram [--withargs | --signalflow] <name|id>')}\n`);
  }
  if (parsed.withArguments && parsed.signalflow) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('pipeline diagram: --withargs is only available for shallow rendering')}\n`);
  }
  const mode: PipelineDiagramMode = parsed.signalflow
    ? 'signalflow'
    : parsed.withArguments ? 'shallow-withargs' : 'shallow';
  return pipelineDiagram_handle(parsed.specifier, mode);
}

/**
 * Manages ChRIS pipeline registration, inspection, and execution.
 *
 * @param args - Command arguments.
 */
export async function builtin_pipeline(args: string[]): Promise<CommandEnvelope> {
  if (args_checkHasHelpFlag(args, 'pipeline')) {
    return envelope_ok(help_render('pipeline'));
  }

  const subcommand: string | undefined = args[0];

  if (!subcommand) {
    const current: string | null = await chrisContext.ChRISplugin_get();
    sink_dataLine(chalk.gray('Usage: pipeline <list|info|run|source|diagram> [args]'));
    if (current) {
      sink_dataLine(chalk.gray(`  Current context node: instance ${current}`));
    }
    return envelope_ok('');
  }

  switch (subcommand) {
    case 'list':
      await pipelineList_handle(args);
      return envelope_ok('');
    case 'info':
      return pipelineInfo_handle(args);
    case 'run':
      return pipelineRun_handle(args);
    case 'source':
      return pipelineSource_handle(args);
    case 'diagram':
      return pipelineDiagramCommand_handle(args);
    case 'inspect':
      await pipelineInspect_handle();
      return envelope_ok('');
    case 'search':
      return builtin_pipeline(['list', args[1] ?? '']);
    default:
      sink_errLine(chalk.red(`pipeline: unknown subcommand '${subcommand}'`));
      sink_dataLine(chalk.gray('  Subcommands: list, search, inspect, info, run, source, diagram'));
      process.exitCode = 1;
      return envelope_error('');
  }
}
