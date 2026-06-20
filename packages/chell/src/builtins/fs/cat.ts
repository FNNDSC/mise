/**
 * @file Builtin cat command.
 * Displays file contents.
 */
import chalk from 'chalk';
import { path_resolve, error_stripDebugPrefix } from '../utils.js';
import { files_cat as chefs_cat_cmd, files_catBinary as chefs_catBinary_cmd } from '@fnndsc/chili/commands/fs/cat.js';
import { cat_render } from '@fnndsc/chili/views/fs.js';
import { help_show } from '../help.js';
import { errorStack, Result, StackMessage } from '@fnndsc/cumin';
import * as path from 'path';

/** File extensions that receive syntax highlighting. */
const HIGHLIGHT_EXTENSIONS: Set<string> = new Set(['.json', '.yaml', '.yml']);

/**
 * Applies chalk-based syntax highlighting to JSON content.
 * Returns the original string if the content is not valid JSON.
 *
 * @param content - Raw JSON string.
 * @returns Highlighted string, or original on parse failure.
 */
function json_highlight(content: string): string {
  try {
    JSON.parse(content);
  } catch {
    return content;
  }
  return content.replace(
    /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match: string): string => {
      if (match.endsWith(':')) return chalk.cyan(match);           // key
      if (match.startsWith('"')) return chalk.green(match);        // string value
      if (match === 'true' || match === 'false') return chalk.yellow(match);
      if (match === 'null') return chalk.gray(match);
      return chalk.magenta(match);                                 // number
    }
  );
}

/**
 * Applies chalk-based syntax highlighting to YAML content line by line.
 *
 * @param content - Raw YAML string.
 * @returns Highlighted string.
 */
function yaml_highlight(content: string): string {
  return content.split('\n').map((line: string): string => {
    if (/^\s*#/.test(line)) return chalk.gray(line);
    const kv: RegExpMatchArray | null = line.match(/^(\s*)([\w./-]+)(\s*:\s*)(.*)/);
    if (kv) {
      const [, indent, key, sep, value]: string[] = kv as string[];
      const coloredValue: string = value_yamlColor(value);
      return `${indent}${chalk.cyan(key)}${chalk.gray(sep)}${coloredValue}`;
    }
    const listItem: RegExpMatchArray | null = line.match(/^(\s*-\s+)(.*)/);
    if (listItem) {
      return `${chalk.gray(listItem[1])}${chalk.green(listItem[2])}`;
    }
    return line;
  }).join('\n');
}

/**
 * Colors a scalar YAML value based on its type.
 *
 * @param value - The raw value string from a YAML key: value line.
 * @returns Chalk-colored value string.
 */
function value_yamlColor(value: string): string {
  if (!value) return value;
  if (value === 'true' || value === 'false') return chalk.yellow(value);
  if (value === 'null' || value === '~') return chalk.gray(value);
  if (/^-?\d+(\.\d+)?$/.test(value)) return chalk.magenta(value);
  if (/^["']/.test(value)) return chalk.green(value);
  return chalk.white(value);
}

/**
 * Applies syntax highlighting to text content based on file extension.
 * Returns the original string unchanged when stdout is not a TTY (piping).
 *
 * @param content - File content string.
 * @param filePath - Full path used to determine the file type.
 * @returns Highlighted or original content.
 */
function content_highlight(content: string, filePath: string): string {
  if (!process.stdout.isTTY) return content;
  const ext: string = path.extname(filePath).toLowerCase();
  if (ext === '.json') return json_highlight(content);
  if (ext === '.yaml' || ext === '.yml') return yaml_highlight(content);
  return content;
}

/**
 * List of file extensions that are considered binary.
 */
const BINARY_EXTENSIONS: Set<string> = new Set([
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
 * Writes a buffer to stdout with proper backpressure handling.
 *
 * Splits large buffers into 64KB chunks and waits for drain events when the
 * output buffer is full. This prevents data loss when piping large binary files
 * to external commands. Waits for all data to be flushed before resolving.
 *
 * @param buffer - The buffer to write to stdout.
 * @returns A Promise that resolves when all data has been written and flushed.
 *
 * @example
 * ```typescript
 * const dicomData: Buffer = await fetchDicomFile();
 * await buffer_writeToStdout(dicomData);
 * ```
 */
async function buffer_writeToStdout(buffer: Buffer): Promise<void> {
  return new Promise<void>((resolve: (value: void) => void, reject: (reason: Error) => void) => {
    if (buffer.length === 0) {
      resolve();
      return;
    }

    let offset: number = 0;
    const chunkSize: number = 64 * 1024; // 64KB chunks

    /**
     * Recursively writes the next chunk of data to stdout.
     * Handles backpressure by waiting for drain events when buffer is full.
     */
    const chunk_writeNext = (): void => {
      try {
        while (offset < buffer.length) {
          const end: number = Math.min(offset + chunkSize, buffer.length);
          const chunk: Buffer = buffer.subarray(offset, end);
          offset = end;

          const canContinue: boolean = process.stdout.write(chunk);

          if (!canContinue) {
            // Buffer is full, wait for drain event
            process.stdout.once('drain', chunk_writeNext);
            return;
          }
        }

        // All chunks written - ensure stdout is flushed before resolving
        // Writing an empty string forces a flush check. If write() returns false,
        // the buffer is full and we must wait for drain. This prevents truncation
        // when piping to external processes, as Node.js won't exit until we resolve.
        if (process.stdout.write('')) {
          // Buffer has space, all data is flushed
          resolve();
        } else {
          // Buffer is full, wait for final drain before resolving
          process.stdout.once('drain', () => resolve());
        }
      } catch (err: unknown) {
        reject(err as Error);
      }
    };

    chunk_writeNext();
  });
}

/**
 * Displays the content of one or more files.
 *
 * Supports multiple files and concatenates their output. Binary mode is applied
 * consistently to all files if any file is detected as binary or --binary is specified.
 *
 * @param args - Command line arguments (file paths and optional --binary flag).
 *
 * @example
 * ```typescript
 * await builtin_cat(['file1.txt', 'file2.txt']);
 * await builtin_cat(['--binary', 'image.dcm']);
 * await builtin_cat(['*.json']);  // After wildcard expansion
 * ```
 */
export async function builtin_cat(args: string[]): Promise<void> {
  let binaryMode: boolean = false;
  const filePaths: string[] = [];

  for (const arg of args) {
    if (arg === '--binary') {
      binaryMode = true;
    } else {
      filePaths.push(arg);
    }
  }

  if (filePaths.length === 0) {
     console.error(chalk.red('Usage: cat [--binary] <file> [file...]'));
     return;
  }

  for (let i: number = 0; i < filePaths.length; i++) {
    const pathArg: string = filePaths[i];
    const target: string = await path_resolve(pathArg);

    // Auto-detect binary files
    const isBinaryFile: boolean = extension_isBinary(target);

    // Inform user about auto-detection only if in interactive mode (stdout is TTY)
    // Don't show warning when piping, as it would corrupt the binary output
    // Only show on first file to avoid spam
    if (i === 0 && isBinaryFile && !binaryMode && process.stdout.isTTY) {
       console.error(chalk.cyan(`Info: ${pathArg} detected as binary file (${path.extname(target)}), using binary mode.`));
       console.error(chalk.cyan('Tip: Use "cat --binary <file>" to explicitly request binary mode.'));
       console.error('');
    }

    // Use binary mode if requested OR if file is detected as binary
    if (binaryMode || isBinaryFile) {
       const result: Result<Buffer> = await chefs_catBinary_cmd(target);

       if (!result.ok) {
          const error: StackMessage | undefined = errorStack.stack_pop();
          console.error(chalk.red(`cat: ${pathArg}: ${error ? error_stripDebugPrefix(error.message) : 'Unknown error'}`));
          process.exitCode = 1;
          continue;
       }

       // Output raw buffer to stdout with backpressure handling
       await buffer_writeToStdout(result.value);
    } else {
       const result: Result<string> = await chefs_cat_cmd(target);

       if (!result.ok) {
          const error: StackMessage | undefined = errorStack.stack_pop();
          console.error(chalk.red(`cat: ${pathArg}: ${error ? error_stripDebugPrefix(error.message) : 'Unknown error'}`));
          process.exitCode = 1;
          continue;
       }

       const highlighted: string = content_highlight(result.value, target);
       console.log(cat_render(highlighted, pathArg));
    }
  }
}
