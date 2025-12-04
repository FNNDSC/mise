/**
 * @file Builtin cd command.
 * Changes the current working directory.
 */
import chalk from 'chalk';
import { session } from '../../session/index.js';
import { path_resolve, path_resolveLinks } from '../utils.js';

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

    // Handle virtual directories
    if (logicalPath === '/bin') {
      await session.setCWD('/bin');
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
        console.error(chalk.red(`cd: ${pathArg}: Invalid path`));
        return;
      }

      validationPath = physicalResult.value;
    }

    try {
      // Validate that the target exists
      const folder: unknown = await client.getFileBrowserFolderByPath(validationPath);
      if (folder) {
        // Set CWD based on mode:
        // - Logical mode: preserves *nix behavior where cd into a symlink keeps the logical path
        // - Physical mode: uses the resolved physical path (follows links)
        const cwdPath: string = session.physicalMode_get() ? validationPath : logicalPath;
        await session.setCWD(cwdPath);
      } else {
        console.error(chalk.red(`cd: ${pathArg}: No such file or directory`));
      }
    } catch (apiError: unknown) {
      console.error(chalk.red(`cd: ${pathArg}: No such file or directory`));
    }

  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Failed to cd: ${msg}`));
  }
}
