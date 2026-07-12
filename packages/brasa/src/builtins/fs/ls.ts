/**
 * @file Builtin ls command.
 * Lists directory contents.
 */
import chalk from 'chalk';
import { ParsedArgs, commandArgs_process, path_resolve } from '../utils.js';
import { listCache_get, type CommandEnvelope } from '@fnndsc/cumin';
import { session } from '../../session/index.js';
import { vfs } from '../../lib/vfs/vfs.js';

/** Valid sort fields for ls. */
type LsSortField = 'name' | 'size' | 'date' | 'owner';

/**
 * Lists the contents of the current or specified directory/files in the ChRIS filesystem context.
 * Supports a virtual `/bin` directory for plugins and multiple paths (e.g., from wildcard expansion).
 *
 * @param args - An array containing target paths (optional).
 * @returns A Promise that resolves when the directory contents are listed.
 */
export async function builtin_ls(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const pathArgsRaw: string[] = parsed._ as string[];

  let sortBy: LsSortField = 'name';
  if (parsed['sort']) {
    const sortValue: string = String(parsed['sort']);
    if (['name', 'size', 'date', 'owner'].includes(sortValue)) {
      sortBy = sortValue as LsSortField;
    }
  }

  let pathArgs: string[] = pathArgsRaw;

  const shouldRefresh: boolean = !!parsed['refresh'] || !!parsed['f'];

  const options: {
    long: boolean;
    human: boolean;
    oneColumn: boolean;
    sort: LsSortField;
    reverse: boolean;
    directory: boolean;
  } = {
    long: !!parsed['l'],
    human: !!parsed['h'],
    oneColumn: !!parsed['1'],
    sort: sortBy,
    reverse: !!parsed['reverse'] || !!parsed['r'],
    directory: !!parsed['d']
  };

  let rendered: string = '';
  let renderedErr: string = '';

  if (shouldRefresh) {
    const listCache = listCache_get();
    if (pathArgs.length === 0) {
      const cwd: string = await session.getCWD();
      rendered += `${chalk.gray(`[Cache] Invalidating: ${cwd}`)}\n`;
      listCache.cache_invalidate(cwd);
      listCache.cache_invalidate();
    } else {
      for (const pathArg of pathArgs) {
        const resolvedPath: string = await path_resolve(pathArg);
        rendered += `${chalk.gray(`[Cache] Invalidating: ${resolvedPath}`)}\n`;
        listCache.cache_invalidate(resolvedPath);
      }
      listCache.cache_invalidate();
    }
  }

  // One or more listings, in argument order; each returns its own envelope.
  const targets: Array<string | undefined> = [];
  if (pathArgs.length === 0) {
    targets.push(undefined);
  } else {
    for (const pathArg of pathArgs) {
      targets.push(await path_resolve(pathArg));
    }
  }

  for (const target of targets) {
    const envelope: CommandEnvelope = await vfs.list(target, options);
    rendered += envelope.rendered;
    if (envelope.renderedErr !== undefined) {
      renderedErr += envelope.renderedErr;
    }
  }

  const result: CommandEnvelope = { status: 'ok', rendered };
  if (renderedErr.length > 0) {
    result.renderedErr = renderedErr;
  }
  return result;
}
