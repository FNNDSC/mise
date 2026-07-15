/**
 * @file `feed diagram <id>` — renders a feed's DAG as a SignalFlow diagram to a host file.
 *
 * Builds the feed graph cache-first, collapses it, adapts it to a SignalFlow document, and
 * shells out to the SignalFlow renderer (ASCII by default, SVG with `--svg`). Output is
 * written to a host file the user opens in a wide editor or a scroll-capable pager — the
 * diagram is deliberately width-hungry, so it lives on disk, not squeezed into the terminal.
 *
 * SignalFlow is an optional, replaceable rendering leaf: if it is not found the command
 * degrades gracefully to a pointer at `feed tree`, never a hard error.
 *
 * @module
 */
import chalk from 'chalk';
import { spawnSync } from 'child_process';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { feedGraphData_ensure, feedGraph_build, FeedGraph } from '@fnndsc/salsa';
import { type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { collapse_build } from './feed.tree.collapse.js';
import { signalflowDoc_build } from './feed.tree.signalflow.js';

/** Options for {@link feedDiagram_handle}. */
export interface FeedDiagramOptions {
  /** Output file path; defaults to a temp file. */
  out?: string;
  /** Render SVG instead of ASCII. */
  svg?: boolean;
  /** Emit the ASCII to the envelope instead of writing a file. */
  toStdout?: boolean;
}

/** The SignalFlow executable to invoke (override with `SIGNALFLOW_BIN`). */
function signalflow_bin(): string {
  return process.env.SIGNALFLOW_BIN || 'signalflow';
}

/** Message shown when the SignalFlow renderer is unavailable. */
function degrade_message(feedId: number, bin: string): string {
  return (
    chalk.yellow(`SignalFlow renderer not found (tried "${bin}").\n`) +
    `  The diagram needs SignalFlow on your PATH, or set ${chalk.bold('SIGNALFLOW_BIN')}.\n` +
    `  For a text view now:  ${chalk.bold(`feed tree ${feedId}`)}\n`
  );
}

/**
 * Handles `feed diagram <feedId> [--svg] [--out <path>] [--stdout]`.
 *
 * @param feedId - Feed to render.
 * @param options - Output format and destination.
 * @returns An envelope with the written path (or the ASCII, or a degrade notice).
 */
export async function feedDiagram_handle(feedId: number, options: FeedDiagramOptions): Promise<CommandEnvelope> {
  await feedGraphData_ensure(feedId);
  const graph: FeedGraph | null = feedGraph_build(feedId);
  if (!graph) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`Feed ${feedId} not found.`)}\n`);
  }

  const doc = signalflowDoc_build(collapse_build(graph, graph.rootIDs), { feedID: feedId, title: graph.title });
  const json: string = JSON.stringify(doc, null, 2);

  const bin: string = signalflow_bin();
  const dir: string = mkdtempSync(join(tmpdir(), 'feed-sf-'));
  const inputPath: string = join(dir, `feed-${feedId}.json`);
  writeFileSync(inputPath, json);

  const ext: string = options.svg ? 'svg' : 'txt';
  const outPath: string = options.out ?? join(tmpdir(), `feed-${feedId}-diagram.${ext}`);
  const args: string[] = options.svg ? [inputPath, '-o', outPath] : [inputPath];
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  const model = { kind: 'feed.diagram', data: { feedID: feedId, nodes: graph.total, format: ext, outPath } };

  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      return envelope_ok(degrade_message(feedId, bin), model);
    }
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`SignalFlow failed: ${result.error.message}`)}\n`);
  }
  if (result.status !== 0) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`SignalFlow error: ${(result.stderr || '').trim()}`)}\n`);
  }

  if (options.svg) {
    return envelope_ok(`${chalk.green(`Wrote SVG diagram (${graph.total} nodes) to`)} ${outPath}\n`, model);
  }

  const ascii: string = result.stdout ?? '';
  if (options.toStdout) {
    return envelope_ok(ascii, model);
  }
  writeFileSync(outPath, ascii);
  return envelope_ok(
    `${chalk.green(`Wrote diagram (${graph.total} nodes) to`)} ${outPath}\n` +
    `  ${chalk.dim(`view wide:  less -S ${outPath}`)}\n`,
    model,
  );
}
