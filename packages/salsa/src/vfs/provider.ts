/**
 * @file VFS Provider contracts and item interfaces.
 *
 * Defines the standard VFSItem, CpOptions, and VFSProvider interfaces
 * to support extensible virtual file systems.
 *
 * @module
 */

import { Result } from "@fnndsc/cumin";

/**
 * Standard interface representing a virtual file system item.
 */
export interface VFSItem {
  /** The display name of the item. */
  name: string;
  
  /** The type of the item. */
  type: "dir" | "file" | "link" | "plugin" | "pipeline" | "vfs" | "job";
  
  /** Size in bytes. */
  size: number;
  
  /** Username of the owner. */
  owner: string;
  
  /** Creation date (ISO string). */
  date: string;
  
  /** Target path (for links). */
  target?: string;
  
  /** Version string (for plugins). */
  version?: string;
  
  /** Title or description (for feeds, queries). */
  title?: string;

  /** Execution status (for job type items). */
  status?: string;
}

/**
 * Options for VFS copy operations.
 */
export interface CpOptions {
  /** Recursively copy subdirectories. */
  recursive?: boolean;
}

/**
 * Base contract that every Virtual File System Provider must implement.
 */
export interface VFSProvider {
  /** The path prefix this provider matches (e.g. '/pacs', '/bin', '/'). */
  prefix: string;

  /**
   * Lists the contents of a directory matching this provider.
   *
   * @param path - The absolute virtual directory path.
   * @param options - Optional sorting controls.
   * @returns A Promise resolving to a Result containing VFSItems.
   */
  list(
    path: string,
    options?: { sort?: "name" | "size" | "date" | "owner"; reverse?: boolean }
  ): Promise<Result<VFSItem[]>>;

  /**
   * Copies files or folders from/to paths under this provider.
   *
   * @param src - The absolute source path.
   * @param dest - The absolute destination path.
   * @param options - Copy flags like recursive.
   * @returns A Promise resolving to true on successful copy execution.
   */
  cp(src: string, dest: string, options: CpOptions): Promise<boolean>;

  /**
   * Reads the content of a virtual file under this provider as a string.
   *
   * @param path - The absolute virtual path of the file to read.
   * @returns A Promise resolving to a Result containing the file contents as a string.
   */
  read?(path: string): Promise<Result<string>>;

  /**
   * Reads the content of a virtual file under this provider as a binary Buffer.
   *
   * @param path - The absolute virtual path of the file to read.
   * @returns A Promise resolving to a Result containing the file contents as a Buffer.
   */
  readBinary?(path: string): Promise<Result<Buffer>>;
}

