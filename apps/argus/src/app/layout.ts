/**
 * @file The tiling layout: a binary split tree over the pane registry.
 *
 * tmux's real model, baked at the foundation: the display is one region; a
 * split divides a region into exactly two (a row or a column, with a
 * ratio); leaves are panes. Recursion gives every layout a fixed grid could
 * and many it couldn't. The tree is the state — no layout enum, no
 * per-pane boolean soup.
 *
 * The gutter's buttons apply *presets* — named trees, "reset to givens."
 * Dividers drag their split's ratio; ratios and the active preset persist
 * per browser (geometry is preference). Which panes a tree holds is
 * context, derived live and never persisted.
 *
 * Panes are long-lived DOM elements (the registry's mounts); rendering a
 * tree *reparents* them into fresh split scaffolding, so their listeners,
 * scenes, and scroll state survive every rearrangement.
 *
 * The console drawer lives outside the tree (its lid idiom stands); zoom
 * remains a modifier above whatever tree is active.
 *
 * @module
 */

/** One node of the layout tree. */
export type LayoutNode =
  | { pane: string }
  | { dir: 'row' | 'col'; ratio: number; first: LayoutNode; second: LayoutNode };

/** A named preset: a tree builder, so each application starts fresh. */
export type LayoutPreset = () => LayoutNode;

/** The localStorage key for geometry preferences. */
const LAYOUT_STORAGE_KEY: string = 'argus-layout';

/** Persisted geometry: the active preset and per-split ratios. */
interface LayoutPrefs {
  preset?: string;
  ratios?: Record<string, number>;
}

/**
 * The layout manager: renders trees into a root element, arranges the
 * registered panes' mounts, and keeps geometry preferences.
 */
export class LayoutManager {
  private readonly root: HTMLElement;
  private readonly mounts: Map<string, HTMLElement>;
  private readonly presets: Map<string, LayoutPreset> = new Map();
  private prefs: LayoutPrefs = {};
  private activePreset: string = '';
  private tree: LayoutNode | null = null;
  private focusedPane: string | null = null;

  /**
   * @param root - The element the tree renders into.
   * @param mounts - Pane id → mount element (from the pane registry).
   */
  constructor(root: HTMLElement, mounts: Map<string, HTMLElement>) {
    this.root = root;
    this.mounts = mounts;
    try {
      const raw: string | null = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
      this.prefs = raw !== null ? (JSON.parse(raw) as LayoutPrefs) : {};
    } catch {
      this.prefs = {};
    }
  }

  /**
   * Registers a named preset.
   *
   * @param name - The preset's name (a gutter button's identity).
   * @param preset - The tree builder.
   */
  public preset_register(name: string, preset: LayoutPreset): void {
    this.presets.set(name, preset);
  }

  /**
   * Registers a pane mount so trees can hold it (instances arrive live).
   *
   * @param id - The pane instance's id.
   * @param mount - Its mount element.
   */
  public mount_register(id: string, mount: HTMLElement): void {
    this.mounts.set(id, mount);
  }

  /**
   * Forgets a pane mount (a disposed instance).
   *
   * @param id - The pane instance's id.
   */
  public mount_remove(id: string): void {
    this.mounts.delete(id);
    if (this.focusedPane === id) {
      this.focusedPane = null;
    }
  }

  /**
   * Splits a leaf in two: the existing pane keeps the first half, the new
   * pane takes the second, at an even ratio. Renders and focuses the new
   * pane (tmux semantics).
   *
   * @param target - The pane id whose leaf splits.
   * @param dir - 'col' for side-by-side, 'row' for stacked.
   * @param newPane - The pane id filling the second half.
   * @returns True when the target was found and split.
   */
  public leaf_split(target: string, dir: 'row' | 'col', newPane: string): boolean {
    if (this.tree === null) return false;
    const replaced: LayoutNode | null = tree_replaceLeaf(this.tree, target, {
      dir,
      ratio: 0.5,
      first: { pane: target },
      second: { pane: newPane },
    });
    if (replaced === null) return false;
    this.tree = replaced;
    this.focusedPane = newPane;
    this.render();
    return true;
  }

  /**
   * Replaces one leaf's pane with another (a claim: the empty pane
   * becoming what its command projected).
   *
   * @param target - The pane id being replaced.
   * @param newPane - The pane id standing in its place.
   * @returns True when the target was found.
   */
  public leaf_replace(target: string, newPane: string): boolean {
    if (this.tree === null) return false;
    const replaced: LayoutNode | null = tree_replaceLeaf(this.tree, target, { pane: newPane });
    if (replaced === null) return false;
    this.tree = replaced;
    if (this.focusedPane === target) {
      this.focusedPane = newPane;
    }
    this.render();
    return true;
  }

  /**
   * Closes a leaf: its sibling takes the whole region. Closing the root
   * leaf is refused — the host decides what an empty workspace means.
   *
   * @param target - The pane id whose leaf closes.
   * @returns True when the leaf was found below the root and removed.
   */
  public leaf_close(target: string): boolean {
    if (this.tree === null || 'pane' in this.tree) return false;
    const pruned: LayoutNode | null = tree_pruneLeaf(this.tree, target);
    if (pruned === null) return false;
    this.tree = pruned;
    if (this.focusedPane === target) {
      this.focusedPane = null;
    }
    this.render();
    return true;
  }

  /** @returns The focused pane's id, when one is focused. */
  public focused_get(): string | null {
    return this.focusedPane;
  }

  /** @returns The persisted preset name, when it names a registered preset. */
  public savedPreset_get(): string | null {
    return this.prefs.preset !== undefined && this.presets.has(this.prefs.preset)
      ? this.prefs.preset
      : null;
  }

  /** @returns The active preset's name. */
  public activePreset_get(): string {
    return this.activePreset;
  }

  /**
   * Applies a preset: builds its tree, restores its remembered ratios, and
   * renders with the arrival glide.
   *
   * @param name - The preset to apply.
   */
  public preset_apply(name: string): void {
    const preset: LayoutPreset | undefined = this.presets.get(name);
    if (preset === undefined) return;
    this.activePreset = name;
    this.prefs.preset = name;
    this.prefs_save();
    this.tree = this.ratios_restore(preset(), name, '');
    this.render();
    this.root.classList.remove('layout-arrive');
    // Reflow so the animation restarts on every application.
    void this.root.offsetWidth;
    this.root.classList.add('layout-arrive');
  }

  /**
   * Replaces the current tree (a context-driven variation of the active
   * preset — the DAG materializing, say) without touching preferences.
   *
   * @param tree - The tree to render.
   */
  public tree_set(tree: LayoutNode): void {
    this.tree = this.ratios_restore(tree, this.activePreset, '');
    this.render();
  }

  /** @returns The pane ids the current tree holds. */
  public panes_shown(): string[] {
    const found: string[] = [];
    const walk = (node: LayoutNode | null): void => {
      if (node === null) return;
      if ('pane' in node) {
        found.push(node.pane);
        return;
      }
      walk(node.first);
      walk(node.second);
    };
    walk(this.tree);
    return found;
  }

  /** Renders the current tree, reparenting pane mounts into the scaffold. */
  private render(): void {
    if (this.tree === null) return;
    // Detach every mount first so a pane leaving the tree goes offstage
    // rather than being orphaned mid-scaffold.
    for (const mount of this.mounts.values()) {
      mount.remove();
    }
    this.root.replaceChildren(this.node_render(this.tree, ''));
  }

  /** Builds one node's DOM. `path` names the split for ratio persistence. */
  private node_render(node: LayoutNode, path: string): HTMLElement {
    if ('pane' in node) {
      const leaf: HTMLDivElement = document.createElement('div');
      leaf.className = 'layout-leaf';
      const mount: HTMLElement | undefined = this.mounts.get(node.pane);
      if (mount !== undefined) {
        leaf.appendChild(mount);
        mount.style.display = '';
        leaf.addEventListener(
          'mousedown',
          (): void => this.focus_set(node.pane),
          { capture: true },
        );
        if (node.pane === this.focusedPane) {
          leaf.classList.add('pane-focused');
        }
      }
      return leaf;
    }

    const split: HTMLDivElement = document.createElement('div');
    split.className = `layout-split layout-${node.dir}`;
    const first: HTMLElement = this.node_render(node.first, `${path}0`);
    const second: HTMLElement = this.node_render(node.second, `${path}1`);
    first.style.flex = `${node.ratio} 1 0`;
    second.style.flex = `${1 - node.ratio} 1 0`;
    const divider: HTMLDivElement = document.createElement('div');
    divider.className = 'layout-divider';
    this.divider_wire(divider, split, node, first, second, path);
    split.append(first, divider, second);
    return split;
  }

  /** Wires one divider's drag to its split's ratio. */
  private divider_wire(
    divider: HTMLElement,
    split: HTMLElement,
    node: { dir: 'row' | 'col'; ratio: number },
    first: HTMLElement,
    second: HTMLElement,
    path: string,
  ): void {
    let dragging: boolean = false;
    divider.addEventListener('mousedown', (event: MouseEvent): void => {
      dragging = true;
      event.preventDefault();
    });
    window.addEventListener('mousemove', (event: MouseEvent): void => {
      if (!dragging) return;
      const bounds: DOMRect = split.getBoundingClientRect();
      const along: number =
        node.dir === 'col'
          ? (event.clientX - bounds.left) / bounds.width
          : (event.clientY - bounds.top) / bounds.height;
      node.ratio = Math.min(0.85, Math.max(0.15, along));
      first.style.flex = `${node.ratio} 1 0`;
      second.style.flex = `${1 - node.ratio} 1 0`;
    });
    window.addEventListener('mouseup', (): void => {
      if (!dragging) return;
      dragging = false;
      this.ratio_remember(path, node.ratio);
    });
  }

  /** Marks one pane focused and repaints the rings. */
  public focus_set(pane: string): void {
    if (this.focusedPane === pane) return;
    this.focusedPane = pane;
    for (const leaf of this.root.querySelectorAll('.layout-leaf')) {
      leaf.classList.remove('pane-focused');
    }
    const mount: HTMLElement | undefined = this.mounts.get(pane);
    mount?.parentElement?.classList.add('pane-focused');
  }

  /** Applies remembered ratios onto a fresh tree. */
  private ratios_restore(node: LayoutNode, preset: string, path: string): LayoutNode {
    if ('pane' in node) return node;
    const remembered: number | undefined = this.prefs.ratios?.[`${preset}:${path}`];
    return {
      ...node,
      ratio: remembered ?? node.ratio,
      first: this.ratios_restore(node.first, preset, `${path}0`),
      second: this.ratios_restore(node.second, preset, `${path}1`),
    };
  }

  /** Remembers one split's ratio under the active preset. */
  private ratio_remember(path: string, ratio: number): void {
    this.prefs.ratios = { ...(this.prefs.ratios ?? {}), [`${this.activePreset}:${path}`]: ratio };
    this.prefs_save();
  }

  /** Persists the geometry preferences. */
  private prefs_save(): void {
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      // A browser without storage keeps the session-long geometry.
    }
  }
}

/**
 * Returns a tree with the named leaf replaced by another node, or null when
 * the leaf does not appear.
 *
 * @param node - The tree to transform.
 * @param target - The pane id of the leaf to replace.
 * @param replacement - The node standing in its place.
 * @returns The transformed tree, or null.
 */
function tree_replaceLeaf(
  node: LayoutNode,
  target: string,
  replacement: LayoutNode,
): LayoutNode | null {
  if ('pane' in node) {
    return node.pane === target ? replacement : null;
  }
  const first: LayoutNode | null = tree_replaceLeaf(node.first, target, replacement);
  if (first !== null) {
    return { ...node, first };
  }
  const second: LayoutNode | null = tree_replaceLeaf(node.second, target, replacement);
  if (second !== null) {
    return { ...node, second };
  }
  return null;
}

/**
 * Returns a tree with the named leaf removed — its sibling takes the
 * parent's region — or null when the leaf does not appear below a split.
 *
 * @param node - The tree to transform (must be a split).
 * @param target - The pane id of the leaf to remove.
 * @returns The transformed tree, or null.
 */
function tree_pruneLeaf(node: LayoutNode, target: string): LayoutNode | null {
  if ('pane' in node) {
    return null;
  }
  if ('pane' in node.first && node.first.pane === target) {
    return node.second;
  }
  if ('pane' in node.second && node.second.pane === target) {
    return node.first;
  }
  const first: LayoutNode | null = tree_pruneLeaf(node.first, target);
  if (first !== null) {
    return { ...node, first };
  }
  const second: LayoutNode | null = tree_pruneLeaf(node.second, target);
  if (second !== null) {
    return { ...node, second };
  }
  return null;
}
