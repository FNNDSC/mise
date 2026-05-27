/**
 * @file Builtin cd command.
 * Changes the current working directory.
 */
import chalk from 'chalk';
import { session } from '../../session/index.js';
import { path_resolve, path_resolveLinks, error_stripDebugPrefix } from '../utils.js';

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
 * Verifies if a given FileBrowserFolder object exactly matches the validation path.
 *
 * @param folder - The FileBrowserFolder object to verify.
 * @param validationPath - The path to match against.
 * @returns True if the folder path exactly matches validationPath, false otherwise.
 */
function folder_verifyPathMatch(folder: FileBrowserFolder | null | undefined, validationPath: string): boolean {
  if (!folder) {
    return false;
  }
  const folderPath = folder.data?.path || folder.path;
  return folderPath === validationPath;
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
    // Reuse logic by pretending arg is '~'
    return builtin_cd(['~']);
  }

  try {
    const logicalPath: string = await path_resolve(pathArg);

    const { vfsDispatcher } = await import('@fnndsc/salsa');
    const cleanPath = logicalPath.endsWith('/') && logicalPath.length > 1 ? logicalPath.slice(0, -1) : logicalPath;
    const isVirtual =
      cleanPath === '/' ||
      cleanPath === '/net' ||
      vfsDispatcher.provider_get(cleanPath).prefix !== '';

    if (isVirtual) {
      // Validate the virtual path exists before cd'ing
      const listResult = await vfsDispatcher.list(cleanPath);
      if (!listResult.ok) {
        const { errorStack } = await import('@fnndsc/cumin');
        const lastError = errorStack.stack_pop();
        const detail = lastError ? error_stripDebugPrefix(lastError.message) : 'No such file or directory';
        console.error(chalk.red(`cd: ${pathArg}: ${detail}`));
        return;
      }
      await session.setCWD(cleanPath);
      return;
    }

    const client = await session.connection.client_get();
    if (!client) {
      console.error(chalk.red('Not connected to ChRIS.'));
      return;
    }

    // Determine path for validation
    let validationPath: string;

    if (session.physicalMode_get()) {
      // Physical mode: resolve links but don't use PathMapper
      validationPath = await path_resolveLinks(logicalPath);
    } else {
      // Logical mode: resolve logical path to physical path for validation
      const { logical_toPhysical } = await import('@fnndsc/chili/utils');
      const physicalResult = await logical_toPhysical(logicalPath);

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

    // Determine the target CWD path
    const cwdPath: string = session.physicalMode_get() ? validationPath : logicalPath;
    const currentCwd: string = await session.getCWD();

    // Skip validation if we're already in the target directory
    if (currentCwd === cwdPath) {
      if (session.connection.config?.debug) {
        console.log(chalk.gray(`  Already in target directory, skipping validation`));
      }
      // Already there, nothing to do
      return;
    }

    try {
      // Validate that the target exists and matches the exact path queried (preventing partial API matches)
      const folder = (await client.getFileBrowserFolderByPath(validationPath)) as FileBrowserFolder | null | undefined;
      if (folder_verifyPathMatch(folder, validationPath)) {
        await session.setCWD(cwdPath);
      } else {
        console.error(chalk.red(`cd: ${pathArg}: No such file or directory`));
        if (session.connection.config?.debug) {
          if (!folder) {
            console.error(chalk.gray(`  API returned null for path: ${validationPath}`));
          } else {
            const folderPath = folder.data?.path || folder.path;
            console.error(chalk.gray(`  API returned mismatched folder path: ${folderPath} (expected: ${validationPath})`));
          }
        }
      }
    } catch (apiError: unknown) {
      console.error(chalk.red(`cd: ${pathArg}: No such file or directory`));
      if (session.connection.config?.debug) {
        const msg = apiError instanceof Error ? apiError.message : String(apiError);
        console.error(chalk.gray(`  API error: ${msg}`));
      }
    }

  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Failed to cd: ${msg}`));
  }
}
