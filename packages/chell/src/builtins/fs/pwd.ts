/**
 * @file Builtin pwd command.
 * Prints the current working directory.
 */
import { session } from '../../session/index.js';

/**
 * Prints the current working directory in the ChRIS filesystem context.
 *
 * @returns A Promise that resolves when the directory is printed.
 */
export async function builtin_pwd(): Promise<void> {
  console.log(await session.getCWD());
}
