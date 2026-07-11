/**
 * @file Builtin cd command.
 * Changes the current working directory, reported as a command envelope.
 */
import chalk from 'chalk';
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
    await session.setCWD(cleanPath);
    return cdSuccess_envelope(cleanPath, '');
  }

  // For deeper VFS paths (e.g. /net/pacs/queries/<id>), validate and cache the
  // result so a subsequent `ls` doesn't need to re-fetch.
  const { vfsDispatcher } = await import('@fnndsc/salsa');
  const listResult: Result<VFSItem[]> = await vfsDispatcher.list(cleanPath);
  if (!listResult.ok) {
    const { errorStack } = await import('@fnndsc/cumin');
    const lastError: StackMessage | undefined = errorStack.stack_pop();
    const detail: string = lastError ? error_stripDebugPrefix(lastError.message) : 'No such file or directory';
    return envelope_error('', undefined, `${chalk.red(`cd: ${pathArg}: ${detail}`)}\n`);
  }

  const { listCache_get } = await import('@fnndsc/cumin');
  listCache_get().cache_set(cleanPath, listResult.value);

  await session.setCWD(cleanPath);
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
      await session.setCWD(cwdPath);
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
  const pathArg: string | undefined = args.length > 0 ? args.join(' ') : undefined;

  // 'cd' with no args goes to home
  if (!pathArg) {
    return builtin_cd(['~']);
  }

  try {
    const logicalPath: string = await path_resolve(pathArg);

    const { vfsDispatcher } = await import('@fnndsc/salsa');
    const cleanPath: string = vfsPath_normalize(logicalPath);
    // Treat the path as virtual if it is, or is a parent of, any registered
    // provider prefix (e.g. /proc is parent of /proc/feeds).
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

    return cdReal_handle(logicalPath, pathArg);
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    return envelope_error('', undefined, `${chalk.red(`Failed to cd: ${msg}`)}\n`);
  }
}
