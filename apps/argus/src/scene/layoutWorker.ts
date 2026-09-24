/**
 * @file The universe's settle, off the page.
 *
 * A worker runs whether or not its tab is shown, and never holds the page:
 * a hidden tab used to freeze a settle at whatever it had reached, and a
 * settle on the page's own thread cost every frame it ran in.
 *
 * @module
 */
import { galaxy_layout } from './galaxy.js';
import { hierarchy_layout, type HierarchyArrangement, type HierarchyNode, type HierarchyPhysics } from './hierarchy.js';

/** What the page asks: a generation, the nodes, the physics. */
interface LayoutAsk {
  generation: number;
  nodes: HierarchyNode[];
  physics: HierarchyPhysics;
  arrangement: HierarchyArrangement;
}

self.onmessage = (event: MessageEvent<LayoutAsk>): void => {
  const { generation, nodes, physics, arrangement } = event.data;
  let last: number = -1;
  const progress = (fraction: number): void => {
    const percent: number = Math.floor(fraction * 100);
    if (percent === last) return;
    last = percent;
    self.postMessage({ generation, type: 'progress', fraction });
  };
  // A galaxy lets the whole space find its own rest; the other two place
  // molecules as a hierarchy.
  const positions = arrangement === 'galaxy'
    ? galaxy_layout(nodes, physics, progress)
    : hierarchy_layout(nodes, physics, progress, arrangement);
  self.postMessage({ generation, type: 'done', positions });
};
