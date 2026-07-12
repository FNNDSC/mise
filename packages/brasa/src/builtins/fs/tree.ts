/**
 * @file Builtin tree command.
 * Displays directory structure.
 */
import chalk from 'chalk';
import { ParsedArgs, commandArgs_process, path_resolve, error_stripDebugPrefix } from '../utils.js';
import { session } from '../../session/index.js';
import { spinner } from '../../lib/spinner.js';
import { errorStack, CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
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
export async function builtin_tree(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const pathArgs: string[] = parsed._ as string[];
  const pathMode: boolean = !!parsed['path'];

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
    spinner.start(`Scanning ${targetPath || 'current directory'}...`);
    const scanResult: ScanRecord | null = await scan_do(scanOptions);

    if (!scanResult) {
      spinner.stop();
      const lastError = errorStack.stack_pop();
      process.exitCode = 1;
      const message: string = lastError ? error_stripDebugPrefix(lastError.message) : 'Failed to scan directory tree.';
      return envelope_error('', undefined, `${chalk.red(message)}\n`);
    }

    spinner.stop();

    let rendered: string = '';
    if (pathMode) {
      // --path: emit one full chrisPath per entry — grep-friendly
      for (const item of scanResult.fileInfo) {
        rendered += `${item.chrisPath}\n`;
      }
    } else {
      // Default: ASCII tree
      rendered += `${archyTree_create(scanResult.fileInfo)}\n`;
    }

    // Display summary
    rendered += `${chalk.green(`Total size: ${bytes_format(scanResult.totalSize)}`)}\n`;
    rendered += `${chalk.gray(`${scanResult.fileInfo.length} items`)}\n`;
    return envelope_ok(rendered);

  } finally {
    // Restore original path
    if (targetPath) {
      await session.setCWD(originalFolder);
    }
  }
}
