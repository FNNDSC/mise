/**
 * @file Builtin tree command.
 * Displays directory structure.
 */
import chalk from 'chalk';
import { ParsedArgs, commandArgs_process, path_resolve } from '../utils.js';
import { session } from '../../session/index.js';
import { errorStack } from '@fnndsc/cumin';
import { scan_do, archyTree_create, type CLIscan, type ScanRecord } from '@fnndsc/chili/path/pathCommand.js';
import { bytes_format } from '@fnndsc/chili/commands/fs/upload.js';

/**
 * Displays a directory tree of the ChRIS filesystem.
 * Uses chili's scan_do machinery for recursive filesystem traversal.
 *
 * @param args - Command line arguments (optional path and flags).
 * @returns A Promise that resolves when the tree is displayed.
 *
 * @example
 * ```
 * tree                    # Tree of current directory
 * tree /home/user/data    # Tree of specific path
 * tree --follow           # Follow symbolic links
 * ```
 */
export async function builtin_tree(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const pathArgs: string[] = parsed._ as string[];

  // Determine target path
  let targetPath: string | undefined;
  if (pathArgs.length > 0) {
    targetPath = await path_resolve(pathArgs[0]);
  }

  // Build scan options
  const scanOptions: CLIscan = {
    silent: true,
    tree: false,  // We'll format it ourselves
    follow: !!parsed['follow'],
    dirsOnly: false,
  };

  // If path specified, temporarily set context
  const originalFolder: string = await session.getCWD();
  if (targetPath) {
    await session.setCWD(targetPath);
  }

  try {
    const scanResult: ScanRecord | null = await scan_do(scanOptions);

    if (!scanResult) {
      const lastError = errorStack.stack_pop();
      if (lastError) {
        console.error(chalk.red(lastError.message));
      } else {
        console.error(chalk.red('Failed to scan directory tree.'));
      }
      return;
    }

    // Display the tree
    const treeOutput: string = archyTree_create(scanResult.fileInfo);
    console.log(treeOutput);

    // Display summary
    console.log(chalk.green(`Total size: ${bytes_format(scanResult.totalSize)}`));
    console.log(chalk.gray(`${scanResult.fileInfo.length} items`));

  } finally {
    // Restore original path
    if (targetPath) {
      await session.setCWD(originalFolder);
    }
  }
}
