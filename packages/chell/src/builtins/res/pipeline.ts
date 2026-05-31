/**
 * @file Builtin pipeline command.
 *
 * Manages registered ChRIS pipelines. Subcommands:
 * - `list`   — list all registered pipelines
 * - `info`   — show a pipeline's nodes and default parameters
 * - `run`    — instantiate a pipeline as a workflow on the current context node
 * - `source` — display the pipeline's YAML source file
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
} from '@fnndsc/cumin';
import {
  pipelines_list,
  pipeline_run,
  pipeline_sourceGet,
} from '@fnndsc/salsa';
import { args_checkHasHelpFlag, help_show } from '../help.js';
import { session } from '../../session/index.js';

/**
 * Renders a pipeline's node structure by fetching its piping definitions.
 *
 * @param pipelineId - Numeric pipeline ID.
 */
async function pipelineNodes_print(pipelineId: number): Promise<void> {
  const client = await session.connection.client_get();
  if (!client) {
    console.error(chalk.red('pipeline info: not connected to ChRIS'));
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
      console.error(chalk.red(`pipeline info: pipeline ${pipelineId} not found`));
      return;
    }

    const pipingsResponse = await pipelineObj.getPluginPipings({ limit: 1000 });
    const pipings = pipingsResponse.getItems();

    console.log(chalk.bold.blue('\nNodes:\n'));
    console.log(
      `  ${chalk.bold('ID'.padEnd(6))}${chalk.bold('Title'.padEnd(30))}${chalk.bold('Plugin')}`
    );
    console.log(`  ${chalk.gray('─'.repeat(70))}`);

    for (const piping of pipings) {
      const d = piping.data;
      const id = String(d.id ?? '').padEnd(6);
      const title = String(d.title ?? '(untitled)').padEnd(30);
      const plugin = String(d.plugin_name ?? '') + ' v' + String(d.plugin_version ?? '');
      const previous = d.previous_id ? chalk.gray(` ← node ${d.previous_id}`) : chalk.gray(' (root)');
      console.log(`  ${chalk.cyan(id)}${chalk.white(title)}${chalk.yellow(plugin)}${previous}`);
    }
    console.log('');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`pipeline info: ${msg}`));
  }
}

/**
 * Manages ChRIS pipeline registration, inspection, and execution.
 *
 * @param args - Command arguments.
 */
export async function builtin_pipeline(args: string[]): Promise<void> {
  if (args_checkHasHelpFlag(args, 'pipeline')) {
    help_show('pipeline');
    return;
  }

  const subcommand: string | undefined = args[0];

  if (!subcommand) {
    const current: string | null = await chrisContext.ChRISplugin_get();
    console.log(chalk.gray('Usage: pipeline <list|info|run|source> [args]'));
    if (current) {
      console.log(chalk.gray(`  Current context node: instance ${current}`));
    }
    return;
  }

  switch (subcommand) {

    case 'list': {
      const search: string | undefined = args[1];
      const data = await pipelines_list(search);
      if (!data || data.tableData.length === 0) {
        console.log(chalk.yellow('No pipelines registered.'));
        return;
      }
      console.log('');
      console.log(
        `  ${chalk.bold('ID'.padEnd(6))}${chalk.bold('Name'.padEnd(40))}${chalk.bold('Category'.padEnd(16))}${chalk.bold('Authors')}`
      );
      console.log(`  ${chalk.gray('─'.repeat(80))}`);
      for (const row of data.tableData) {
        const id = String(row.id ?? '').padEnd(6);
        const name = String(row.name ?? '').padEnd(40);
        const cat = String(row.category ?? '').padEnd(16);
        const authors = String(row.authors ?? '');
        console.log(`  ${chalk.cyan(id)}${chalk.magenta(name)}${chalk.gray(cat)}${chalk.gray(authors)}`);
      }
      console.log('');
      return;
    }

    case 'info': {
      const nameOrId: string | undefined = args[1];
      if (!nameOrId) {
        console.error(chalk.red('Usage: pipeline info <name|id>'));
        process.exitCode = 1;
        return;
      }
      const result = await pipeline_resolve(nameOrId);
      if (!result.ok) {
        const err = errorStack.stack_pop();
        console.error(chalk.red(`pipeline info: ${err?.message ?? 'not found'}`));
        process.exitCode = 1;
        return;
      }
      const p = result.value;
      console.log('');
      console.log(`${chalk.bold.magenta(p.name)}  ${chalk.gray(`[id: ${p.id}]`)}`);
      if (p.description) console.log(chalk.white(`  ${p.description}`));
      if (p.authors)     console.log(chalk.gray(`  Authors: ${p.authors}`));
      if (p.category)    console.log(chalk.gray(`  Category: ${p.category}`));
      console.log(chalk.gray(`  Locked: ${p.locked ? 'yes' : 'no'}`));
      await pipelineNodes_print(p.id);
      return;
    }

    case 'run': {
      const nameOrId: string | undefined = args[1];
      if (!nameOrId) {
        console.error(chalk.red('Usage: pipeline run <name|id> [--compute <resource>] [--previous <inst_id>]'));
        process.exitCode = 1;
        return;
      }

      let computeOverride: string | undefined;
      let previousOverride: number | undefined;

      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--compute' && i + 1 < args.length) {
          computeOverride = args[++i];
        } else if (args[i] === '--previous' && i + 1 < args.length) {
          previousOverride = parseInt(args[++i], 10);
        }
      }

      // Resolve previous inst ID from context if not supplied
      let previousInstId: number;
      if (previousOverride !== undefined) {
        previousInstId = previousOverride;
      } else {
        const contextStr: string | null = await chrisContext.ChRISplugin_get();
        if (!contextStr) {
          console.error(chalk.red('pipeline run: no plugin instance in context.'));
          console.error(chalk.gray('  Navigate to a feed node first, or use --previous <id>'));
          process.exitCode = 1;
          return;
        }
        previousInstId = parseInt(contextStr, 10);
        if (isNaN(previousInstId)) {
          console.error(chalk.red(`pipeline run: invalid context instance '${contextStr}'`));
          process.exitCode = 1;
          return;
        }
      }

      const pipelineResult = await pipeline_resolve(nameOrId);
      if (!pipelineResult.ok) {
        const err = errorStack.stack_pop();
        console.error(chalk.red(`pipeline run: ${err?.message ?? 'pipeline not found'}`));
        process.exitCode = 1;
        return;
      }

      console.log(chalk.gray(`Running pipeline '${pipelineResult.value.name}' on instance ${previousInstId}...`));

      const runResult = await pipeline_run(nameOrId, previousInstId, computeOverride);
      if (!runResult.ok) {
        const err = errorStack.stack_pop();
        console.error(chalk.red(`pipeline run: ${err?.message ?? 'workflow creation failed'}`));
        process.exitCode = 1;
        return;
      }

      const { workflowId, pluginInstanceIds } = runResult.value;
      console.log(chalk.green(`✓ Workflow ${workflowId} created — ${pluginInstanceIds.length} node(s) queued`));
      console.log(chalk.gray(`  Instance IDs: ${pluginInstanceIds.join(', ')}`));
      return;
    }

    case 'source': {
      const nameOrId: string | undefined = args[1];
      if (!nameOrId) {
        console.error(chalk.red('Usage: pipeline source <name|id>'));
        process.exitCode = 1;
        return;
      }
      const sourceResult = await pipeline_sourceGet(nameOrId);
      if (!sourceResult.ok) {
        const err = errorStack.stack_pop();
        console.error(chalk.red(`pipeline source: ${err?.message ?? 'source not found'}`));
        process.exitCode = 1;
        return;
      }
      console.log(sourceResult.value);
      return;
    }

    default:
      console.error(chalk.red(`pipeline: unknown subcommand '${subcommand}'`));
      console.log(chalk.gray('  Subcommands: list, info, run, source'));
      process.exitCode = 1;
  }
}
