/**
 * @file The pane registry: kinds, factories, and live instances.
 *
 * A pane *kind* (files, dag, empty) registers a factory; the workspace
 * creates *instances* from it — each with its own mount, controller, and
 * identity — so the layout tree can hold two file browsers at different
 * paths or two DAGs side by side. Instances are long-lived DOM elements the
 * tree reparents; disposing one releases whatever its controller holds
 * (a WebGL scene, observers).
 *
 * @module
 */

/** One live pane: its identity, kind, mount, and cleanup. */
export interface PaneInstance {
  id: string;
  kind: string;
  mount: HTMLElement;
  dispose?: () => void;
}

/** Builds one instance of a kind; `id` is the instance's assigned identity. */
export type PaneFactory = (id: string) => PaneInstance;

const factories: Map<string, PaneFactory> = new Map();
const instances: Map<string, PaneInstance> = new Map();
let nextInstance: number = 0;

/**
 * Registers a pane kind's factory.
 *
 * @param kind - The kind name (a template's identity).
 * @param factory - The instance builder.
 */
export function paneFactory_register(kind: string, factory: PaneFactory): void {
  factories.set(kind, factory);
}

/**
 * Creates a fresh instance of a kind.
 *
 * @param kind - The registered kind.
 * @returns The new instance.
 * @throws {Error} When the kind has no factory.
 */
export function paneInstance_create(kind: string): PaneInstance {
  const factory: PaneFactory | undefined = factories.get(kind);
  if (factory === undefined) {
    throw new Error(`no pane factory registered for kind '${kind}'`);
  }
  const instance: PaneInstance = factory(`${kind}-${nextInstance++}`);
  instances.set(instance.id, instance);
  return instance;
}

/**
 * Adopts an externally built instance (a singleton pane like PACS whose
 * mount is static page markup).
 *
 * @param instance - The instance to track.
 */
export function paneInstance_adopt(instance: PaneInstance): void {
  instances.set(instance.id, instance);
}

/**
 * @param id - An instance id.
 * @returns The live instance, or undefined.
 */
export function paneInstance_get(id: string): PaneInstance | undefined {
  return instances.get(id);
}

/** @returns Every live instance, in creation order. */
export function paneInstances_list(): PaneInstance[] {
  return [...instances.values()];
}

/**
 * Disposes one instance: runs its cleanup and forgets it.
 *
 * @param id - The instance to dispose.
 */
export function paneInstance_dispose(id: string): void {
  const instance: PaneInstance | undefined = instances.get(id);
  if (instance === undefined) {
    return;
  }
  instances.delete(id);
  instance.dispose?.();
  instance.mount.remove();
}
