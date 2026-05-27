/**
 * @file Static Virtual File System Provider.
 *
 * Implements virtual directories for `/bin`, `/usr`, and `/usr/bin` under the VFSDispatcher.
 *
 * @module
 */
import { Result, Ok, Err, errorStack } from '@fnndsc/cumin';
import { VFSProvider, VFSItem, CpOptions, plugins_listAll } from '@fnndsc/salsa';
import { builtinCommands_list } from '../../../builtins/help.js';

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
      let effectivePath = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
      if (effectivePath.length > 1 && effectivePath.endsWith("/")) {
        effectivePath = effectivePath.slice(0, -1);
      }

      if (effectivePath === "/bin") {
        const plugins = await plugins_listAll({});
        const items: VFSItem[] = [];

        if (plugins && plugins.tableData) {
          plugins.tableData.forEach((plugin: Record<string, unknown>) => {
            const pluginName = typeof plugin.name === 'string' ? plugin.name : String(plugin.name);
            const pluginVersion = typeof plugin.version === 'string' ? plugin.version : String(plugin.version || '');
            const displayName = pluginVersion ? `${pluginName}-v${pluginVersion}` : pluginName;

            items.push({
              name: displayName,
              type: "plugin",
              size: 0,
              owner: "system",
              date: typeof plugin.creation_date === 'string' ? plugin.creation_date : '',
            });
          });
        }

        const sorted = this.staticVfsItems_sort(items, options?.sort, options?.reverse);
        return Ok(sorted);
      }

      if (effectivePath === "/usr") {
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

      if (effectivePath === "/usr/bin") {
        const builtinNames = builtinCommands_list();
        const items: VFSItem[] = builtinNames.map((name: string) => ({
          name,
          type: "plugin",
          size: 0,
          owner: "system",
          date: new Date().toISOString(),
        }));

        const sorted = this.staticVfsItems_sort(items, options?.sort, options?.reverse);
        return Ok(sorted);
      }

      return Ok([]);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `Static VFS list failed for prefix ${this.prefix}: ${msg}`);
      return Err();
    }
  }

  /**
   * Block copy operations for static paths.
   *
   * @param src - Source path.
   * @param dest - Destination path.
   * @param options - Copy options.
   * @returns Promise resolving to false always to block copying.
   */
  async cp(src: string, dest: string, options: CpOptions): Promise<boolean> {
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
    const sorted = [...items].sort((a: VFSItem, b: VFSItem) => {
      const valA = a[field];
      const valB = b[field];
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
}
