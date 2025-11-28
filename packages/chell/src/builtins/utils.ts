/**
 * @file Builtin Utilities
 * Pure functions for argument parsing and path resolution logic.
 */
import * as path from 'path';

/**
 * Structure for parsed command line arguments.
 */
export interface ParsedArgs {
  _: string[];
  [key: string]: string | boolean | string[];
}

/**
 * Parses raw argument strings into a structured object.
 */
export function commandArgs_process(args: string[]): ParsedArgs {
  const result: ParsedArgs = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg: string = args[i];
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
