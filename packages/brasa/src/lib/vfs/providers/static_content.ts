/**
 * @file Static VFS Content Handler.
 *
 * Implements specialized virtual file reading and content generation
 * for the core's static directories (/usr/bin, /usr/games, /usr/share/doc).
 *
 * @module
 */

import { commandHelp_get } from '../../../builtins/help.js';
import { Result, Ok, Err, errorStack } from '@fnndsc/fond';

/**
 * Reads virtual file content under command and builtin static paths.
 *
 * A builtin's help for /usr/bin and /usr/games, and the release notes for /usr/share/doc.
 *
 * @param pathStr - The absolute virtual path of the file to read.
 * @param prefix - The prefix of the calling provider (e.g. '/usr/bin').
 * @returns Promise resolving to a Result containing the file contents as a string.
 */
export async function staticVfs_read(pathStr: string, prefix: string): Promise<Result<string>> {
  try {
    let effectivePath: string = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
    if (effectivePath.length > 1 && effectivePath.endsWith("/")) {
      effectivePath = effectivePath.slice(0, -1);
    }

    if (prefix === "/usr/bin" || prefix === "/usr/games") {
      const commandName: string = effectivePath.substring(`${prefix}/`.length);
      const helpStr: string | undefined = commandHelp_get(commandName);
      if (helpStr !== undefined) {
        return Ok(helpStr);
      }
      errorStack.stack_push("error", `No help available for command: ${commandName}`);
      return Err();
    }

    if (prefix === "/usr/share/doc") {
      if (effectivePath === "/usr/share/doc/NEWS") {
        const { news_text } = await import('../../../builtins/sys/notes.js');
        return Ok(news_text());
      }
      errorStack.stack_push("error", `No such document: ${effectivePath}`);
      return Err();
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
