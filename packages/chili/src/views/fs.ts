/**
 * @file File System View components.
 *
 * Provides standard output formatting for file system operations
 * (mkdir, touch, cat, upload).
 *
 * @module
 */
import chalk from 'chalk';

// The file tools' own words live in fond, beside the listing views; chili's
// callers reach them here as before.
export { mkdir_render, touch_render, cp_render, mv_render, rm_render } from '@fnndsc/fond';

/**
 * Renders the result of an upload operation.
 * @param local - Local path.
 * @param remote - Remote path.
 * @param success - Whether the operation succeeded.
 */
export function upload_render(local: string, remote: string, success: boolean): string {
  if (success) {
    return chalk.green(`Successfully uploaded ${local}`);
  } else {
    return chalk.red(`Failed to upload ${local}`);
  }
}

/**
 * Renders the content of a file or an error message.
 * @param content - The file content or null if not found/error.
 * @param path - The file path (for error message).
 */
export function cat_render(content: string | null, path: string): string {
  if (content !== null) {
    return content;
  } else {
    return chalk.red(`File not found or empty: ${path}`);
  }
}

