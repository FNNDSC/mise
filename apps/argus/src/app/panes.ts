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

/**
 * Every kind of pane the surface can stand on the stage. One union, so a
 * switch on a kind is checked and a new kind is added here first
 * (aegis.adoc: a-fact-has-one-source).
 */
export type PaneKind =
  | 'files' | 'catalogue' | 'dag' | 'pacs' | 'image' | 'tags' | 'gather' | 'view' | 'empty'
  | 'universe' | 'help' | 'panes' | 'launcher' | 'edit';

/**
 * The three primaries: the domain panes that never go dormant and are not
 * cards in PANES. Tested in five spellings before this set.
 */
export const PRIMARIES: ReadonlySet<string> = new Set(['files', 'dag', 'pacs']);

/**
 * Whether a pane id is a primary.
 *
 * @param id - A pane id.
 * @returns True for the files, dag and pacs primaries.
 */
export function pane_isPrimary(id: string): boolean {
  return PRIMARIES.has(id);
}

/** One live pane: its identity, kind, mount, and cleanup. */
export interface PaneInstance {
  id: string;
  kind: PaneKind;
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
export function paneFactory_register(kind: PaneKind, factory: PaneFactory): void {
  factories.set(kind, factory);
}

/**
 * Creates a fresh instance of a kind.
 *
 * @param kind - The registered kind.
 * @returns The new instance.
 * @throws {Error} When the kind has no factory.
 */
export function paneInstance_create(kind: PaneKind): PaneInstance {
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

/**
 * Every panel controller a pane kind stands on, by the roster key it is
 * filed under. A files browser and a catalogue are both a `FilesPanel`, so
 * both file under `files`; the key is the controller's type, not the pane's
 * kind.
 */
export interface PanelKinds {
  files: import('../features/files/panel.js').FilesPanel;
  dag: import('../features/dag/panel.js').DagPanel;
  universe: import('../features/universe/panel.js').UniversePanel;
  gather: import('../features/gather/panel.js').GatherPanel;
  image: import('../features/image/panel.js').ImagePanel;
  tags: import('../features/tags/panel.js').TagsPanel;
  view: import('../features/view/panel.js').ViewerPanel;
  help: import('../features/help/panel.js').HelpPanel;
  edit: import('../features/edit/panel.js').EditPanel;
}

/** A roster key: which controller type a panel is. */
export type PanelKind = keyof PanelKinds;

/**
 * The live panel controllers, one roster for every kind: filed by pane id
 * when a pane is built, struck when it is disposed, read by kind for
 * routing (a progress message to its DAG, a prompt context to every files
 * browser). Eight maps of one shape each used to stand where this does.
 */
export class PanelRoster {
  private readonly byId: Map<string, { kind: PanelKind; panel: PanelKinds[PanelKind] }> = new Map();

  /**
   * Files a panel under its pane id.
   *
   * @param kind - The controller's kind.
   * @param id - The pane id.
   * @param panel - The controller.
   */
  public set<K extends PanelKind>(kind: K, id: string, panel: PanelKinds[K]): void {
    this.byId.set(id, { kind, panel });
  }

  /**
   * The panel of a kind filed under a pane id.
   *
   * @param kind - The controller's kind.
   * @param id - The pane id.
   * @returns The controller, or undefined when none of that kind is filed there.
   */
  public get<K extends PanelKind>(kind: K, id: string): PanelKinds[K] | undefined {
    const entry = this.byId.get(id);
    return entry !== undefined && entry.kind === kind ? (entry.panel as PanelKinds[K]) : undefined;
  }

  /**
   * Whether a panel of a kind is filed under a pane id.
   *
   * @param kind - The controller's kind.
   * @param id - The pane id.
   * @returns True when one is.
   */
  public has(kind: PanelKind, id: string): boolean {
    return this.byId.get(id)?.kind === kind;
  }

  /**
   * Strikes whatever is filed under a pane id.
   *
   * @param id - The pane id.
   * @returns True when something was filed there.
   */
  public delete(id: string): boolean {
    return this.byId.delete(id);
  }

  /**
   * The pane ids holding a kind, in filing order.
   *
   * @param kind - The controller's kind.
   * @returns The ids.
   */
  public ids(kind: PanelKind): string[] {
    return this.entries(kind).map(([id]: [string, PanelKinds[PanelKind]]): string => id);
  }

  /**
   * Every panel of a kind, with its pane id, in filing order.
   *
   * @param kind - The controller's kind.
   * @returns The pairs.
   */
  public entries<K extends PanelKind>(kind: K): Array<[string, PanelKinds[K]]> {
    const out: Array<[string, PanelKinds[K]]> = [];
    for (const [id, entry] of this.byId) {
      if (entry.kind === kind) out.push([id, entry.panel as PanelKinds[K]]);
    }
    return out;
  }

  /**
   * Every panel of a kind, in filing order.
   *
   * @param kind - The controller's kind.
   * @returns The controllers.
   */
  public values<K extends PanelKind>(kind: K): Array<PanelKinds[K]> {
    return this.entries(kind).map(([, panel]: [string, PanelKinds[K]]): PanelKinds[K] => panel);
  }

  /**
   * The pane id a panel is filed under.
   *
   * @param kind - The controller's kind.
   * @param panel - The controller.
   * @returns Its pane id, or null when it is not filed.
   */
  public idOf<K extends PanelKind>(kind: K, panel: PanelKinds[K]): string | null {
    for (const [id, entry] of this.byId) {
      if (entry.kind === kind && entry.panel === panel) return id;
    }
    return null;
  }
}
