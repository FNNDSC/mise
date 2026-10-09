/**
 * @file Builtin tree command.
 * Displays directory structure.
 */
import chalk from 'chalk';
import { ParsedArgs, commandArgs_process, optionsUnknown_refusal, path_resolve, error_stripDebugPrefix } from '../utils.js';
import { vfs } from '../../lib/vfs/vfs.js';
import { session } from '../../session/index.js';
import { spinner } from '../../lib/spinner.js';
import { scan_do, archyTree_create, type CLIscan, type ScanRecord } from '@fnndsc/chili/path/pathCommand.js';
import { bytes_format } from '@fnndsc/chili/commands/fs/upload.js';
import { errorStack } from '@fnndsc/fond';
import { CommandEnvelope, envelope_ok, envelope_error, type ListingItem } from '@fnndsc/menu';
import type { Result } from '@fnndsc/fond';

/** The options tree reads; any other is refused by name. */
const TREE_OPTIONS: readonly string[] = ['follow', 'path', 'dirs', 'dirpath'];

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
  const parsed: ParsedArgs = commandArgs_process(args, {
    booleanLongOptions: TREE_OPTIONS,
  });
  // An option tree does not have is refused, not skipped: `tree -L 1 x`
  // once scanned a folder named `1`, and `tree --bogus x` the whole home.
  const unknown: string | null = optionsUnknown_refusal('tree', parsed, TREE_OPTIONS);
  if (unknown !== null) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(unknown)}\n`);
  }
  const pathArgs: string[] = parsed._ as string[];
  const dirpathMode: boolean = !!parsed['dirpath'];
  const pathMode: boolean = !!parsed['path'] || dirpathMode;
  const dirsOnly: boolean = !!parsed['dirs'] || dirpathMode;

  // Determine target path
  let targetPath: string | undefined;
  if (pathArgs.length > 0) {
    targetPath = await path_resolve(pathArgs[0]);
    // A path that is not there is said to be not there, as tree says it,
    // rather than scanned into an empty tree.
    const entry: Result<ListingItem[]> = await vfs.data_get(targetPath, { directory: true });
    if (!entry.ok) {
      errorStack.stack_pop();
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`tree: ${pathArgs[0]}: No such file or directory`)}\n`);
    }
  }

  // Build scan options
  const scanOptions: CLIscan = {
    silent: true,
    tree: false,  // We'll format it ourselves
    follow: !!parsed['follow'],
    dirsOnly,
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
    } else if (scanResult.fileInfo.length === 0) {
      // An empty folder is its own tree: its name, and nothing under it.
      rendered += `${targetPath ?? originalFolder}\n`;
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
