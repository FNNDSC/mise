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
import type { ListingItem, CommandEnvelope } from '@fnndsc/menu';
import type { Result } from '@fnndsc/fond';
import type { BackendFallback } from '../core/backend.js';
import { envelope_deliver, sink_get } from '../core/sink.js';
import { exitCode_read, handler_runDirect } from '../core/handlerRun.js';
import { vfs } from '../lib/vfs/vfs.js';
import { builtin_pipeline } from '../builtins/res/pipeline.js';
import { builtin_executePlugin } from '../builtins/pluginExecute.js';
import { pluginExecutable_handle } from '../builtins/executable.js';
import { pipelineExecutableHelp_render, pluginExecutableHelp_render } from '../builtins/help.js';
import { chiliCommand_run, chiliCommand_exists, chiliDelegationNotice_build } from './chiliDelegate.js';

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
    envelope = await builtin_pipeline(['run', name, ...args]);
  }
  const result: CommandEnvelope = envelope ?? { status: 'ok', rendered: '' };
  const exitCodeAfter: number = exitCode_read();
  if (exitCodeAfter !== 0 && exitCodeAfter !== exitCodeBefore) result.status = 'error';
  return result;
}

interface BinExecutableMatches {
  plugin: ListingItem | undefined;
  pipeline: ListingItem | undefined;
}

/**
 * Finds exact plugin and pipeline executable matches in the virtual `/bin`.
 *
 * @param command - Executable name as typed.
 * @returns Matching dynamic executable entries, if the listing is available.
 */
async function binExecutableMatches_get(command: string): Promise<BinExecutableMatches> {
  const binResult: Result<ListingItem[]> = await vfs.data_get('/bin');
  if (!binResult.ok) {
    return { plugin: undefined, pipeline: undefined };
  }
  return {
    plugin: binResult.value.find(
      (item: ListingItem): boolean => item.name === command && item.type === 'plugin',
    ),
    pipeline: binResult.value.find(
      (item: ListingItem): boolean => item.name === command && item.type === 'pipeline',
    ),
  };
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
      const envelope: CommandEnvelope = await pipelineExecutable_handle(command, args);
      envelope_deliver(envelope);
      return envelope;
    }
    return chili_delegate(command, args);
  },
  help: async (command: string): Promise<string | null> => {
    // A plugin version (`pl-dircopy-v2.1.2`) is its own executable.
    if (/-v[^/]+$/.test(command)) return pluginExecutableHelp_render(command);
    const binMatches: BinExecutableMatches = await binExecutableMatches_get(command);
    return binMatches.pipeline ? pipelineExecutableHelp_render(command) : null;
  },
};
