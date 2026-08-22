/**
 * @file Factory for creating context-bound ChRIS embedded resource groups.
 *
 * @module
 */

import { ChRISEmbeddedResourceGroup } from "./chrisEmbeddedResourceGroup.js";
import { errorStack } from "../error/errorStack.js";

type ChRISResourceType = unknown;

interface ObjContextConfig {
  name: string;
  getMethod: string;
  contextType: "folder" | "plugin" | "feed";
}

class ObjContextCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjContextCreationError";
  }
}

class ChRISObjContextFactory {
  private config: ObjContextConfig;
  private cache: Map<string, ChRISEmbeddedResourceGroup<ChRISResourceType>> =
    new Map();

  constructor(config: ObjContextConfig) {
    this.config = config;
  }

  async create(
    context: string
  ): Promise<ChRISEmbeddedResourceGroup<ChRISResourceType> | null> {
    // Folder paths are not stable identities in CUBE: deleting and re-uploading
    // a directory assigns a new folder id, so a group bound at first touch would
    // keep listing (or 404ing against) the dead folder for the life of the
    // process. Long-running daemons make that lifetime unbounded, so folder
    // contexts are re-resolved on every call. Plugin and feed ids are stable
    // and stay cached.
    const cacheable: boolean = this.config.contextType !== "folder";
    const cacheKey: string = `${this.config.name}:${context}`;

    if (cacheable && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const objContext: ChRISEmbeddedResourceGroup<ChRISResourceType> | null =
        await ChRISEmbeddedResourceGroup.create<ChRISResourceType>(
          this.config.name,
          this.config.getMethod,
          context
        );
      if (!objContext) {
        return null;
      }
      if (cacheable) {
        this.cache.set(cacheKey, objContext);
      }
      return objContext;
    } catch (error: unknown) {
      const errorMessage: string =
        error instanceof Error ? error.message : String(error);
      errorStack.stack_push(
        "error",
        `Failed to create ${this.config.name}: ${errorMessage}`
      );
      console.log(`name = ${this.config.name} context = ${context}`);
      throw new ObjContextCreationError(
        `Failed to create ${this.config.name}: ${errorMessage}`
      );
      return null;
    }
  }

  /**
   * Evicts a cached context group, forcing the next create to re-resolve.
   *
   * Plugin and feed ids are stable enough to cache for the process lifetime,
   * but a deleted-and-recreated id would serve a dead binding forever (the
   * folder-context incident, one identity class over). Callers that delete a
   * plugin or feed should evict its context here.
   *
   * @param context - The context string whose cached group to drop.
   */
  evict(context: string): void {
    this.cache.delete(`${this.config.name}:${context}`);
  }
}

const ObjContexts: { [key: string]: ObjContextConfig } = {
  ComputesOfPlugin: {
    name: "ComputesOfPlugin",
    getMethod: "getPluginComputeResources",
    contextType: "plugin",
  },
  InstancesOfPlugin: {
    name: "InstancesOfPlugin",
    getMethod: "getPluginInstances",
    contextType: "plugin",
  },
  ParametersOfPlugin: {
    name: "ParametersOfPlugin",
    getMethod: "getPluginParameters",
    contextType: "plugin",
  },
  ChRISFilesContext: {
    name: "Files",
    getMethod: "getFiles",
    contextType: "folder",
  },
  ChRISLinksContext: {
    name: "Links",
    getMethod: "getLinkFiles",
    contextType: "folder",
  },
  ChRISDirsContext: {
    name: "Directories",
    getMethod: "getChildren",
    contextType: "folder",
  },
  ChRISFeedGroup: { // ADDED
    name: "Feed",
    getMethod: "getFeeds",
    contextType: "feed",
  },
};

const objContextFactories: { [key: string]: ChRISObjContextFactory } = {};

for (const [key, config] of Object.entries(ObjContexts)) {
  objContextFactories[key] = new ChRISObjContextFactory(config);
}

/**
 * Create a ChRIS Embedded Resource Group for a given context.
 *
 * @param type - The type of context object to create (e.g., "ComputesOfPlugin").
 * @param context - The context string (e.g., "plugin:123").
 * @returns A promise resolving to the created resource group, or null on failure.
 */
export async function objContext_create(
  type: string,
  context: string
): Promise<ChRISEmbeddedResourceGroup<ChRISResourceType> | null> {
  const factory: ChRISObjContextFactory | undefined = objContextFactories[type];
  if (!factory) {
    console.error(`Unknown object context type: ${type}`);
    throw new ObjContextCreationError(`Unknown object context type: ${type}`);
  }
  try {
    return factory.create(context);
  } catch (error: unknown) {
    throw error;
    return null;
  }
}

/**
 * Evicts a cached context group so the next create re-resolves it.
 *
 * Use after deleting the underlying resource (a plugin, a feed): its id may
 * be reassigned, and the cached binding would otherwise outlive it for the
 * whole process.
 *
 * @param type - The context type (e.g. "InstancesOfPlugin", "ChRISFeedGroup").
 * @param context - The context string (e.g. "plugin:123").
 */
export function objContext_evict(type: string, context: string): void {
  objContextFactories[type]?.evict(context);
}

// Usage examples:
// const pluginComputeResources: ChRISEmbeddedResourceGroup<Plugin> = await objContext_create('PluginComputeResources', 'plugin:123') as ChRISEmbeddedResourceGroup<Plugin>;
// const filesContext: ChRISEmbeddedResourceGroup<FileBrowserFolder> = await objContext_create('ChRISFilesContext', 'folder:/path/to/folder') as ChRISEmbeddedResourceGroup<FileBrowserFolder>;
