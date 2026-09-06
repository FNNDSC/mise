/**
 * @file Static VFS Content Handler.
 *
 * Implements specialized virtual file reading and content generation
 * for static command directories (/bin, /usr/bin).
 *
 * @module
 */

import { Result, Ok, Err, errorStack } from '@fnndsc/cumin';
import { commandHelp_get } from '../../../builtins/help.js';
import type { PluginInfoModel } from '@fnndsc/menu';
import {
  pluginInfo_build,
  pluginInfoText_render,
  pluginSpecifier_parse,
  type PluginSpecifier,
} from '../../../builtins/res/plugin.info.js';
import {
  binPipelineSummary_render,
  binPipelineSummary_try,
  type BinPipelineSummary,
} from './binEntry.js';

/**
 * Reads virtual file content under command and builtin static paths.
 *
 * Handles help text formatting for /usr/bin and fetches parameter specifications for /bin plugins.
 *
 * @param pathStr - The absolute virtual path of the file to read.
 * @param prefix - The prefix of the calling provider (e.g. '/usr/bin', '/bin').
 * @returns Promise resolving to a Result containing the file contents as a string.
 */
export async function staticVfs_read(pathStr: string, prefix: string): Promise<Result<string>> {
  try {
    let effectivePath: string = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
    if (effectivePath.length > 1 && effectivePath.endsWith("/")) {
      effectivePath = effectivePath.slice(0, -1);
    }

    if (prefix === "/usr/bin") {
      const commandName: string = effectivePath.substring("/usr/bin/".length);
      const helpStr: string | undefined = commandHelp_get(commandName);
      if (helpStr !== undefined) {
        return Ok(helpStr);
      }
      errorStack.stack_push("error", `No help available for command: ${commandName}`);
      return Err();
    }

    if (prefix === "/bin") {
      const commandName: string = effectivePath.substring("/bin/".length);
      const pipelineSummary: BinPipelineSummary | null = binPipelineSummary_try(commandName);
      if (pipelineSummary !== null) return Ok(binPipelineSummary_render(pipelineSummary));

      const specifier: PluginSpecifier | null = pluginSpecifier_parse(commandName);
      if (specifier === null) {
        errorStack.stack_push("error", `Unknown /bin entry: ${commandName}`);
        return Err();
      }

      // The manual is a projection of the plugin model — the same facts
      // `plugin info` puts on the wire, so a terminal and a graphical
      // surface cannot end up describing different plugins.
      const built: Result<PluginInfoModel> = await pluginInfo_build(specifier);
      if (!built.ok) return Err();
      return Ok(pluginInfoText_render(built.value));
    }

    errorStack.stack_push("error", `File not found: ${pathStr}`);
    return Err();
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Static VFS read failed for prefix ${prefix}: ${msg}`);
    return Err();
  }
}

/**
 * Reads virtual file binary content under command and builtin static paths.
 *
 * @param pathStr - The absolute virtual path of the file to read.
 * @param prefix - The prefix of the calling provider.
 * @returns Promise resolving to a Result containing the file contents as a Buffer.
 */
export async function staticVfs_readBinary(pathStr: string, prefix: string): Promise<Result<Buffer>> {
  const res: Result<string> = await staticVfs_read(pathStr, prefix);
  if (res.ok) {
    return Ok(Buffer.from(res.value, "utf-8"));
  }
  return Err();
}
