/**
 * @file Builtin mkdir command.
 * Creates directories, reported as a command envelope.
 */
import { vfsOutcome_toResult, mkdir_render, vfs_ok, type VFSDispatcher, type VFSItem, type VfsOutcome } from '@fnndsc/fond';
import chalk from 'chalk';
import { path_resolve, error_stripDebugPrefix } from '../utils.js';
import { listingCache_get, vfsDispatcher_get } from '../../core/filesystem.js';
import { errorStack, type Result, type StackMessage } from '@fnndsc/fond';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

/** Outcome of one mkdir target, for the envelope model. */
export interface MkdirOutcome {
  path: string;
  created: boolean;
  /** Already a folder, and `-p` says that is fine. */
  existed?: boolean;
}

/** Typed invocation options for mkdir. */
export interface MkdirOptions {
  /** Directory paths to create, absolute or relative to the session cwd. */
  paths: string[];
  /**
   * Make missing parents too, and take a folder already there as done
   * (`-p`). Without it, as POSIX has it, a missing parent or an existing
   * target is an error.
   */
  parents?: boolean;
}

/**
 * Makes a folder in a projection. Under `-p` a folder already there is
 * fine, as it is on a disk; without it the projection's own refusal stands.
 *
 * @param targetPath - The absolute virtual path.
 * @param parents - Whether `-p` was given.
 * @returns The outcome.
 */
async function virtualFolder_make(targetPath: string, parents: boolean): Promise<MkdirOutcome> {
  if (parents) {
    const slash: number = targetPath.lastIndexOf('/');
    const siblings: Result<VFSItem[]> = await vfsDispatcher_get().list(targetPath.slice(0, slash) || '/');
    if (siblings.ok && siblings.value.some((item: VFSItem): boolean => item.name === targetPath.slice(slash + 1))) {
      return { path: targetPath, created: false, existed: true };
    }
  }
  return { path: targetPath, created: vfsOutcome_toResult(await vfsDispatcher_get().mkdir(targetPath), 'mkdir', targetPath).ok };
}

/**
 * Makes a folder and its missing parents (`-p`): in one step where the
 * mount offers it (CUBE makes parents with the folder), else each missing
 * parent in turn, a parent already there being fine.
 *
 * @param dispatcher - The session's filesystem.
 * @param targetPath - The folder.
 * @returns Done, or why not (`EEXIST` when the folder is already there).
 */
async function folderTree_make(dispatcher: VFSDispatcher, targetPath: string): Promise<VfsOutcome> {
  if (dispatcher.mkdirTree_offered(targetPath)) return dispatcher.mkdirTree(targetPath);
  const parts: string[] = targetPath.split('/').filter((part: string): boolean => part.length > 0);
  let walked: string = '';
  for (let i: number = 0; i < parts.length - 1; i++) {
    walked += `/${parts[i]}`;
    const made: VfsOutcome = await dispatcher.mkdir(walked);
    if (!made.ok && made.errno !== 'EEXIST') return made;
  }
  return parts.length === 0 ? vfs_ok(true) : dispatcher.mkdir(targetPath);
}

/**
 * Whether a folder is what holds a path, as `mkdir -p` asks once the store
 * says something is there: a folder is done, a file is `File exists`.
 *
 * @param dispatcher - The session's filesystem.
 * @param targetPath - The path.
 * @returns True when its parent lists a folder by that name.
 */
async function folder_isAt(dispatcher: VFSDispatcher, targetPath: string): Promise<boolean> {
  const slash: number = targetPath.lastIndexOf('/');
  const siblings: Result<VFSItem[]> = await dispatcher.list(targetPath.slice(0, slash) || '/');
  if (!siblings.ok) {
    errorStack.stack_pop();
    return false;
  }
  return siblings.value.some((item: VFSItem): boolean => item.name === targetPath.slice(slash + 1) && item.type === 'dir');
}

/**
 * The kernel's reason a verb failed, after what it was doing.
 *
 * @param doing - The verb and its operand, as the refusal opens.
 * @returns `doing: reason`, the reason the stack held (its debug prefix stripped).
 */
function refusal_said(doing: string): string {
  const reason: StackMessage | undefined = errorStack.stack_pop();
  if (reason === undefined) return `${doing}: failed`;
  const said: string = error_stripDebugPrefix(reason.message);
  // The dispatcher's refusal already names the verb; a provider's names the operand first.
  return said.startsWith('mkdir:') ? said : `${doing}: ${said.replace(/^[^:]*: /, '')}`;
}

/** Parsed `mkdir` arguments, or the option it refuses. */
export type MkdirArgs = MkdirOptions | { refused: string };

/**
 * Parses `mkdir` arguments: `-p` / `--parents`, and `--` to end options.
 * Any other option is refused by name rather than taken for a path — a
 * `-p` the session did not know once became a folder named `-p`.
 *
 * @param args - Raw command arguments.
 * @returns The options, or the refusal line for the first unknown option.
 */
export function mkdirArgs_parse(args: string[]): MkdirArgs {
  let parents: boolean = false;
  const paths: string[] = [];
  let endOfOptions: boolean = false;
  for (const arg of args) {
    if (endOfOptions || arg === '-' || !arg.startsWith('-')) {
      paths.push(arg);
      continue;
    }
    if (arg === '--') {
      endOfOptions = true;
      continue;
    }
    if (arg === '--parents') {
      parents = true;
      continue;
    }
    if (arg.startsWith('--')) return { refused: `mkdir: unrecognized option '${arg}'` };
    for (const flag of arg.substring(1)) {
      if (flag !== 'p') return { refused: `mkdir: invalid option -- '${flag}'` };
      parents = true;
    }
  }
  return { paths, parents };
}

/**
 * Creates directories: the shared typed core behind the parsed builtin and
 * the typed API.
 *
 * @param options - The directories to create, and whether parents come too.
 * @returns An envelope whose rendered text reports each directory and whose
 *   model lists per-target outcomes.
 */
export async function mkdir_run(options: MkdirOptions): Promise<CommandEnvelope> {
  const args: string[] = options.paths;
  const parents: boolean = options.parents === true;
  if (args.length === 0) {
    return envelope_error('', undefined, `${chalk.red('Usage: mkdir [-p] <directory> [directory...]')}\n`);
  }

  let rendered: string = '';
  let renderedErr: string = '';
  const outcomes: MkdirOutcome[] = [];

  for (const pathArg of args) {
    try {
      const targetPath: string = await path_resolve(pathArg);
      const parentDir: string = targetPath.substring(0, targetPath.lastIndexOf('/')) || '/';
      // A projection that makes folders (a tag under /proc/tags) makes them
      // itself; one that makes none refuses by name.
      const dispatcher: VFSDispatcher = vfsDispatcher_get();
      if (dispatcher.path_isVirtual(targetPath)) {
        const made: MkdirOutcome = await virtualFolder_make(targetPath, parents);
        if (made.created) rendered += `${mkdir_render(targetPath, true)}\n`;
        else if (made.existed !== true) renderedErr += `${chalk.red(refusal_said(`mkdir: cannot create directory '${pathArg}'`))}\n`;
        outcomes.push(made);
        if (made.created) listingCache_get().cache_invalidate?.(parentDir);
        continue;
      }
      const made: VfsOutcome = parents ? await folderTree_make(dispatcher, targetPath) : await dispatcher.mkdir(targetPath);
      if (made.ok) {
        rendered += `${mkdir_render(targetPath, true)}\n`;
        outcomes.push({ path: targetPath, created: true });
        listingCache_get().cache_invalidate?.(parentDir);
        continue;
      }
      if (made.errno === 'EEXIST') {
        if (parents && (await folder_isAt(dispatcher, targetPath))) {
          outcomes.push({ path: targetPath, created: false, existed: true });
        } else {
          renderedErr += `${chalk.red(`mkdir: cannot create directory '${pathArg}': File exists`)}\n`;
          outcomes.push({ path: targetPath, created: false });
        }
        continue;
      }
      if (made.errno === 'ENOENT') {
        renderedErr += `${chalk.red(`mkdir: cannot create directory '${pathArg}': No such file or directory`)}\n`;
        outcomes.push({ path: targetPath, created: false });
        continue;
      }
      if (made.errno === 'ENOTDIR') {
        // A file above the target: CUBE would otherwise have made a folder over it.
        renderedErr += `${chalk.red(`mkdir: cannot create directory '${pathArg}': Not a directory`)}\n`;
        outcomes.push({ path: targetPath, created: false });
        continue;
      }
      rendered += `${mkdir_render(targetPath, false)}\n`;
      if (made.reason !== undefined) renderedErr += `${chalk.red(made.reason)}\n`;
      outcomes.push({ path: targetPath, created: false });
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      renderedErr += `${chalk.red(`mkdir: ${pathArg}: ${msg}`)}\n`;
      outcomes.push({ path: pathArg, created: false });
    }
  }

  const anyFailed: boolean = outcomes.some((outcome: MkdirOutcome): boolean => !outcome.created && outcome.existed !== true);
  const model: { kind: string; data: MkdirOutcome[] } = { kind: 'fs.mkdir', data: outcomes };
  if (anyFailed) {
    const envelope: CommandEnvelope = envelope_error(rendered, undefined, renderedErr || undefined);
    envelope.model = model;
    return envelope;
  }
  return envelope_ok(rendered, model);
}

/**
 * Creates directories from parsed command-line arguments.
 *
 * @param args - Command line arguments (`-p` and directory paths).
 * @returns The envelope from {@link mkdir_run}, or the refusal of an
 *   option mkdir does not have.
 */
export async function builtin_mkdir(args: string[]): Promise<CommandEnvelope> {
  const parsed: MkdirArgs = mkdirArgs_parse(args);
  if ('refused' in parsed) return envelope_error('', undefined, `${chalk.red(parsed.refused)}\n`);
  return mkdir_run(parsed);
}
