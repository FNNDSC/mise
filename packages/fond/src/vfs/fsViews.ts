/**
 * @file What the file tools say when they are done: a folder made, a file
 * written, a copy or a move, an entry removed.
 *
 * @module
 */
import chalk from 'chalk';

/**
 * Renders the result of a mkdir operation.
 * @param path - The path created.
 * @param success - Whether the operation succeeded.
 */
export function mkdir_render(path: string, success: boolean): string {
  if (success) {
    return chalk.green(`Created directory: ${path}`);
  } else {
    return chalk.red(`Failed to create directory: ${path}`);
  }
}

/**
 * Renders the result of a touch operation.
 * @param path - The path created.
 * @param success - Whether the operation succeeded.
 * @param wrote - Whether content was written, rather than an empty file made.
 */
export function touch_render(path: string, success: boolean, wrote: boolean = false): string {
  if (success) {
    // A touch that carried content WROTE the file, and may have replaced one
    // that was already there: reporting "Created" for a rewrite told the
    // operator a file was new when their old content had just been replaced.
    return chalk.green(`${wrote ? 'Wrote' : 'Created'} file: ${path}`);
  } else {
    return chalk.red(`Failed to ${wrote ? 'write' : 'create'} file: ${path}`);
  }
}

/**
 * Renders the result of a copy operation.
 * @param src - Source path.
 * @param dest - Destination path.
 * @param success - Whether the operation succeeded.
 */
export function cp_render(src: string, dest: string, success: boolean): string {
  if (success) {
    return chalk.green(`Copied ${src} to ${dest}`);
  } else {
    return chalk.red(`Failed to copy ${src} to ${dest}`);
  }
}

/**
 * Renders the result of a move operation.
 * @param src - Source path.
 * @param dest - Destination path.
 * @param success - Whether the operation succeeded.
 */
export function mv_render(src: string, dest: string, success: boolean): string {
  if (success) {
    return chalk.green(`Moved ${src} to ${dest}`);
  } else {
    return chalk.red(`Failed to move ${src} to ${dest}`);
  }
}

/**
 * Renders the outcome of an rm operation for terminal display.
 *
 * @param result - The rm result.
 * @returns Formatted status string.
 */
export function rm_render(result: { success: boolean; path: string; type: 'file' | 'dir' | 'link' | null; error?: string }): string {
  if (result.success) {
    const typeStr: string = result.type || 'item';
    return chalk.green(`Removed ${typeStr}: ${result.path}`);
  } else {
    return chalk.red(result.error || `Failed to remove: ${result.path}`);
  }
}
