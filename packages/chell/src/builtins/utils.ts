/**
 * @file Builtin Utilities
 * Pure functions for argument parsing and path resolution logic.
 */
import * as path from 'path';
import { context_getSingle } from '@fnndsc/salsa';
import { session } from '../session/index.js';

/**
 * Structure for parsed command line arguments.
 */
export interface ParsedArgs {
  _: string[];
  [key: string]: string | boolean | string[];
}

/**
 * Parses raw argument strings into a structured object.
 * Supports `--` as an end-of-options marker (everything after is treated as positional args).
 */
export function commandArgs_process(args: string[]): ParsedArgs {
  const result: ParsedArgs = { _: [] };
  let endOfOptions: boolean = false;

  for (let i = 0; i < args.length; i++) {
    const arg: string = args[i];

    // Check for -- (end of options marker)
    if (arg === '--') {
      endOfOptions = true;
      continue; // Skip the -- itself
    }

    // After --, everything is a positional argument
    if (endOfOptions) {
      (result._ as string[]).push(arg);
      continue;
    }

    if (arg.startsWith('--')) {
      const key: string = arg.substring(2);
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        result[key] = args[i + 1];
        i++;
      } else {
        result[key] = true;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      const flags = arg.substring(1).split('');
      flags.forEach(flag => result[flag] = true);
    } else {
      (result._ as string[]).push(arg);
    }
  }
  return result;
}

/**
 * Context required for path resolution.
 */
export interface PathContext {
    user: string | null;
    cwd: string;
}

/**
 * Resolves a path argument, handling `~` expansion and relative paths.
 * Pure function version that takes context as argument.
 * 
 * @param inputPath - The path to resolve.
 * @param context - User and CWD context.
 * @returns The absolute path.
 */
export function path_resolve_pure(inputPath: string, context: PathContext): string {
  let resolved = inputPath;
  const { user, cwd } = context;
  
  if (inputPath.startsWith('~')) {
    const home = user ? `/home/${user}` : '/';
    if (inputPath === '~' || inputPath === '~/') {
      resolved = home;
    } else if (inputPath.startsWith('~/')) {
      resolved = path.posix.join(home, inputPath.substring(2));
    }
  }
  
  if (!resolved.startsWith('/')) {
    resolved = path.posix.resolve(cwd, resolved);
  }
  
  // Normalize
  if (resolved.length > 1 && resolved.endsWith('/')) {
    resolved = resolved.slice(0, -1);
  }
  
  return resolved;
}

/**
 * Resolves a path argument, handling `~` expansion and relative paths.
 * @param inputPath - The path to resolve.
 * @returns The absolute path.
 */
export async function path_resolve(inputPath: string): Promise<string> {
  const context = context_getSingle();
  const user: string | null = context.user;
  const cwd: string = await session.getCWD();
  return path_resolve_pure(inputPath, { user, cwd });
}

/**
 * Resolves links in a path without using PathMapper (for physical mode).
 * Checks each component to see if it's a link and follows it.
 *
 * @param targetPath - The path to resolve.
 * @returns The resolved path with links followed.
 */
export async function path_resolveLinks(targetPath: string): Promise<string> {
  // We need to dynamically import files_list to avoid circular dependency
  // because builtins/fs/ls.ts imports path_resolve from here
  const { files_list } = await import('@fnndsc/chili/commands/fs/ls.js');

  const components: string[] = targetPath.split('/').filter(c => c);
  let currentPath: string = '';

  for (const component of components) {
    const parentPath: string = currentPath || '/';
    currentPath = `${currentPath}/${component}`;

    try {
      // List parent directory to check if component is a link
      const items: any[] = await files_list({ path: parentPath }, parentPath);

      // Find the component in the listing
      const item = items.find((i: any) => i.name === component);

      if (item && item.type === 'link' && item.target) {
        // Component is a link - resolve it
        if (item.target.startsWith('/')) {
          // Absolute link target
          currentPath = item.target;
        } else {
          // Relative link target
          currentPath = `${parentPath}/${item.target}`.replace('//', '/');
        }
      }
    } catch (error) {
      // If we can't list the directory, continue with the current path
      continue;
    }
  }

  return currentPath || '/';
}