/**
 * @file A pane can be moved: the tree verb (aegis.adoc: a-pane-can-be-moved).
 *
 * Pure over the layout tree: a move detaches the pane and re-splits the
 * nearest block on that side (the former sibling when none), even; the
 * only pane on stage and a pane already at that edge are refused by name.
 */
import { describe, it, expect } from '@jest/globals';
import { tree_moveLeaf, type LayoutNode } from '../../src/app/layout.js';

const leaf = (pane: string): LayoutNode => ({ pane });
const col = (first: LayoutNode, second: LayoutNode, ratio: number = 0.5): LayoutNode => ({ dir: 'col', ratio, first, second });
const row = (first: LayoutNode, second: LayoutNode, ratio: number = 0.5): LayoutNode => ({ dir: 'row', ratio, first, second });

describe('tree_moveLeaf', () => {
  it('refuses the only pane on stage', () => {
    expect(tree_moveLeaf(leaf('a'), 'a', 'right')).toBe('lone');
  });

  it('refuses a pane already at that edge of its axis', () => {
    expect(tree_moveLeaf(col(leaf('a'), leaf('b')), 'b', 'right')).toBe('edge');
    expect(tree_moveLeaf(col(leaf('a'), leaf('b')), 'a', 'left')).toBe('edge');
    expect(tree_moveLeaf(row(leaf('a'), leaf('b')), 'a', 'above')).toBe('edge');
  });

  it('swaps with its sibling along the same axis', () => {
    expect(tree_moveLeaf(col(leaf('a'), leaf('b')), 'a', 'right')).toEqual(col(leaf('b'), leaf('a')));
    expect(tree_moveLeaf(row(leaf('a'), leaf('b')), 'b', 'above')).toEqual(row(leaf('b'), leaf('a')));
  });

  it('turns a left/right pair into an above/below pair', () => {
    expect(tree_moveLeaf(col(leaf('a'), leaf('b')), 'a', 'below')).toEqual(row(leaf('b'), leaf('a')));
    expect(tree_moveLeaf(col(leaf('a'), leaf('b')), 'a', 'above')).toEqual(row(leaf('a'), leaf('b')));
  });

  it('re-splits the whole block beyond the nearest ancestor on that axis', () => {
    // a | (b / c): a moves right of the whole b/c block
    const tree: LayoutNode = col(leaf('a'), row(leaf('b'), leaf('c')));
    expect(tree_moveLeaf(tree, 'a', 'right')).toEqual(col(row(leaf('b'), leaf('c')), leaf('a')));
  });

  it('walks out of a nested split to the neighbour beside it', () => {
    // (a / b) | c: b moves right, beside c, inside c's half
    const tree: LayoutNode = col(row(leaf('a'), leaf('b')), leaf('c'));
    expect(tree_moveLeaf(tree, 'b', 'right')).toEqual(col(leaf('a'), col(leaf('c'), leaf('b'))));
  });

  it('crosses axes onto its former sibling block', () => {
    // (a | b) / c: c moves left of the whole a|b block
    const tree: LayoutNode = row(col(leaf('a'), leaf('b')), leaf('c'));
    expect(tree_moveLeaf(tree, 'c', 'left')).toEqual(col(leaf('c'), col(leaf('a'), leaf('b'))));
  });

  it('opens the new split even and keeps unrelated ratios', () => {
    const tree: LayoutNode = col(row(leaf('a'), leaf('b'), 0.3), leaf('c'), 0.7);
    const moved = tree_moveLeaf(tree, 'c', 'left') as LayoutNode;
    expect(moved).toEqual(col(leaf('c'), row(leaf('a'), leaf('b'), 0.3)));
    expect('ratio' in moved ? moved.ratio : null).toBe(0.5);
  });

  it('leaves the tree it was given untouched', () => {
    const tree: LayoutNode = col(leaf('a'), leaf('b'));
    const before: string = JSON.stringify(tree);
    tree_moveLeaf(tree, 'a', 'right');
    expect(JSON.stringify(tree)).toBe(before);
  });
});
