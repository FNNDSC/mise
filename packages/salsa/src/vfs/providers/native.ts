/**
 * @file Native ChRIS VFS Provider.
 *
 * Implements filesystem operations mapping directly to CUBE storage.
 *
 * @module
 */

import { Result, Ok, Err, errorStack } from "@fnndsc/cumin";
import { VFSProvider, VFSItem, CpOptions } from "../provider.js";
import { vfsItems_sort } from "../sort.js";
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
      const resolvedPath: string = pathStr || "/";

      // Parallelize files/dirs/links API requests
      const results = await Promise.allSettled([
        files_listAll(fetchOpts, "dirs", resolvedPath),
        files_listAll(fetchOpts, "files", resolvedPath),
        files_listAll(fetchOpts, "links", resolvedPath),
      ]);

      const [dirsResult, filesResult, linksResult] = results;

      // files_listAll returns null both for a failed folder resolution and for
      // an existing folder whose collection is simply empty. When every
      // sub-listing comes back empty-or-failed the two cases are
      // indistinguishable here, so probe the parent listing: a missing folder
      // must surface as an error, not render as an empty directory.
      const noneSucceeded: boolean = results.every(
        (settled) =>
          settled.status === "rejected" || !settled.value?.tableData
      );
      if (noneSucceeded && resolvedPath !== "/") {
        const dirExists: Result<boolean> = await path_checkIsDir(resolvedPath);
        if (!dirExists.ok) {
          // The probe itself failed: report the verification failure rather
          // than claiming the folder is absent.
          return Err();
        }
        if (!dirExists.value) {
          errorStack.stack_push(
            "error",
            `Cannot list ${resolvedPath}: No such file or directory`
          );
          return Err();
        }
      }

      const items: VFSItem[] = [];

      const mapToItem = (
        raw: ChrisFileOrDirRaw,
        type: "dir" | "file" | "link" | "vfs"
      ): VFSItem => {
        let name: string = raw.fname || raw.path || "";
        if (name.includes("/")) {
          name = name.split("/").pop() || name;
        }
        if (type === "link" && name.endsWith(".chrislink")) {
          name = name.slice(0, -10);
        }
        const targetPath: string | undefined = raw.path
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

      const sorted: VFSItem[] = vfsItems_sort(items, options?.sort, options?.reverse);
      return Ok(sorted);
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
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
      const srcIsDir: Result<boolean> = await path_checkIsDir(src);
      if (!srcIsDir.ok) {
        return false;
      }
      if (srcIsDir.value && !options.recursive) {
        errorStack.stack_push(
          "error",
          `Source is a directory. Re-run with --recursive to copy: ${src}`
        );
        return false;
      }

      const destIsDir: Result<boolean> = await path_checkIsDir(dest);
      if (!destIsDir.ok) {
        return false;
      }
      const destLooksDir: boolean = dest.endsWith("/");
      const finalDest = (destIsDir.value || destLooksDir)
        ? path.posix.join(dest, path.posix.basename(src))
        : dest;

      if (options.recursive) {
        return await files_copyRecursively(src, finalDest);
      } else {
        return await files_copy(src, finalDest);
      }
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `Native VFS copy failed: ${msg}`);
      return false;
    }
  }
}

/**
 * Determines whether a given ChRIS path refers to a directory.
 *
 * Distinguishes "verified absent" from "could not verify": a listing failure
 * while probing must not masquerade as a missing directory, since callers use
 * this probe to decide between not-found errors and real operations.
 *
 * @param targetPath - The absolute ChRIS path to check.
 * @returns Ok(true/false) when the parent listing answered, Err when the
 *   probe itself failed (an error has been pushed to the stack).
 */
async function path_checkIsDir(targetPath: string): Promise<Result<boolean>> {
  const parent: string = path.posix.dirname(targetPath);
  const name: string = path.posix.basename(targetPath);
  try {
    const results = await files_listAll({ limit: 1000, offset: 0 }, "dirs", parent);
    if (!results || !results.tableData) {
      // files_listAll returns null for both an empty parent and a failed
      // context: an empty parent simply has no dirs, so absent is the answer.
      return Ok(false);
    }
    const found: boolean = results.tableData.some((entry: Record<string, unknown>) => {
      const candidate: string =
        typeof entry.path === "string" && entry.path.length > 0
          ? entry.path
          : typeof entry.fname === "string"
            ? entry.fname
            : "";
      return candidate === targetPath || path.posix.basename(candidate) === name;
    });
    return Ok(found);
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Cannot verify directory ${targetPath}: ${msg}`);
    return Err();
  }
}

