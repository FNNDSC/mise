/**
 * @file Resolve an absolute ChRIS file path to its numeric file id.
 *
 * @module
 */
import * as path from 'path';
import {
  ChRISEmbeddedResourceGroup,
  ChrisPathNode,
  FilteredResourceData,
  Result,
  Ok,
  Err,
  errorStack,
} from '@fnndsc/cumin';
import { files_getGroup } from './index.js';

/** Minimal shape of a file row needed to resolve an id. */
interface FileRow {
  id?: number;
  fname?: string;
}

/**
 * Resolves an absolute ChRIS file path to its numeric file id.
 *
 * Lists the parent directory and matches on basename, tolerating the `? <name>`
 * placeholder form the API sometimes returns.
 *
 * @param filePath - Absolute ChRIS file path.
 * @returns Ok(fileId), or Err (with a message pushed to errorStack) on failure.
 */
export async function fileId_atPath_resolve(filePath: string): Promise<Result<number>> {
  const dir: string = path.posix.dirname(filePath);
  const name: string = path.posix.basename(filePath);

  const group: ChRISEmbeddedResourceGroup<ChrisPathNode> | null = await files_getGroup('files', dir);
  if (!group) {
    return Err();
  }

  const results: FilteredResourceData | null = await group.asset.resources_getAll();
  if (!results || !results.tableData) {
    errorStack.stack_push('error', `No files found in directory: ${dir}`);
    return Err();
  }

  const file: FileRow | undefined = (results.tableData as FileRow[]).find((f: FileRow) => {
    const basename: string = path.posix.basename(f.fname || '');
    return basename === name || basename === `? ${name}`;
  });

  if (!file) {
    errorStack.stack_push('error', `File not found: ${name} in ${dir}`);
    return Err();
  }

  if (typeof file.id !== 'number') {
    errorStack.stack_push('error', `File has no valid ID: ${name}`);
    return Err();
  }

  return Ok(file.id);
}
