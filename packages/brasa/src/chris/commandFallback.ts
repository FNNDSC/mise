/**
 * @file What the ChRIS backend does with a word the registry does not answer.
 *
 * A plugin named with its version runs as that plugin. A word naming a
 * plugin or a pipeline in `/bin` runs it (a captured line runs only a
 * pipeline: a plugin's run prints live). Anything else goes to chili, when
 * chili has the command, with a notice ahead of its output.
 *
 * @module
 */
import chalk from 'chalk';
import { CHRIS_BUILTIN_LINES } from './help.js';
import { variablesPage_render } from '../builtins/variablesPage.js';
import type { ListingItem, CommandEnvelope } from '@fnndsc/menu';
import type { Result } from '@fnndsc/fond';
import type { BackendFallback } from '../core/backend.js';
import { envelope_deliver, sink_get } from '../core/sink.js';
import { exitCode_read, handler_runDirect } from '../core/handlerRun.js';
import { binExecutableMatches_get, binPluginHighest_find, type BinExecutableMatches, type BinPluginHighest } from './binExecutables.js';
import { builtin_pipeline } from '../builtins/res/pipeline.js';
import { builtin_executePlugin } from '../builtins/pluginExecute.js';
import { pluginExecutable_handle } from '../builtins/executable.js';
import { pipelineExecutableHelp_render, pluginExecutableHelp_render } from '../builtins/help.js';
import { chiliCommand_run, chiliCommand_exists, chiliDelegationNotice_build } from './chiliDelegate.js';
import { feed_create, type FeedCreationResult } from '@fnndsc/salsa';
import { path_extractPluginInstanceID, path_isInFeed } from '@fnndsc/cumin';
import path from 'path';
import { path_resolve } from '../core/paths.js';
import { newFeed_cacheAdd } from '../builtins/feedCreation.js';
import { OperandRefusal, operands_read, stage_lines, stage_make, stageMade_lines, type BinOperands, type Stage } from '../builtins/operands.js';

/**
 * The node a pipeline run starts from, read from its operand (#1303): a
 * directory inside a feed is that node; outside one, or a set of files
 * shaped into a stage, pl-dircopy roots a new feed first, the directory's
 * name (or the subjects') as its title, and the run goes on from that root.
 *
 * @param name - The pipeline's `/bin` name, for the refusal lines.
 * @param args - The words after it.
 * @returns The words to run with (`--previous` set), or null after a refusal was said.
 */
async function pipelineOperand_place(name: string, args: string[]): Promise<string[] | null> {
  let operands: BinOperands;
  try {
    operands = await operands_read(args);
  } catch (error: unknown) {
    if (!(error instanceof OperandRefusal)) throw error;
    sink_get().err_write(chalk.red(`${name}: ${error.message}\n`));
    return null;
  }
  if (operands.directory === null && operands.subjects.length === 0) return args;
  if (operands.rest.some((word: string): boolean => word.split('=')[0] === '--previous')) {
    sink_get().err_write(chalk.red(`${name}: the operand and --previous say the input twice\n`));
    return null;
  }
  if (operands.directory !== null && path_isInFeed(operands.directory)) {
    const here: number | null = path_extractPluginInstanceID(operands.directory);
    if (here === null) {
      sink_get().err_write(chalk.red(`${name}: ${operands.typed[0]} is in a feed but not at a node (…/feeds/feed_N/pl-x_ID)\n`));
      return null;
    }
    return ['--previous', String(here), ...operands.rest];
  }
  let stage: Stage | null = null;
  let root: string = operands.directory ?? '';
  let title: string = path.posix.basename(root);
  if (operands.directory === null) {
    try {
      stage = await stage_make(operands.subjects, await path_resolve('~'));
    } catch (error: unknown) {
      if (!(error instanceof OperandRefusal)) throw error;
      sink_get().err_write(chalk.red(`${name}: ${error.message}\n`));
      return null;
    }
    for (const line of stage_lines(stage)) sink_get().data_write(chalk.cyan(`${line}\n`));
    root = stage.path;
    title = stage.subjects.map((subject): string => subject.name).join(', ');
  }
  const feed: FeedCreationResult | null = await feed_create([root], { title });
  if (feed === null) {
    sink_get().err_write(chalk.red(`${name}: could not root a feed with pl-dircopy of ${operands.typed.join(' ')}\n`));
    return null;
  }
  const rootInstanceID: number = feed.pluginInstance.data.id;
  newFeed_cacheAdd({ feedID: feed.id, title, ownerUsername: feed.owner_username, rootInstanceID });
  sink_get().data_write(chalk.green(`Feed created: ${feed.id}\n`));
  if (stage !== null) {
    for (const line of stageMade_lines(stage, `/home/${feed.owner_username}/feeds/feed_${feed.id}/pl-dircopy_${rootInstanceID}/data`)) sink_get().data_write(chalk.cyan(`${line}\n`));
  }
  return ['--previous', String(rootInstanceID), ...operands.rest];
}

/**
 * Handles a pipeline name invoked directly as an executable from /bin.
 * Routes flag combinations to the appropriate pipeline subcommand:
 *   --diagram             → pipeline diagram (preserving renderer flags)
 *   --signalflow          → pipeline diagram --signalflow
 *   --help / -h           → contextual pipeline-executable help
 *   --nodes / --parameters → pipeline info
 *   --manifest             → pipeline manifest
 *   --source / --readme    → pipeline source
 *   (bare or --compute)    → pipeline run
 *
 * @param name - The pipeline name as typed.
 * @param args - Arguments following the pipeline name.
 * @returns The pipeline builtin's envelope, preserving diagram models and text.
 */
async function pipelineExecutable_handle(name: string, args: string[]): Promise<CommandEnvelope> {
  const exitCodeBefore: number = exitCode_read();
  let envelope: CommandEnvelope | undefined;
  if (args.includes('--help') || args.includes('-h')) {
    envelope = { status: 'ok', rendered: pipelineExecutableHelp_render(name) };
  } else if (args.includes('--diagram')) {
    const diagramArgs: string[] = args.filter((argument: string): boolean => argument !== '--diagram');
    envelope = await builtin_pipeline(['diagram', name, ...diagramArgs]);
  } else if (args.includes('--signalflow')) {
    envelope = await builtin_pipeline(['diagram', name, '--signalflow']);
  } else if (args.includes('--manifest')) {
    envelope = await builtin_pipeline(['manifest', name]);
  } else if (args.includes('--nodes') || args.includes('--parameters')) {
    envelope = await builtin_pipeline(['info', name]);
  } else if (args.includes('--source') || args.includes('--readme')) {
    envelope = await builtin_pipeline(['source', name]);
  } else {
    // The operand says where the run starts (#1303); refused, nothing runs.
    const placed: string[] | null = await pipelineOperand_place(name, args);
    envelope = placed === null ? { status: 'error', rendered: '' } : await builtin_pipeline(['run', name, ...placed]);
  }
  const result: CommandEnvelope = envelope ?? { status: 'ok', rendered: '' };
  const exitCodeAfter: number = exitCode_read();
  if (exitCodeAfter !== 0 && exitCodeAfter !== exitCodeBefore) result.status = 'error';
  return result;
}

/**
 * Hands a word to chili when chili has it, with the hand-off notice on the
 * live sink first, so it appears ahead of chili's (possibly slow) output.
 *
 * @param command - The word.
 * @param args - Its arguments.
 * @returns chili's delivered envelope, or null when chili has no such command.
 */
async function chili_delegate(command: string, args: string[]): Promise<CommandEnvelope | null> {
  if (!(await chiliCommand_exists(command))) return null;
  sink_get().data_write(chiliDelegationNotice_build(command));
  const chiliEnvelope: CommandEnvelope = await chiliCommand_run(command, ['-s', ...args]);
  envelope_deliver(chiliEnvelope);
  return chiliEnvelope;
}

/** The ChRIS backend's fallback. */
export const chrisFallback: BackendFallback = {
  claim: pluginExecutable_handle,
  unknown: async (command: string, args: string[], captured: boolean): Promise<CommandEnvelope | null> => {
    const binMatches: BinExecutableMatches = await binExecutableMatches_get(command);
    // A bare /bin plugin name runs the plugin, and a run is a CUBE job: typed
    // at the prompt it starts one; inside a pipe or a redirect it does not, so
    // a pipeline of words never starts a job as a side effect.
    if (!captured && binMatches.plugin) {
      return handler_runDirect(
        (pluginArgs: string[]): Promise<CommandEnvelope> => builtin_executePlugin(command, pluginArgs),
        args,
      );
    }
    if (binMatches.pipeline) {
      // By its /bin name, as when it was typed: a pipeline named by its own
      // name runs as exactly the one /bin lists.
      const envelope: CommandEnvelope = await pipelineExecutable_handle(binMatches.pipeline.name, args);
      envelope_deliver(envelope);
      return envelope;
    }
    // A bare plugin name runs the highest version /bin lists for it, and
    // says which, so the line read back names exactly what ran (#1303).
    // The same job rule as above: typed at the prompt it starts one, in a
    // pipe or a redirect it does not.
    const highest: BinPluginHighest | null = captured ? null : await binPluginHighest_find(command);
    if (highest !== null) {
      sink_get().data_write(chalk.gray(`running ${highest.executable} (highest of ${highest.versions.join(', ')})\n`));
      return handler_runDirect(
        (pluginArgs: string[]): Promise<CommandEnvelope> => builtin_executePlugin(highest.executable, pluginArgs),
        args,
      );
    }
    return chili_delegate(command, args);
  },
  help: async (command: string): Promise<string | null> => {
    // The variables page: the core's, with this backend's built-in lines.
    if (command === 'variables') return variablesPage_render(CHRIS_BUILTIN_LINES);
    // A plugin version (`pl-dircopy-v2.1.2`) is its own executable.
    if (/-v[^/]+$/.test(command)) return pluginExecutableHelp_render(command);
    const binMatches: BinExecutableMatches = await binExecutableMatches_get(command);
    if (binMatches.pipeline) return pipelineExecutableHelp_render(binMatches.pipeline.name);
    // A bare plugin name's help is its highest version's.
    const highest: BinPluginHighest | null = await binPluginHighest_find(command);
    return highest === null ? null : pluginExecutableHelp_render(highest.executable);
  },
};
