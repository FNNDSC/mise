/**
 * @file The pane registry: every workspace pane declares itself here.
 *
 * Three panes exist and the composition is still hardcoded — but each pane
 * registering `{ id, title, mount }` in one place is the seam the future
 * composition tree consumes. When a fourth pane arrives, the tree reads
 * this registry; nothing else needs rewriting.
 *
 * @module
 */

/** One pane's declaration. */
export interface PaneDefinition {
  id: string;
  title: string;
  mount: HTMLElement;
}

const panes: Map<string, PaneDefinition> = new Map();

/**
 * Registers a pane.
 *
 * @param pane - The pane's declaration.
 */
export function pane_register(pane: PaneDefinition): void {
  panes.set(pane.id, pane);
}

/** @returns Every registered pane, in registration order. */
export function panes_list(): PaneDefinition[] {
  return [...panes.values()];
}
