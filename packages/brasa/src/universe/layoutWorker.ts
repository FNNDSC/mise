/**
 * @file The session's layout worker: one engine run, off the session's lane.
 *
 * A large space takes the better part of a minute to settle, and the
 * session answers every surface on one thread; the settle runs here, in a
 * worker thread, telling its parent how far it has come and answering the
 * places at the end.
 *
 * @module
 */
import { parentPort } from 'node:worker_threads';
import { layoutEngine_get, type LayoutEngine, type LayoutNode, type PhysicsTerms } from '@fnndsc/orrery/layout';

/** What the session asks: an engine, its nodes, the terms of the settle. */
interface LayoutAsk {
  engine: string;
  nodes: LayoutNode[];
  physics: PhysicsTerms;
}

parentPort?.on('message', (ask: LayoutAsk): void => {
  const engine: LayoutEngine | undefined = layoutEngine_get(ask.engine);
  if (engine === undefined) {
    parentPort?.postMessage({ type: 'failed', reason: `no layout engine named ${ask.engine}` });
    return;
  }
  try {
    let told: number = 0;
    const result = engine.run({ nodes: ask.nodes, physics: ask.physics }, (fraction: number): void => {
      // Told at most a hundred times: the parent redraws a bar, not a film.
      const step: number = Math.floor(fraction * 100);
      if (step <= told) return;
      told = step;
      parentPort?.postMessage({ type: 'progress', fraction });
    });
    parentPort?.postMessage({ type: 'done', positions: result.positions });
  } catch (error: unknown) {
    parentPort?.postMessage({ type: 'failed', reason: error instanceof Error ? error.message : String(error) });
  }
});
