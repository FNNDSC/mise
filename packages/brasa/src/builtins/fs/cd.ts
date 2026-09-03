/**
 * @file Builtin cd command.
 * Changes the current working directory, reported as a command envelope.
 */
import chalk from 'chalk';
import path from 'path';
import { session } from '../../session/index.js';
import { path_resolve, path_resolveLinks, error_stripDebugPrefix } from '../utils.js';
import { envelope_ok, envelope_error } from '@fnndsc/cumin';
import type { CommandEnvelope, Result, StackMessage, Client } from '@fnndsc/cumin';
import type { VFSItem } from '@fnndsc/salsa';

/**
 * Interface representing a FileBrowserFolder from ChRIS API.
 */
interface FileBrowserFolder {
  path?: string;
  data?: {
    path?: string;
  };
}

/**
 * Structural VFS container paths that exist by definition and need no API
 * validation when `cd`-ing into them.
 */
const STRUCTURAL_VFS_PATHS: string[] = ['/', '/net', '/net/pacs', '/net/pacs/queries', '/proc', '/proc/jobs'];

/**
 * Normalizes a logical path for VFS comparison by stripping a single trailing
 * slash (except for the root path).
 *
 * @param logicalPath - The resolved logical path.
 * @returns The normalized path.
 */
export function vfsPath_normalize(logicalPath: string): string {
  return logicalPath.endsWith('/') && logicalPath.length > 1 ? logicalPath.slice(0, -1) : logicalPath;
}

/**
 * Reports whether a path is a structural VFS container (always valid).
 *
 * @param cleanPath - The normalized path.
 * @returns True if the path is a known structural VFS container.
 */
export function vfsPath_isStructural(cleanPath: string): boolean {
  return STRUCTURAL_VFS_PATHS.includes(cleanPath);
}

/**
 * Verifies if a given FileBrowserFolder object exactly matches the validation path.
 *
 * @param folder - The FileBrowserFolder object to verify.
 * @param validationPath - The path to match against.
 * @returns True if the folder path exactly matches validationPath, false otherwise.
 */
export function folder_verifyPathMatch(folder: FileBrowserFolder | null | undefined, validationPath: string): boolean {
  if (!folder) {
    return false;
  }
  const folderPath: string = folder.data?.path || folder.path || '';

  // Normalize both by removing all leading and trailing slashes to be robust against API inconsistencies
  const cleanFolder: string = folderPath.replace(/^\/+|\/+$/g, '');
  const cleanValidation: string = validationPath.replace(/^\/+|\/+$/g, '');

  return cleanFolder === cleanValidation;
}

/**
 * The target of a CFS link at a path, from its parent's listing; null when
 * the path is not a link (or its parent cannot be listed).
 *
 * @param cleanPath - The normalized absolute path.
 * @returns The absolute target path, or null.
 */
async function cfsLink_target(cleanPath: string): Promise<string | null> {
  if (cleanPath === '/' || !cleanPath.startsWith('/')) return null;
  const { vfsDispatcher } = await import('@fnndsc/salsa');
  const parentResult: Result<VFSItem[]> = await vfsDispatcher.list(path.posix.dirname(cleanPath));
  if (!parentResult.ok) return null;
  const entryName: string = path.posix.basename(cleanPath);
  const entry: VFSItem | undefined = parentResult.value.find((item: VFSItem): boolean => item.name === entryName);
  return entry?.type === 'link' && entry.target ? entry.target : null;
}

/**
 * Builds the success envelope for a completed directory change.
 *
 * @param newCwd - The working directory that is now current.
 * @param rendered - Any stdout text (debug traces) produced along the way.
 * @returns An ok envelope carrying the fs.cwd model.
 */
function cdSuccess_envelope(newCwd: string, rendered: string): CommandEnvelope {
  return envelope_ok(rendered, { kind: 'fs.cwd', data: { path: newCwd } });
}

/**
 * Handles `cd` into a virtual (VFS) path: structural containers are accepted
 * directly, deeper VFS paths are validated and their listing cached.
 *
 * @param cleanPath - The normalized virtual path.
 * @param pathArg - The original user-supplied path (for error messages).
 * @returns The command envelope for the attempt.
 */
async function cdVirtual_handle(cleanPath: string, pathArg: string): Promise<CommandEnvelope> {
  if (vfsPath_isStructural(cleanPath)) {
    await session.directory_change(cleanPath);
    return cdSuccess_envelope(cleanPath, '');
  }

  // Resolve the target from its parent listing before asking the target provider
  // to list its children. Some providers deliberately return a containing-node
  // listing for virtual files such as /proc/.../status; a successful list alone
  // therefore does not establish that `cleanPath` is navigable.
  const { vfsDispatcher } = await import('@fnndsc/salsa');
  const parentPath: string = path.posix.dirname(cleanPath);
  const entryName: string = path.posix.basename(cleanPath);
  const parentResult: Result<VFSItem[]> = await vfsDispatcher.list(parentPath);
  const entry: VFSItem | undefined = parentResult.ok
    ? parentResult.value.find((item: VFSItem) => item.name === entryName)
    : undefined;
  if (entry?.type === 'link') {
    let target: string | undefined = entry.target;
    if (!target) {
      const linkResult: Result<string> = await vfsDispatcher.linkTarget_resolve(cleanPath);
      if (linkResult.ok) target = linkResult.value;
    }
    if (!target) {
      return envelope_error('', undefined, `${chalk.red(`cd: ${pathArg}: No such file or directory`)}\n`);
    }
    return cdReal_handle(target, pathArg);
  }
  if (entry && !['dir', 'job', 'vfs'].includes(entry.type)) {
    return envelope_error('', undefined, `${chalk.red(`cd: ${pathArg}: Not a directory`)}\n`);
  }

  // A directory-like VFS entry still asks its provider to enumerate children,
  // both as final validation and to prime a subsequent `ls`.
  const listResult: Result<VFSItem[]> = await vfsDispatcher.list(cleanPath);
  if (!listResult.ok) {
    const { errorStack } = await import('@fnndsc/cumin');
    const lastError: StackMessage | undefined = errorStack.stack_pop();
    const detail: string = lastError ? error_stripDebugPrefix(lastError.message) : 'No such file or directory';
    return envelope_error('', undefined, `${chalk.red(`cd: ${pathArg}: ${detail}`)}\n`);
  }

  const { listCache_get } = await import('@fnndsc/cumin');
  listCache_get().cache_set(cleanPath, listResult.value);

  await session.directory_change(cleanPath);
  return cdSuccess_envelope(cleanPath, '');
}

/**
 * Handles `cd` into a real (API-backed) ChRIS folder: resolves the validation
 * path, then confirms the folder exists with an exact path match before setting
 * the working directory.
 *
 * @param logicalPath - The resolved logical path.
 * @param pathArg - The original user-supplied path (for error messages).
 * @returns The command envelope for the attempt.
 */
async function cdReal_handle(logicalPath: string, pathArg: string): Promise<CommandEnvelope> {
  const client: Client | null = await session.connection.client_get();
  if (!client) {
    return envelope_error('', undefined, `${chalk.red('Not connected to ChRIS.')}\n`);
  }

  const debugEnabled: boolean = session.connection.config?.debug === true;
  let rendered: string = '';

  let validationPath: string;
  if (session.physicalMode_get()) {
    validationPath = await path_resolveLinks(logicalPath);
  } else {
    const { logical_toPhysical } = await import('@fnndsc/chili/utils');
    const physicalResult: Result<string> = await logical_toPhysical(logicalPath);
    if (!physicalResult.ok) {
      let renderedErr: string = `${chalk.red(`cd: ${pathArg}: No such file or directory`)}\n`;
      if (debugEnabled) {
        renderedErr += `${chalk.gray(`  Logical path: ${logicalPath}`)}\n`;
      }
      return envelope_error('', undefined, renderedErr);
    }
    validationPath = physicalResult.value;
  }

  if (debugEnabled) {
    rendered += `${chalk.gray(`cd: ${pathArg} → logical: ${logicalPath} → validation: ${validationPath}`)}\n`;
  }

  const cwdPath: string = session.physicalMode_get() ? validationPath : logicalPath;
  const currentCwd: string = await session.getCWD();

  if (currentCwd === cwdPath) {
    if (debugEnabled) {
      rendered += `${chalk.gray(`  Already in target directory, skipping validation`)}\n`;
    }
    return cdSuccess_envelope(cwdPath, rendered);
  }

  try {
    const folder: FileBrowserFolder | null | undefined = (await client.getFileBrowserFolderByPath(validationPath)) as FileBrowserFolder | null | undefined;
    if (folder_verifyPathMatch(folder, validationPath)) {
      await session.directory_change(cwdPath);
      return cdSuccess_envelope(cwdPath, rendered);
    }
    let renderedErr: string = `${chalk.red(`cd: ${pathArg}: No such file or directory`)}\n`;
    if (debugEnabled) {
      if (!folder) {
        renderedErr += `${chalk.gray(`  API returned null for path: ${validationPath}`)}\n`;
      } else {
        const folderPath: string | undefined = folder.data?.path || folder.path;
        renderedErr += `${chalk.gray(`  API returned mismatched folder path: ${folderPath} (expected: ${validationPath})`)}\n`;
      }
    }
    const envelope: CommandEnvelope = envelope_error(rendered, undefined, renderedErr);
    return envelope;
  } catch (apiError: unknown) {
    let renderedErr: string = `${chalk.red(`cd: ${pathArg}: No such file or directory`)}\n`;
    if (debugEnabled) {
      const msg: string = apiError instanceof Error ? apiError.message : String(apiError);
      renderedErr += `${chalk.gray(`  API error: ${msg}`)}\n`;
    }
    return envelope_error(rendered, undefined, renderedErr);
  }
}

/**
 * Changes the current working directory in the ChRIS filesystem context.
 * Validates the existence of the target path before setting it.
 *
 * @param args - An array containing the target path as the first element.
 * @returns An envelope carrying the new working directory on success.
 */
export async function builtin_cd(args: string[]): Promise<CommandEnvelope> {
  return cd_run({ path: args.length > 0 ? args.join(' ') : undefined });
}

/** Typed invocation options for cd. */
export interface CdOptions {
  /** Target directory; omitted means home, '-' means the previous cwd. */
  path?: string;
}

/**
 * Changes the working directory: the shared typed core behind the parsed
 * builtin and the typed API.
 *
 * @param options - The target directory.
 * @returns An envelope carrying the fs.cwd model on success.
 */
export async function cd_run(options: CdOptions): Promise<CommandEnvelope> {
  const pathArg: string | undefined = options.path;

  // 'cd' with no args goes to home
  if (!pathArg) {
    return builtin_cd(['~']);
  }

  if (pathArg === '-') {
    const previousCWD: string | undefined = session.previousCWD_get();
    if (!previousCWD) {
      return envelope_error('', undefined, `${chalk.red('cd: OLDPWD not set')}\n`);
    }
    const result: CommandEnvelope = await builtin_cd([previousCWD]);
    return result.status === 'ok'
      ? { ...result, rendered: `${previousCWD}\n${result.rendered}` }
      : result;
  }

  try {
    const logicalPath: string = await path_resolve(pathArg);

    const { vfsDispatcher } = await import('@fnndsc/salsa');
    const cleanPath: string = vfsPath_normalize(logicalPath);
    // Treat the path as virtual if it is, or is a parent of, any registered
    // provider prefix (e.g. /proc is parent of /proc/jobs).
    const isParentOfVfs: boolean = vfsDispatcher.providers_get().some(
      (p: { prefix: string }) => p.prefix.startsWith(cleanPath + '/')
    );
    const isVirtual: boolean =
      cleanPath === '/' ||
      cleanPath === '/net' ||
      isParentOfVfs ||
      vfsDispatcher.provider_get(cleanPath).prefix !== '';

    if (isVirtual) {
      return cdVirtual_handle(cleanPath, pathArg);
    }

    // A CFS link names a place: entering it moves to its target. The link's
    // own path is not a folder CUBE would validate, so it must be followed
    // here, and a refusal names the target the link points at.
    const linkTarget: string | null = await cfsLink_target(cleanPath);
    if (linkTarget !== null) {
      const followed: CommandEnvelope = await cdReal_handle(linkTarget, pathArg);
      if (followed.status === 'ok') return followed;
      return envelope_error('', undefined, `${chalk.red(`cd: ${pathArg}: link target ${linkTarget}: No such file or directory`)}\n`);
    }

    return cdReal_handle(logicalPath, pathArg);
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    return envelope_error('', undefined, `${chalk.red(`Failed to cd: ${msg}`)}\n`);
  }
}
