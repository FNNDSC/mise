/**
 * @file The virtual filesystem's contracts: a mount (provider), the items it
 * lists, and the options a copy takes.
 *
 * A session's filesystem is a tree of mounts. Each provider claims a path
 * prefix and answers for everything at or under it; whatever no provider
 * claims goes to the dispatcher's fallback (see `dispatcher.ts`).
 *
 * @module
 */

import { Result } from "../result.js";

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
  
  /** Title or description, when the item has one. */
  title?: string;

  /** Backing resource ID, when the virtual entry represents one. */
  id?: number;

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
  /** The path prefix this provider matches (e.g. '/net/pacs', '/bin'); empty for a fallback. */
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

  /**
   * Writes a file whole, when the provider holds writable files (a note).
   * Absent or false, the path is read-only.
   *
   * @param path - The absolute path of the file.
   * @param content - The new content, whole.
   * @returns True when it was written.
   */
  write?(path: string, content: string): Promise<boolean>;

  /**
   * Makes a folder, when the provider's folders are things a user makes (a
   * tag). Absent, the provider is read-only for mkdir.
   * @param path - The absolute path of the new folder.
   * @returns True when made; false with the reason stacked.
   */
  mkdir?(path: string): Promise<boolean>;

  /**
   * Removes an empty folder (`rmdir`).
   * @param path - The absolute path of the folder.
   * @returns True when removed; false with the reason stacked.
   */
  rmdir?(path: string): Promise<boolean>;

  /**
   * Renames an entry within this provider (`mv`).
   * @param src - The absolute path now.
   * @param dest - The absolute path it takes.
   * @returns True when renamed; false with the reason stacked.
   */
  rename?(src: string, dest: string): Promise<boolean>;

  /**
   * Resolves the target of a provider-defined lazy link when an operation
   * actually follows it.
   *
   * Listings must not use this hook: providers may expose an unresolved link
   * as structural metadata without paying for its target until navigation.
   *
   * @param path - Absolute virtual path naming the link.
   * @returns The target path, or an error when the provider cannot resolve it.
   */
  linkTarget_resolve?(path: string): Promise<Result<string>>;
}
