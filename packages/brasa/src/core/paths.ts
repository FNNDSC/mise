/**
 * @file A path as the session means it: `~` is the session's home, and a
 * relative path stands under the working directory.
 *
 * @module
 */
import * as path from 'path';
import { session } from '../session/index.js';
import { backendInstalled_get } from './backend.js';

/**
 * Resolves a path against a home and a working directory, without asking
 * anything: `~` and `~/x` under the home, a relative path under the working
 * directory, and no trailing slash.
 *
 * @param inputPath - The path as typed.
 * @param home - The session's home.
 * @param cwd - The working directory.
 * @returns The absolute path.
 */
export function path_resolveFrom(inputPath: string, home: string, cwd: string): string {
  let resolved: string = inputPath;

  if (inputPath.startsWith('~')) {
    if (inputPath === '~' || inputPath === '~/') {
      resolved = home;
    } else if (inputPath.startsWith('~/')) {
      resolved = path.posix.join(home, inputPath.substring(2));
    }
  }

  if (!resolved.startsWith('/')) {
    resolved = path.posix.resolve(cwd, resolved);
  }

  if (resolved.length > 1 && resolved.endsWith('/')) {
    resolved = resolved.slice(0, -1);
  }

  return resolved;
}

/**
 * Resolves a path argument as the session means it.
 *
 * @param inputPath - The path as typed.
 * @returns The absolute path.
 */
export async function path_resolve(inputPath: string): Promise<string> {
  const home: string = (await backendInstalled_get()?.session.home_get()) ?? '/';
  const cwd: string = await session.getCWD();
  return path_resolveFrom(inputPath, home, cwd);
}
