/**
 * @file VFS Dispatcher Registry.
 *
 * Directs filesystem requests to the matched VFSProvider instance.
 * Matches specific prefix paths first, falling back to Native.
 *
 * @module
 */

import { Result, Ok, Err } from "@fnndsc/cumin";
import { VFSProvider, VFSItem, CpOptions } from "./provider.js";
import { NativeVfsProvider } from "./providers/native.js";
import { PacsVfsProvider } from "./providers/pacs.js";

/**
 * Registry and dispatcher routing filesystem commands to matched VFS providers.
 */
export class VFSDispatcher {
  private providers: VFSProvider[] = [];
  private defaultProvider: VFSProvider;
  private pathResolver?: (path: string) => Promise<string>;

  /**
   * Initializes dispatcher and registers standard providers.
   */
  constructor() {
    this.defaultProvider = new NativeVfsProvider();
    this.provider_register(new PacsVfsProvider());
  }

  /**
   * Registers a path resolution hook that maps logical paths to physical paths.
   *
   * @param resolver - The resolver function mapping a logical path to a physical path.
   */
  pathResolver_register(resolver: (path: string) => Promise<string>): void {
    this.pathResolver = resolver;
  }

  /**
   * Registers a new VFS Provider.
   *
   * @param provider - The provider instance to register.
   */
  provider_register(provider: VFSProvider): void {
    this.providers.push(provider);
    // Sort by prefix length descending to match most specific prefix first
    this.providers.sort((a: VFSProvider, b: VFSProvider) => b.prefix.length - a.prefix.length);
  }

  /**
   * Resolves the matching provider for a given virtual path.
   *
   * @param pathStr - The absolute virtual path.
   * @returns The matching VFSProvider or the default native provider.
   */
  provider_get(pathStr: string): VFSProvider {
    const absolutePath: string = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
    const match: VFSProvider | undefined = this.providers.find(
      (p: VFSProvider) => absolutePath === p.prefix || absolutePath.startsWith(p.prefix + "/")
    );
    return match || this.defaultProvider;
  }

  /**
   * Dispatches directory listing to matched provider.
   * Supports dynamic intermediate parent path synthesis for virtual prefixes.
   *
   * @param pathStr - The absolute virtual path to list.
   * @param options - Sort controls.
   * @returns Promise resolving to Result<VFSItem[]>.
   */
  async list(
    pathStr: string,
    options?: { sort?: "name" | "size" | "date" | "owner"; reverse?: boolean }
  ): Promise<Result<VFSItem[]>> {
    const absolutePath: string = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
    const cleanPath = absolutePath.endsWith("/") && absolutePath.length > 1 ? absolutePath.slice(0, -1) : absolutePath;

    // Check if cleanPath is a parent of any registered provider's prefix
    const prefixParent = cleanPath === "/" ? "/" : cleanPath + "/";
    const children = this.providers.filter(
      (p) => p.prefix.startsWith(prefixParent)
    );

    if (children.length > 0) {
      const segmentIndex = cleanPath === "/" ? 1 : cleanPath.split("/").length;
      const virtualSubdirs = new Set<string>();

      for (const p of children) {
        const segments = p.prefix.split("/");
        const nextSegment = segments[segmentIndex];
        if (nextSegment) {
          virtualSubdirs.add(nextSegment);
        }
      }

      if (virtualSubdirs.size > 0) {
        const vfsItems: VFSItem[] = Array.from(virtualSubdirs).map((name) => ({
          name,
          type: "vfs",
          size: 0,
          owner: "root",
          date: new Date().toISOString(),
        }));

        // Query the default provider to see if there are any native items in this folder
        let resolvedPathStr: string = pathStr;
        if (this.pathResolver) {
          try {
            resolvedPathStr = await this.pathResolver(pathStr);
          } catch (e: unknown) {
            // Fall back cleanly to the original path on failure
          }
        }
        const nativeResult = await this.defaultProvider.list(resolvedPathStr, options);
        if (nativeResult.ok && nativeResult.value) {
          const nativeItems = nativeResult.value;
          for (const item of nativeItems) {
            if (!virtualSubdirs.has(item.name)) {
              vfsItems.push(item);
            }
          }
        }

        return Ok(vfsItems);
      }
    }

    const provider = this.provider_get(pathStr);
    if (provider === this.defaultProvider && this.pathResolver) {
      try {
        const resolvedPath: string = await this.pathResolver(pathStr);
        return provider.list(resolvedPath, options);
      } catch (e: unknown) {
        // Fall back cleanly to the original path on failure
      }
    }
    return provider.list(pathStr, options);
  }

  /**
   * Dispatches copy operation to matched provider.
   *
   * @param src - Source path.
   * @param dest - Destination path.
   * @param options - Copy options.
   * @returns Promise resolving to success boolean.
   */
  async cp(src: string, dest: string, options: CpOptions): Promise<boolean> {
    const provider = this.provider_get(src);
    if (provider === this.defaultProvider && this.pathResolver) {
      let resolvedSrc: string = src;
      let resolvedDest: string = dest;
      try {
        resolvedSrc = await this.pathResolver(src);
      } catch (e: unknown) {}
      try {
        resolvedDest = await this.pathResolver(dest);
      } catch (e: unknown) {}
      return provider.cp(resolvedSrc, resolvedDest, options);
    }
    return provider.cp(src, dest, options);
  }
}

/** Global instance of VFSDispatcher singleton. */
export const vfsDispatcher: VFSDispatcher = new VFSDispatcher();
