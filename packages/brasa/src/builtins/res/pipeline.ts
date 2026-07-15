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
 * and can be invoked directly by name. `cat /bin/<name>` returns the YAML source.
 *
 * @module
 */

import chalk from 'chalk';
import {
  chrisContext,
  errorStack,
  pipeline_resolve,
  type CommandEnvelope,
  envelope_ok,
  envelope_error,
} from '@fnndsc/cumin';
import {
  pipelines_list,
  pipeline_run,
  pipeline_sourceGet,
} from '@fnndsc/salsa';
import { pipelineFields_fetch } from '@fnndsc/chili/commands/pipeline/fields.js';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { args_checkHasHelpFlag, help_render } from '../help.js';
import { sink_get, sink_dataLine, sink_errLine } from '../../core/sink.js';
import { pipelineRunArgs_parse, type PipelineRunOverrides } from './pipeline.args.js';
import { pipelineDiagram_handle, type PipelineDiagramMode } from './pipeline.diagram.js';
import { session } from '../../session/index.js';

/**
 * Renders a pipeline's node structure by fetching its piping definitions.
 *
 * @param pipelineId - Numeric pipeline ID.
 */
async function pipelineNodes_print(pipelineId: number): Promise<void> {
  const client = await session.connection.client_get();
  if (!client) {
    sink_errLine(chalk.red('pipeline info: not connected to ChRIS'));
    return;
  }

  try {
    const pipelineObj = await (client as unknown as {
      getPipeline: (id: number) => Promise<{
        data: Record<string, unknown>;
        getPluginPipings: (opts: Record<string, unknown>) => Promise<{
          getItems: () => Array<{ data: Record<string, unknown> }>;
        }>;
      }>;
    }).getPipeline(pipelineId);

    if (!pipelineObj) {
      sink_errLine(chalk.red(`pipeline info: pipeline ${pipelineId} not found`));
      return;
    }

    const pipingsResponse = await pipelineObj.getPluginPipings({ limit: 1000 });
    const pipings = pipingsResponse.getItems();

    sink_dataLine(chalk.bold.blue('\nNodes:\n'));
    sink_dataLine(
      `  ${chalk.bold('ID'.padEnd(6))}${chalk.bold('Title'.padEnd(30))}${chalk.bold('Plugin')}`
    );
    sink_dataLine(`  ${chalk.gray('─'.repeat(70))}`);

    for (const piping of pipings) {
      const d: Record<string, unknown> = piping.data;
      const id: string = String(d.id ?? '').padEnd(6);
      const title: string = String(d.title ?? '(untitled)').padEnd(30);
      const plugin: string = String(d.plugin_name ?? '') + ' v' + String(d.plugin_version ?? '');
      const previous: string = d.previous_id ? chalk.gray(` ← node ${d.previous_id}`) : chalk.gray(' (root)');
      sink_dataLine(`  ${chalk.cyan(id)}${chalk.white(title)}${chalk.yellow(plugin)}${previous}`);
    }
    sink_dataLine('');
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    sink_errLine(chalk.red(`pipeline info: ${msg}`));
  }
}

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
 */
async function pipelineInfo_handle(args: string[]): Promise<void> {
  const nameOrId: string | undefined = args[1];
  if (!nameOrId) {
    sink_errLine(chalk.red('Usage: pipeline info <name|id>'));
    process.exitCode = 1;
    return;
  }
  const result = await pipeline_resolve(nameOrId);
  if (!result.ok) {
    const err = errorStack.stack_pop();
    sink_errLine(chalk.red(`pipeline info: ${err?.message ?? 'not found'}`));
    process.exitCode = 1;
    return;
  }
  const p = result.value;
  sink_dataLine('');
  sink_dataLine(`${chalk.bold.magenta(p.name)}  ${chalk.gray(`[id: ${p.id}]`)}`);
  if (p.description) sink_dataLine(chalk.white(`  ${p.description}`));
  if (p.authors)     sink_dataLine(chalk.gray(`  Authors: ${p.authors}`));
  if (p.category)    sink_dataLine(chalk.gray(`  Category: ${p.category}`));
  sink_dataLine(chalk.gray(`  Locked: ${p.locked ? 'yes' : 'no'}`));
  await pipelineNodes_print(p.id);
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
 */
async function pipelineRun_handle(args: string[]): Promise<void> {
  const nameOrId: string | undefined = args[1];
  if (!nameOrId) {
    sink_errLine(chalk.red('Usage: pipeline run <name|id> [--compute <resource>] [--previous <inst_id>]'));
    process.exitCode = 1;
    return;
  }

  const { computeOverride, previousOverride }: PipelineRunOverrides = pipelineRunArgs_parse(args);

  const previousInstId: number | null = await pipelineRun_previousInstId(previousOverride);
  if (previousInstId === null) return;

  const pipelineResult = await pipeline_resolve(nameOrId);
  if (!pipelineResult.ok) {
    const err = errorStack.stack_pop();
    sink_errLine(chalk.red(`pipeline run: ${err?.message ?? 'pipeline not found'}`));
    process.exitCode = 1;
    return;
  }

  sink_dataLine(chalk.gray(`Running pipeline '${pipelineResult.value.name}' on instance ${previousInstId}...`));

  const runResult = await pipeline_run(nameOrId, previousInstId, computeOverride);
  if (!runResult.ok) {
    const err = errorStack.stack_pop();
    sink_errLine(chalk.red(`pipeline run: ${err?.message ?? 'workflow creation failed'}`));
    process.exitCode = 1;
    return;
  }

  const { workflowId, pluginInstanceIds } = runResult.value;
  sink_dataLine(chalk.green(`✓ Workflow ${workflowId} created — ${pluginInstanceIds.length} node(s) queued`));
  sink_dataLine(chalk.gray(`  Instance IDs: ${pluginInstanceIds.join(', ')}`));
}

/**
 * Handles `pipeline source <name|id>`.
 *
 * @param args - Command arguments.
 */
async function pipelineSource_handle(args: string[]): Promise<void> {
  const nameOrId: string | undefined = args[1];
  if (!nameOrId) {
    sink_errLine(chalk.red('Usage: pipeline source <name|id>'));
    process.exitCode = 1;
    return;
  }
  const sourceResult = await pipeline_sourceGet(nameOrId);
  if (!sourceResult.ok) {
    const err = errorStack.stack_pop();
    sink_errLine(chalk.red(`pipeline source: ${err?.message ?? 'source not found'}`));
    process.exitCode = 1;
    return;
  }
  sink_dataLine(sourceResult.value);
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
      await pipelineInfo_handle(args);
      return envelope_ok('');
    case 'run':
      await pipelineRun_handle(args);
      return envelope_ok('');
    case 'source':
      await pipelineSource_handle(args);
      return envelope_ok('');
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
