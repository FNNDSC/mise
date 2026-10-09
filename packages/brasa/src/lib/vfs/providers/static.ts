/**
 * @file Static Virtual File System Provider.
 *
 * Implements the core's virtual directories under the VFSDispatcher: `/usr`,
 * `/usr/bin` (the builtins), `/usr/games` (the shelf) and `/usr/share/doc`
 * (the release notes).
 *
 * @module
 */
import { vfsOutcome_ofBoolean, vfsOutcome_ofResult, type VfsOutcome } from '@fnndsc/fond';
import type { VFSProvider, VFSItem, CpOptions } from '@fnndsc/fond';
import { builtinCommands_list, commandSummary_get } from '../../../builtins/help.js';
import { gamesShelf_names } from '../../../builtins/games/shelf.js';
import { staticVfs_read, staticVfs_readBinary } from './static_content.js';
import { Result, Ok, Err, errorStack } from '@fnndsc/fond';

/**
 * Static virtual filesystem provider for command and builtin paths.
 */
export class StaticVfsProvider implements VFSProvider {
  /** The prefix path this provider handles. */
  prefix: string;

  /**
   * Initializes the static provider with its target prefix path.
   *
   * @param prefix - The absolute virtual directory prefix.
   */
  constructor(prefix: string) {
    this.prefix = prefix;
  }

  /**
   * Lists the contents of the matched static prefix path.
   *
   * @param pathStr - The absolute path.
   * @param options - Sort controls.
   * @returns Promise resolving to Result of VFSItems.
   */
  async list(
    pathStr: string,
    options?: { sort?: "name" | "size" | "date" | "owner"; reverse?: boolean }
  ): Promise<Result<VFSItem[]>> {
    try {
      let effectivePath: string = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
      if (effectivePath.length > 1 && effectivePath.endsWith("/")) {
        effectivePath = effectivePath.slice(0, -1);
      }

      if (effectivePath === "/usr") {
        // bin alone: the dispatcher adds every registered prefix beneath
        // (/usr/games, /usr/share) as a folder of its own.
        const items: VFSItem[] = [
          {
            name: "bin",
            type: "vfs",
            size: 0,
            owner: "root",
            date: new Date().toISOString(),
          }
        ];
        return Ok(items);
      }

      // The shelf (builtins/games/shelf.ts): the commands on it that exist.
      if (effectivePath === "/usr/games") {
        const items: VFSItem[] = gamesShelf_names(commandSummary_get).map((name: string): VFSItem => ({
          name,
          type: "plugin",
          size: 0,
          owner: "games",
          date: new Date().toISOString(),
        }));
        return Ok(this.staticVfsItems_sort(items, options?.sort, options?.reverse));
      }

      // /usr/share holds doc alone (the dispatcher lists it as a prefix of its own);
      // /usr/share/doc holds NEWS: the installed releases' notes (builtins/sys/notes.ts).
      if (effectivePath === "/usr/share") {
        return Ok([]);
      }
      if (effectivePath === "/usr/share/doc") {
        return Ok([{ name: "NEWS", type: "file", size: 0, owner: "root", date: new Date().toISOString() }]);
      }

      if (effectivePath === "/usr/bin") {
        const builtinNames: string[] = builtinCommands_list();
        const items: VFSItem[] = builtinNames.map((name: string) => ({
          name,
          type: "plugin",
          size: 0,
          owner: "system",
          date: new Date().toISOString(),
        }));

        const sorted: VFSItem[] = this.staticVfsItems_sort(items, options?.sort, options?.reverse);
        return Ok(sorted);
      }

      return Ok([]);
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `Static VFS list failed for prefix ${this.prefix}: ${msg}`);
      return Err();
    }
  }

  /** @inheritdoc */
  async cp(src: string, dest: string, options: CpOptions): Promise<VfsOutcome> {
    return vfsOutcome_ofBoolean(await this.copy_run(src, dest, options), 'EROFS');
  }

  /**
   * Block copy operations for static paths.
   *
   * @param src - Source path.
   * @param dest - Destination path.
   * @param options - Copy options.
   * @returns Promise resolving to false always to block copying.
   */
  private async copy_run(src: string, dest: string, options: CpOptions): Promise<boolean> {
    errorStack.stack_push("error", `cp: Copying from static VFS path '${src}' is not supported.`);
    return false;
  }

  /**
   * Standard sort helper for virtual items.
   *
   * @param items - The VFSItem array to sort.
   * @param sortField - Field to sort by.
   * @param reverse - True to reverse output sorting.
   * @returns Sorted VFSItem array.
   */
  private staticVfsItems_sort(
    items: VFSItem[],
    sortField?: "name" | "size" | "date" | "owner",
    reverse?: boolean
  ): VFSItem[] {
    const field: keyof VFSItem = sortField || "name";
    const sorted: VFSItem[] = [...items].sort((a: VFSItem, b: VFSItem) => {
      const valA: string | number = a[field];
      const valB: string | number = b[field];
      if (typeof valA === "string" && typeof valB === "string") {
        return valA.localeCompare(valB);
      }
      if (typeof valA === "number" && typeof valB === "number") {
        return (valA as number) - (valB as number);
      }
      return 0;
    });
    if (reverse) {
      sorted.reverse();
    }
    return sorted;
  }

  /** @inheritdoc */
  async read(pathStr: string): Promise<VfsOutcome<string>> {
    return vfsOutcome_ofResult(await this.text_read(pathStr), 'ENOENT');
  }

  /**
   * Reads virtual file content under command and builtin static paths.
   *
   * @param pathStr - The absolute virtual path of the file to read.
   * @returns Promise resolving to a Result containing the file contents.
   */
  private async text_read(pathStr: string): Promise<Result<string>> {
    return staticVfs_read(pathStr, this.prefix);
  }

  /** @inheritdoc */
  async readBinary(pathStr: string): Promise<VfsOutcome<Buffer>> {
    return vfsOutcome_ofResult(await this.bytes_read(pathStr), 'ENOENT');
  }

  /**
   * Reads virtual file binary content under command and builtin static paths.
   *
   * @param pathStr - The absolute virtual path of the file to read.
   * @returns Promise resolving to a Result containing the file contents as a Buffer.
   */
  private async bytes_read(pathStr: string): Promise<Result<Buffer>> {
    return staticVfs_readBinary(pathStr, this.prefix);
  }
}
