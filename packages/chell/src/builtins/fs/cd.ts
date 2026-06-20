/**
 * @file Builtin cd command.
 * Changes the current working directory.
 */
import chalk from 'chalk';
import { session } from '../../session/index.js';
import { path_resolve, path_resolveLinks, error_stripDebugPrefix } from '../utils.js';
import type { Result, StackMessage, Client } from '@fnndsc/cumin';
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
 * Handles `cd` into a virtual (VFS) path: structural containers are accepted
 * directly, deeper VFS paths are validated and their listing cached.
 *
 * @param cleanPath - The normalized virtual path.
 * @param pathArg - The original user-supplied path (for error messages).
 */
async function cdVirtual_handle(cleanPath: string, pathArg: string): Promise<void> {
  if (vfsPath_isStructural(cleanPath)) {
    await session.setCWD(cleanPath);
    return;
  }

  // For deeper VFS paths (e.g. /net/pacs/queries/<id>), validate and cache the
  // result so a subsequent `ls` doesn't need to re-fetch.
  const { vfsDispatcher } = await import('@fnndsc/salsa');
  const listResult: Result<VFSItem[]> = await vfsDispatcher.list(cleanPath);
  if (!listResult.ok) {
    const { errorStack } = await import('@fnndsc/cumin');
    const lastError: StackMessage | undefined = errorStack.stack_pop();
    const detail: string = lastError ? error_stripDebugPrefix(lastError.message) : 'No such file or directory';
    console.error(chalk.red(`cd: ${pathArg}: ${detail}`));
    return;
  }

  const { listCache_get } = await import('@fnndsc/cumin');
  listCache_get().cache_set(cleanPath, listResult.value);

  await session.setCWD(cleanPath);
}

/**
 * Handles `cd` into a real (API-backed) ChRIS folder: resolves the validation
 * path, then confirms the folder exists with an exact path match before setting
 * the working directory.
 *
 * @param logicalPath - The resolved logical path.
 * @param pathArg - The original user-supplied path (for error messages).
 */
async function cdReal_handle(logicalPath: string, pathArg: string): Promise<void> {
  const client: Client | null = await session.connection.client_get();
  if (!client) {
    console.error(chalk.red('Not connected to ChRIS.'));
    return;
  }

  let validationPath: string;
  if (session.physicalMode_get()) {
    validationPath = await path_resolveLinks(logicalPath);
  } else {
    const { logical_toPhysical } = await import('@fnndsc/chili/utils');
    const physicalResult: Result<string> = await logical_toPhysical(logicalPath);
    if (!physicalResult.ok) {
      console.error(chalk.red(`cd: ${pathArg}: No such file or directory`));
      if (session.connection.config?.debug) {
        console.error(chalk.gray(`  Logical path: ${logicalPath}`));
      }
      return;
    }
    validationPath = physicalResult.value;
  }

  if (session.connection.config?.debug) {
    console.log(chalk.gray(`cd: ${pathArg} → logical: ${logicalPath} → validation: ${validationPath}`));
  }

  const cwdPath: string = session.physicalMode_get() ? validationPath : logicalPath;
  const currentCwd: string = await session.getCWD();

  if (currentCwd === cwdPath) {
    if (session.connection.config?.debug) {
      console.log(chalk.gray(`  Already in target directory, skipping validation`));
    }
    return;
  }

  try {
    const folder: FileBrowserFolder | null | undefined = (await client.getFileBrowserFolderByPath(validationPath)) as FileBrowserFolder | null | undefined;
    if (folder_verifyPathMatch(folder, validationPath)) {
      await session.setCWD(cwdPath);
    } else {
      console.error(chalk.red(`cd: ${pathArg}: No such file or directory`));
      if (session.connection.config?.debug) {
        if (!folder) {
          console.error(chalk.gray(`  API returned null for path: ${validationPath}`));
        } else {
          const folderPath: string | undefined = folder.data?.path || folder.path;
          console.error(chalk.gray(`  API returned mismatched folder path: ${folderPath} (expected: ${validationPath})`));
        }
      }
    }
  } catch (apiError: unknown) {
    console.error(chalk.red(`cd: ${pathArg}: No such file or directory`));
    if (session.connection.config?.debug) {
      const msg: string = apiError instanceof Error ? apiError.message : String(apiError);
      console.error(chalk.gray(`  API error: ${msg}`));
    }
  }
}

/**
 * Changes the current working directory in the ChRIS filesystem context.
 * Validates the existence of the target path before setting it.
 *
 * @param args - An array containing the target path as the first element.
 * @returns A Promise that resolves when the operation is complete.
 */
export async function builtin_cd(args: string[]): Promise<void> {
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
      await cdVirtual_handle(cleanPath, pathArg);
      return;
    }

    await cdReal_handle(logicalPath, pathArg);
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Failed to cd: ${msg}`));
  }
}
