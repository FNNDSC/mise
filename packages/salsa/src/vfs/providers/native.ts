/**
 * @file Native ChRIS VFS Provider.
 *
 * Implements filesystem operations mapping directly to CUBE storage.
 *
 * @module
 */

import { Result, Ok, Err, errorStack } from "@fnndsc/cumin";
import { VFSProvider, VFSItem, CpOptions } from "../provider.js";
import {
  files_copy,
  files_copyRecursively,
  files_listAll,
} from "../../files/index.js";
import path from "path";

/**
 * Shape of raw file browser items returned by the ChRIS API.
 */
interface ChrisFileOrDirRaw {
  path?: string;
  fname?: string;
  fsize?: number;
  owner_username?: string;
  creation_date?: string;
}

/**
 * Standard sort utility for VFS items.
 *
 * @param items - Items list to sort.
 * @param sortField - Field to sort by.
 * @param reverse - Whether to reverse sort order.
 * @returns Sorted array.
 */
function vfs_sortItems(
  items: VFSItem[],
  sortField?: "name" | "size" | "date" | "owner",
  reverse?: boolean
): VFSItem[] {
  const field: keyof VFSItem = sortField || "name";
  const sorted = [...items].sort((a: VFSItem, b: VFSItem) => {
    const valA = a[field];
    const valB = b[field];
    if (typeof valA === "string" && typeof valB === "string") {
      return valA.localeCompare(valB);
    }
    if (typeof valA === "number" && typeof valB === "number") {
      return valA - valB;
    }
    return 0;
  });
  if (reverse) {
    sorted.reverse();
  }
  return sorted;
}

/**
 * Native ChRIS filesystem provider operating on absolute CUBE folders.
 */
export class NativeVfsProvider implements VFSProvider {
  /** Prefix matches everything. */
  prefix = "";

  /**
   * Lists native ChRIS folder contents (dirs, files, links).
   *
   * @param pathStr - Absolute directory path.
   * @param options - Sorting parameters.
   */
  async list(
    pathStr: string,
    options?: { sort?: "name" | "size" | "date" | "owner"; reverse?: boolean }
  ): Promise<Result<VFSItem[]>> {
    try {
      const fetchOpts = { limit: 1000, offset: 0 };
      const resolvedPath = pathStr || "/";

      // Parallelize files/dirs/links API requests
      const results = await Promise.allSettled([
        files_listAll(fetchOpts, "dirs", resolvedPath),
        files_listAll(fetchOpts, "files", resolvedPath),
        files_listAll(fetchOpts, "links", resolvedPath),
      ]);

      const [dirsResult, filesResult, linksResult] = results;
      const items: VFSItem[] = [];

      const mapToItem = (
        raw: ChrisFileOrDirRaw,
        type: "dir" | "file" | "link" | "vfs"
      ): VFSItem => {
        let name = raw.fname || raw.path || "";
        if (name.includes("/")) {
          name = name.split("/").pop() || name;
        }
        if (type === "link" && name.endsWith(".chrislink")) {
          name = name.slice(0, -10);
        }
        const targetPath = raw.path
          ? raw.path.startsWith("/")
            ? raw.path
            : "/" + raw.path
          : undefined;

        return {
          name,
          type,
          size: raw.fsize || 0,
          owner: raw.owner_username || "unknown",
          date: raw.creation_date || "",
          target: targetPath,
        };
      };

      if (dirsResult.status === "fulfilled" && dirsResult.value?.tableData) {
        dirsResult.value.tableData.forEach((d: unknown) =>
          items.push(mapToItem(d as ChrisFileOrDirRaw, "dir"))
        );
      }

      if (filesResult.status === "fulfilled" && filesResult.value?.tableData) {
        filesResult.value.tableData.forEach((f: unknown) =>
          items.push(mapToItem(f as ChrisFileOrDirRaw, "file"))
        );
      }

      if (linksResult.status === "fulfilled" && linksResult.value?.tableData) {
        linksResult.value.tableData.forEach((l: unknown) =>
          items.push(mapToItem(l as ChrisFileOrDirRaw, "link"))
        );
      }

      const sorted = vfs_sortItems(items, options?.sort, options?.reverse);
      return Ok(sorted);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `Native VFS list failed: ${msg}`);
      return Err();
    }
  }

  /**
   * Copies native files or folders using Salsa's files_copy algorithms.
   *
   * @param src - Source absolute path.
   * @param dest - Destination absolute path.
   * @param options - Copy options.
   */
  async cp(src: string, dest: string, options: CpOptions): Promise<boolean> {
    try {
      const srcIsDir = await path_checkIsDir(src);
      if (srcIsDir && !options.recursive) {
        errorStack.stack_push(
          "error",
          `Source is a directory. Re-run with --recursive to copy: ${src}`
        );
        return false;
      }

      const destIsDir = await path_checkIsDir(dest);
      const destLooksDir = dest.endsWith("/");
      const finalDest = (destIsDir || destLooksDir)
        ? path.posix.join(dest, path.posix.basename(src))
        : dest;

      if (options.recursive) {
        return await files_copyRecursively(src, finalDest);
      } else {
        return await files_copy(src, finalDest);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `Native VFS copy failed: ${msg}`);
      return false;
    }
  }
}

/**
 * Determines whether a given ChRIS path refers to a directory.
 *
 * @param targetPath - The absolute ChRIS path to check.
 * @returns Promise<boolean> indicating directory existence.
 */
async function path_checkIsDir(targetPath: string): Promise<boolean> {
  const parent: string = path.posix.dirname(targetPath);
  const name: string = path.posix.basename(targetPath);
  try {
    const results = await files_listAll({ limit: 1000, offset: 0 }, "dirs", parent);
    if (!results || !results.tableData) {
      return false;
    }
    return results.tableData.some((entry: Record<string, unknown>) => {
      const candidate: string =
        typeof entry.path === "string" && entry.path.length > 0
          ? entry.path
          : typeof entry.fname === "string"
            ? entry.fname
            : "";
      return candidate === targetPath || path.posix.basename(candidate) === name;
    });
  } catch {
    return false;
  }
}

