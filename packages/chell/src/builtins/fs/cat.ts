/**
 * @file Builtin cat command.
 * Displays file contents.
 */
import chalk from 'chalk';
import { path_resolve } from '../utils.js';
import { files_cat as chefs_cat_cmd, files_catBinary as chefs_catBinary_cmd } from '@fnndsc/chili/commands/fs/cat.js';
import { cat_render } from '@fnndsc/chili/views/fs.js';
import { help_show } from '../help.js';
import { errorStack, Result, StackMessage } from '@fnndsc/cumin';
import * as path from 'path';

/**
 * List of file extensions that are considered binary.
 */
const BINARY_EXTENSIONS = new Set([
  '.dcm',   // DICOM medical images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',  // Images
  '.pdf',   // Documents
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',  // Archives
  '.exe', '.dll', '.so', '.dylib', '.bin',  // Executables/Libraries
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',  // Media
]);

/**
 * Checks if a file path has a binary extension.
 *
 * @param filePath - The file path to check.
 * @returns True if the file has a binary extension.
 */
function extension_isBinary(filePath: string): boolean {
  const ext: string = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Displays the content of a file.
 *
 * @param args - Command line arguments (file path and optional --binary flag).
 */
export async function builtin_cat(args: string[]): Promise<void> {
  // Parse arguments
  let binaryMode: boolean = false;
  let pathArg: string | undefined;

  for (const arg of args) {
    if (arg === '--binary') {
      binaryMode = true;
    } else if (!pathArg) {
      pathArg = arg;
    }
  }

  if (!pathArg) {
     console.error(chalk.red('Usage: cat [--binary] <file>'));
     return;
  }

  const target: string = await path_resolve(pathArg);

  if (target.startsWith('/bin/')) {
     console.error(chalk.red('Cannot cat plugins yet.'));
     return;
  }

  // Handle /usr/bin/<command> - show help text
  if (target.startsWith('/usr/bin/')) {
     const commandName: string = target.substring('/usr/bin/'.length);
     help_show(commandName);
     return;
  }

  // Auto-detect binary files
  const isBinaryFile: boolean = extension_isBinary(target);

  // Warn if binary file without --binary flag
  if (isBinaryFile && !binaryMode) {
     console.error(chalk.yellow(`Warning: ${pathArg} appears to be a binary file (${path.extname(target)}).`));
     console.error(chalk.yellow('Use "cat --binary <file>" to retrieve binary content.'));
     console.error(chalk.yellow('Proceeding with text mode may corrupt binary data.'));
     console.error('');
  }

  // Use binary mode if requested OR if file is detected as binary
  if (binaryMode || isBinaryFile) {
     const result: Result<Buffer> = await chefs_catBinary_cmd(target);

     if (!result.ok) {
        const error: StackMessage | undefined = errorStack.stack_pop();
        console.error(chalk.red(`cat: ${error?.message || 'Unknown error'}`));
        return;
     }

     // Output raw buffer to stdout
     process.stdout.write(result.value);
  } else {
     const result: Result<string> = await chefs_cat_cmd(target);

     if (!result.ok) {
        const error: StackMessage | undefined = errorStack.stack_pop();
        console.error(chalk.red(`cat: ${error?.message || 'Unknown error'}`));
        return;
     }

     console.log(cat_render(result.value, pathArg));
  }
}
