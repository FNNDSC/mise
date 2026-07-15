/**
 * @file `feed diagram --signalflow <id>` — emit a feed's DAG as a SignalFlow document.
 *
 * This command does not render or presume anything: it builds the feed graph cache-first,
 * collapses it, adapts it to a SignalFlow document, and writes that document as **YAML to
 * stdout**. Rendering is the user's business and composes with pipes:
 *
 *   feed diagram --signalflow 1669 | signalflow            # ASCII (signalflow reads stdin)
 *   feed diagram --signalflow 1669 | signalflow -o x.svg   # SVG
 *   feed diagram --signalflow 1669 > feed-1669.yaml        # keep it
 *
 * SignalFlow is a replaceable rendering leaf; mise only emits the representation. Additional
 * dialects (`--json`, `--dot`, …) would each be another emitter.
 *
 * @module
 */
import chalk from 'chalk';
import { dump as yamlDump } from 'js-yaml';
import { feedGraphData_ensure, feedGraph_build, FeedGraph } from '@fnndsc/salsa';
import { type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { collapse_build } from './feed.tree.collapse.js';
import { signalflowDoc_build } from './feed.tree.signalflow.js';

/** Supported emit dialects. */
export type DiagramDialect = 'signalflow';

/**
 * Handles `feed diagram --<dialect> <feedId>`. Emits the diagram document to stdout for the
 * user to pipe into a renderer.
 *
 * @param feedId - Feed to emit.
 * @param dialect - Output dialect (currently only `signalflow`).
 * @returns An envelope whose rendered text is the diagram document (YAML).
 */
export async function feedDiagram_handle(feedId: number, dialect: DiagramDialect): Promise<CommandEnvelope> {
  await feedGraphData_ensure(feedId);
  const graph: FeedGraph | null = feedGraph_build(feedId);
  if (!graph) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`Feed ${feedId} not found.`)}\n`);
  }

  const doc = signalflowDoc_build(collapse_build(graph, graph.rootIDs), { feedID: feedId, title: graph.title });
  const yaml: string = yamlDump(doc, { lineWidth: -1, noRefs: true });

  return envelope_ok(yaml, { kind: 'feed.diagram', data: { feedID: feedId, dialect, nodes: graph.total } });
}
