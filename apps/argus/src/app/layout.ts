import { SIDES, type Side } from './sides.js';
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

/** Why a move was refused: the only pane on stage, or already at that edge. */
export type MoveRefusal = 'lone' | 'edge';
export type { Side as MoveDir } from './sides.js';

/** One step of the path from the root to a leaf: the split, and which side the path took. */
interface PathStep {
  node: Extract<LayoutNode, { dir: 'row' | 'col' }>;
  side: 'first' | 'second';
}

/**
 * The path from the root to a leaf, root first.
 *
 * @param node - The tree.
 * @param target - The pane id.
 * @returns The splits taken and the side at each, empty when the root is the leaf; null when absent.
 */
function tree_path(node: LayoutNode, target: string): PathStep[] | null {
  if ('pane' in node) return node.pane === target ? [] : null;
  const first: PathStep[] | null = tree_path(node.first, target);
  if (first !== null) return [{ node, side: 'first' }, ...first];
  const second: PathStep[] | null = tree_path(node.second, target);
  if (second !== null) return [{ node, side: 'second' }, ...second];
  return null;
}

/**
 * Replaces one subtree, found by identity, with another.
 *
 * @param node - The tree.
 * @param block - The subtree object to replace.
 * @param replacement - What stands in its place.
 * @returns The new tree, or null when the block is not in it.
 */
function tree_replaceBlock(node: LayoutNode, block: LayoutNode, replacement: LayoutNode): LayoutNode | null {
  if (node === block) return replacement;
  if ('pane' in node) return null;
  const first: LayoutNode | null = tree_replaceBlock(node.first, block, replacement);
  if (first !== null) return { ...node, first };
  const second: LayoutNode | null = tree_replaceBlock(node.second, block, replacement);
  if (second !== null) return { ...node, second };
  return null;
}

/**
 * Moves a leaf to a side: the pane is detached (its sibling takes the
 * hole) and re-split onto the nearest block on that side — the whole
 * subtree beyond the nearest ancestor split on that axis that had the
 * mover on the near side — or onto its former sibling when no such
 * ancestor exists and the asked axis differs from the sibling's; the new
 * split opens even. Every outcome is a tree a split could have made.
 *
 * @param root - The tree.
 * @param target - The pane that moves.
 * @param dir - The side it moves to.
 * @returns The new tree, or why the move is refused.
 */
export function tree_moveLeaf(root: LayoutNode, target: string, dir: Side): LayoutNode | MoveRefusal {
  const path: PathStep[] | null = tree_path(root, target);
  if (path === null || path.length === 0) return 'lone';
  const axis: 'row' | 'col' = SIDES[dir].axis;
  // To move further right (or below) the mover must stand first in a split
  // on that axis; to move left (or above), second.
  const near: 'first' | 'second' = SIDES[dir].place === 'after' ? 'first' : 'second';
  const parent: PathStep = path[path.length - 1] as PathStep;
  let block: LayoutNode | null = null;
  for (let index: number = path.length - 1; index >= 0; index -= 1) {
    const step: PathStep = path[index] as PathStep;
    if (step.node.dir === axis && step.side === near) {
      block = step.side === 'first' ? step.node.second : step.node.first;
      break;
    }
  }
  if (block === null) {
    if (parent.node.dir === axis) return 'edge';
    block = parent.side === 'first' ? parent.node.second : parent.node.first;
  }
  const pruned: LayoutNode | null = tree_pruneLeaf(root, target);
  if (pruned === null) return 'lone';
  const mover: LayoutNode = { pane: target };
  const split: LayoutNode = near === 'first'
    ? { dir: axis, ratio: 0.5, first: block, second: mover }
    : { dir: axis, ratio: 0.5, first: mover, second: block };
  return tree_replaceBlock(pruned, block, split) ?? 'edge';
}

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
  private renderObserver: (() => void) | null = null;
  /** The pane focused before the current one (tmux `;`). */
  private previousFocus: string | null = null;

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
   * Sets the observer called after every geometry change — a render (tree
   * mutation, preset) or a settled divider drag. Panes with measured
   * canvases (the DAG's scene) refit there; without it a reparented canvas
   * keeps its old pixel size and paints smushed.
   *
   * @param observer - Called after geometry settles.
   */
  public renderObserver_set(observer: () => void): void {
    this.renderObserver = observer;
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
  public leaf_split(
    target: string,
    dir: 'row' | 'col',
    newPane: string,
    before: boolean = false,
  ): boolean {
    if (this.tree === null) return false;
    // `before` places the new pane left (col) or above (row) the target;
    // the drawer's four placement pills each name one of these positions.
    const replaced: LayoutNode | null = tree_replaceLeaf(this.tree, target, {
      dir,
      ratio: 0.5,
      first: before ? { pane: newPane } : { pane: target },
      second: before ? { pane: target } : { pane: newPane },
    });
    if (replaced === null) return false;
    this.tree = replaced;
    // The new pane takes focus; the pane it was split from is the one `;` returns to.
    this.focus_move(newPane);
    this.render();
    return true;
  }

  /**
   * Moves a leaf to a side (see tree_moveLeaf). The mover keeps focus.
   *
   * @param target - The pane that moves.
   * @param dir - The side it moves to.
   * @returns True when it moved, else why not.
   */
  public leaf_move(target: string, dir: Side): true | MoveRefusal {
    if (this.tree === null) return 'lone';
    const moved: LayoutNode | MoveRefusal = tree_moveLeaf(this.tree, target, dir);
    if (typeof moved === 'string') return moved;
    this.tree = moved;
    this.focus_move(target);
    this.render();
    return true;
  }

  /**
   * Gives focus to a pane while the tree is being rebuilt (render repaints
   * the rings), keeping the pane that had it as the one `;` returns to.
   *
   * @param pane - The pane taking focus.
   */
  private focus_move(pane: string): void {
    if (this.focusedPane !== null && this.focusedPane !== pane) this.previousFocus = this.focusedPane;
    this.focusedPane = pane;
  }

  /**
   * Focuses the pane that was focused before this one (tmux `;`).
   *
   * @returns The pane now focused, or null when there was no previous one on stage.
   */
  public focus_last(): string | null {
    const previous: string | null = this.previousFocus;
    if (previous === null || !this.panes_shown().includes(previous)) return null;
    this.focus_set(previous);
    return previous;
  }

  /**
   * Flips the axis of the split a pane stands in: beside becomes above
   * (tmux's next-layout, for a pair).
   *
   * @param target - The pane.
   * @returns True when it stood in a split.
   */
  public leaf_flip(target: string): boolean {
    if (this.tree === null) return false;
    const path: PathStep[] | null = tree_path(this.tree, target);
    if (path === null || path.length === 0) return false;
    const parent: PathStep = path[path.length - 1] as PathStep;
    const flipped: LayoutNode = { ...parent.node, dir: parent.node.dir === 'col' ? 'row' : 'col' };
    const replaced: LayoutNode | null = tree_replaceBlock(this.tree, parent.node, flipped);
    if (replaced === null) return false;
    this.tree = replaced;
    this.render();
    return true;
  }

  /**
   * Moves the boundary beside a pane a step in a direction: the nearest
   * split on that axis around it is re-balanced and remembered, as a
   * divider drag is (tmux Ctrl-arrow).
   *
   * @param target - The pane.
   * @param dir - Which way the boundary moves.
   * @param step - The share moved, as a fraction of the split.
   * @returns True when a split on that axis holds the pane.
   */
  public leaf_resize(target: string, dir: Side, step: number = 0.05): boolean {
    if (this.tree === null) return false;
    const path: PathStep[] | null = tree_path(this.tree, target);
    if (path === null || path.length === 0) return false;
    const axis: 'row' | 'col' = SIDES[dir].axis;
    for (let index: number = path.length - 1; index >= 0; index -= 1) {
      const step_: PathStep = path[index] as PathStep;
      if (step_.node.dir !== axis) continue;
      // The boundary moves right or down when the first side grows.
      const forward: boolean = SIDES[dir].place === 'after';
      const ratio: number = Math.min(0.85, Math.max(0.15, step_.node.ratio + (forward ? step : -step)));
      const balanced: LayoutNode = { ...step_.node, ratio };
      const replaced: LayoutNode | null = tree_replaceBlock(this.tree, step_.node, balanced);
      if (replaced === null) return false;
      this.tree = replaced;
      this.ratio_remember(path.slice(0, index).map((taken: PathStep): string => (taken.side === 'first' ? '0' : '1')).join(''), ratio);
      this.render();
      return true;
    }
    return false;
  }

  /**
   * Whether a move would be taken, so a control can dim before the press.
   *
   * @param target - The pane that would move.
   * @param dir - The side.
   * @returns True when the move is possible.
   */
  public move_possible(target: string, dir: Side): boolean {
    return this.tree !== null && typeof tree_moveLeaf(this.tree, target, dir) !== 'string';
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
   * Whether a preset is registered (a composition's own presets are only
   * under that composition).
   *
   * @param name - The preset.
   * @returns True when it is registered.
   */
  public preset_has(name: string): boolean {
    return this.presets.has(name);
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
  /** @returns A deep copy of the live tree, for serializers. */
  public tree_get(): LayoutNode | null {
    return this.tree === null ? null : (JSON.parse(JSON.stringify(this.tree)) as LayoutNode);
  }

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
    this.focus_reconcile();
    this.renderObserver?.();
  }

  /**
   * Focus names a pane on stage. A tree that lost the focused pane (a
   * preset applied, a leaf closed from under it) hands focus to its first
   * leaf — the domain's primary — so a spawn from the focused pane always
   * has a host, and the pane that left is the one `;` returns to. Found as
   * #816: after the launcher, `help pane` and `pane split` split from
   * 'launcher', a pane no longer on stage, and opened nothing.
   */
  private focus_reconcile(): void {
    const shown: string[] = this.panes_shown();
    if (this.focusedPane !== null && shown.includes(this.focusedPane)) return;
    const first: string | undefined = shown[0];
    if (first === undefined) return;
    const departed: string | null = this.focusedPane;
    this.focusedPane = null;
    this.focus_set(first);
    if (departed !== null) this.previousFocus = departed;
  }

  /** Builds one node's DOM. `path` names the split for ratio persistence. */
  private node_render(node: LayoutNode, path: string): HTMLElement {
    if ('pane' in node) {
      const leaf: HTMLDivElement = document.createElement('div');
      leaf.className = 'layout-leaf';
      leaf.dataset['leaf'] = node.pane;
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
      this.renderObserver?.();
    });
  }

  /** Marks one pane focused and repaints the rings. */
  public focus_set(pane: string): void {
    if (this.focusedPane === pane) return;
    if (this.focusedPane !== null) this.previousFocus = this.focusedPane;
    this.focusedPane = pane;
    // The focused pane is one declaration on the body as well, so the frame
    // (the gutter stone that opened it) can answer it without being told.
    document.body.dataset['focus'] = pane;
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
