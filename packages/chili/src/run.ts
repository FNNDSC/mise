/**
 * @file In-process library entry for the chili (ChILI) CLI.
 *
 * Exposes {@link run}, which builds a fresh Commander program and executes a
 * single chili command, returning when it completes. Unlike the bin entry
 * (`index.ts`), importing this module has no side effect of running the CLI and
 * never calls `process.exit`, so a host process such as chell can drive chili
 * in-process instead of spawning a separate `node` subprocess.
 *
 * @module
 */

import { Command, CommanderError } from "commander";
import figlet from "figlet";

import { connectCommand_setup } from "./connect/connectHandler.js";
import { FeedGroupHandler, FeedMemberHandler } from "./feeds/feedHandler.js";
import {
  PluginGroupHandler,
  PluginMemberHandler,
} from "./plugins/pluginHandler.js";
import { PluginMetaGroupHandler } from "./plugins/pluginMetaHandler.js";
import { PluginContextGroupHandler } from "./plugins/pluginGroupHandler.js";
import { inodeCommand_setup } from "./filesystem/inodeCommand.js";
import { contextCommand_setup } from "./context/contextCommand.js";
import { pathCommand_setup } from "./path/pathCommand.js";
import { fileBrowserCommand_setup } from "./filesystem/filesystemHandler.js";
import { manCommand_setup } from "./man/man.js";
import { chefsCommand_setup } from "./chefs/chefs.js";
import { PACSServerGroupHandler } from "./pacs/pacsServerHandler.js";
import { PACSQueryGroupHandler } from "./pacs/pacsQueryHandler.js";
import { PACSRetrieveGroupHandler } from "./pacs/pacsRetrieveHandler.js";
import {
  chrisConnection_init,
  NodeStorageProvider,
  errorStack_getAllOfType,
} from "@fnndsc/cumin";
import { FileGroupHandler } from "./filesystem/fileGroupHandler.js";
import { chiliErrLog, chiliLog } from "./screen/output.js";

/**
 * Suppress the DEP0169 (`url.parse()`) warning emitted transitively by
 * axios -> proxy-from-env, which we do not control. Installed once at import.
 * See the tracking note in the original bin entry for context.
 */
const originalEmitWarning = process.emitWarning;
process.emitWarning = function (
  warning: string | Error,
  ...args: unknown[]
): void {
  if (
    typeof warning === "string" &&
    (warning.includes("DEP0169") || warning.includes("url.parse()"))
  ) {
    return;
  }
  return (originalEmitWarning as (...a: unknown[]) => void).call(
    process,
    warning,
    ...args
  );
};

/**
 * Registers every chili command handler on the supplied program. The handler
 * setup functions are program-parameterised, so a fresh program can be wired on
 * each call without sharing Commander state across invocations.
 *
 * @param program - The Commander program to register commands on.
 */
async function handlers_initialize(program: Command): Promise<void> {
  // Connection is intentionally not enforced here so that `--help` works; each
  // command fails individually if it needs a connection that is not present.
  fileBrowserCommand_setup(program);
  contextCommand_setup(program);
  pathCommand_setup(program);
  manCommand_setup(program);
  chefsCommand_setup(program);

  const pacsServerHandler: PACSServerGroupHandler = new PACSServerGroupHandler();
  pacsServerHandler.pacsServerCommand_setup(program);
  const pacsQueryHandler: PACSQueryGroupHandler = new PACSQueryGroupHandler();
  pacsQueryHandler.pacsQueryCommand_setup(program);
  const pacsRetrieveHandler: PACSRetrieveGroupHandler =
    new PACSRetrieveGroupHandler();
  pacsRetrieveHandler.pacsRetrieveCommand_setup(program);
  await inodeCommand_setup(program);

  const pluginGroupHandler: PluginGroupHandler = new PluginGroupHandler();
  pluginGroupHandler.pluginGroupCommand_setup(program);

  const pluginMetaGroupHandler: PluginMetaGroupHandler =
    new PluginMetaGroupHandler();
  pluginMetaGroupHandler.pluginMetaGroupCommand_setup(program);

  const feedGroupHandler: FeedGroupHandler = new FeedGroupHandler();
  feedGroupHandler.feedGroupCommand_setup(program);

  const feedMemberHandler: FeedMemberHandler = new FeedMemberHandler();
  feedMemberHandler.feedCommand_setup(program);

  const pluginMemberHandler: PluginMemberHandler = new PluginMemberHandler();
  pluginMemberHandler.pluginCommand_setup(program);

  try {
    const filesGroupHandler: FileGroupHandler =
      await FileGroupHandler.handler_create("files");
    filesGroupHandler.fileGroupCommand_setup(program);

    const linksGroupHandler: FileGroupHandler =
      await FileGroupHandler.handler_create("links");
    linksGroupHandler.fileGroupCommand_setup(program);

    const dirsGroupHandler: FileGroupHandler =
      await FileGroupHandler.handler_create("dirs");
    dirsGroupHandler.fileGroupCommand_setup(program);
  } catch (e: unknown) {
    const err: string = e instanceof Error ? e.message : String(e);
    const errors: string[] = errorStack_getAllOfType("error");
    const warnings: string[] = errorStack_getAllOfType("warning");
    chiliLog(
      `Note: File group commands (files, dirs, links) are unavailable. Reason: ${err}`
    );
    if (errors.length > 0) {
      chiliLog("Errors:");
      errors.forEach((msg) => chiliLog(`  - ${msg}`));
    }
    if (warnings.length > 0) {
      chiliLog("Warnings:");
      warnings.forEach((msg) => chiliLog(`  - ${msg}`));
    }
  }

  try {
    const computesOfPluginHandler: PluginContextGroupHandler =
      await PluginContextGroupHandler.handler_create("computesofplugin");
    computesOfPluginHandler.pluginContextGroupCommand_setup(program);

    const pluginInstancesHandler: PluginContextGroupHandler =
      await PluginContextGroupHandler.handler_create("instancesofplugin");
    pluginInstancesHandler.pluginContextGroupCommand_setup(program);

    const pluginParametersHandler: PluginContextGroupHandler =
      await PluginContextGroupHandler.handler_create("parametersofplugin");
    pluginParametersHandler.pluginContextGroupCommand_setup(program);
  } catch (e: unknown) {
    const err: string = e instanceof Error ? e.message : String(e);
    const errors: string[] = errorStack_getAllOfType("error");
    const warnings: string[] = errorStack_getAllOfType("warning");
    chiliLog(`Note: Plugin context commands are unavailable. Reason: ${err}`);
    if (errors.length > 0) {
      chiliLog("Errors:");
      errors.forEach((msg) => chiliLog(`  - ${msg}`));
    }
    if (warnings.length > 0) {
      chiliLog("Warnings:");
      warnings.forEach((msg) => chiliLog(`  - ${msg}`));
    }
  }
}

/**
 * Extracts a leading `key=value` context string from an argv array.
 *
 * @param args - An argv array shaped like `process.argv` (exec, script, ...).
 * @returns A tuple of the context string (if any) and argv with it removed.
 */
function context_parse(args: string[]): [string | undefined, string[]] {
  for (let i = 2; i < args.length; i++) {
    const arg: string = args[i];
    if (arg.includes("=") && !arg.startsWith("-")) {
      const context: string = arg;
      const newArgs: string[] = [...args.slice(0, i), ...args.slice(i + 1)];
      return [context, newArgs];
    }
  }
  return [undefined, args];
}

/**
 * Executes a single chili command in the current process.
 *
 * Builds a fresh Commander program (so repeated calls do not share parser
 * state), wires all command handlers, and parses the supplied arguments. Help,
 * version and usage errors are handled gracefully (Commander's message is
 * already written) instead of terminating the process; genuine errors thrown by
 * a command action propagate to the caller.
 *
 * @param argv - The chili arguments, e.g. `["feeds", "list", "-s"]` (without
 *   the leading `node`/script entries).
 */
export async function run(argv: string[]): Promise<void> {
  const nodeStorageProvider: NodeStorageProvider = new NodeStorageProvider();
  const connection = await chrisConnection_init(nodeStorageProvider);

  // Commander's default parsing expects argv[0]/argv[1] to be exec/script.
  let fullArgv: string[] = ["node", "chili", ...argv];
  const [context, newArgs] = context_parse(fullArgv);
  if (context) {
    const contextSetSuccess: boolean = await connection.context_set(context);
    if (!contextSetSuccess) {
      chiliErrLog("Failed to set context.");
      return;
    }
    fullArgv = newArgs;
  }

  const program: Command = new Command();
  program
    .name("chili")
    .description("ChILI handles Intelligent Line Interactions")
    .version("1.0.1")
    .option("-v, --verbose", "enable verbose output")
    .option("-c, --config <path>", "path to config file")
    .option("-s, --nosplash", "disable splash screen")
    .exitOverride();

  connectCommand_setup(program);
  await handlers_initialize(program);

  program.parseOptions(fullArgv);
  const options = program.opts();
  if (!options.nosplash) {
    chiliLog(figlet.textSync("ChILI"));
    chiliLog("ChILI handles Intelligent Line Interactions");
  }

  try {
    await program.parseAsync(fullArgv);
  } catch (err: unknown) {
    // Under exitOverride, --help/--version/usage errors throw a CommanderError
    // whose message Commander has already written. Swallow these so the host
    // (e.g. a chell REPL) is not torn down; rethrow anything else.
    if (err instanceof CommanderError) {
      return;
    }
    throw err;
  }
}
