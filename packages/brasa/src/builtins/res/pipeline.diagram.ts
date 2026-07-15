/**
 * @file `pipeline diagram` rendering over the shared feed/pipeline diagram core.
 *
 * Registered pipeline pipings are nested without aggregation: every authored
 * piping remains visible. Shallow output can append stored defaults; SignalFlow
 * output serializes the same node tree as YAML.
 *
 * @module
 */
import chalk from 'chalk';
import { dump as yamlDump } from 'js-yaml';
import {
  pipelineDiagram_get,
  type PipelineDiagram,
  type PipelineDiagramArgument,
  type PipelineDiagramNode,
} from '@fnndsc/salsa';
import {
  errorStack,
  type CommandEnvelope,
  type Result,
  envelope_error,
  envelope_ok,
} from '@fnndsc/cumin';
import {
  diagramTopology_nest,
  diagramTree_walk,
  type DiagramNode,
  type DiagramTreeWalk,
} from './diagram.tree.js';
import { signalflowDoc_build, type SfDoc } from './feed.tree.signalflow.js';

/** Pipeline diagram output mode. */
export type PipelineDiagramMode = 'shallow' | 'shallow-withargs' | 'signalflow';

/** Builds nested shared diagram nodes without collapsing authored pipings. */
function pipelineDiagramNodes_build(graph: PipelineDiagram): DiagramNode[] {
  return diagramTopology_nest<PipelineDiagramNode>(
    graph.nodes,
    graph.rootIDs,
    (node: PipelineDiagramNode, children: DiagramNode[]): DiagramNode => {
      return {
        memberIDs: [node.id],
        pluginName: node.pluginName,
        functionName: node.title,
        signalName: `piping_${node.id}`,
        label: `${chalk.bold(node.title)}  ${chalk.yellow(node.pluginName)}  ${chalk.dim(`[piping ${node.id}]`)}`,
        multiplicity: 1,
        hasJoin: node.joinParentIDs.length > 0,
        joinParentIDs: node.joinParentIDs,
        arguments: node.arguments.map((argument: PipelineDiagramArgument) => ({ ...argument })),
        children,
      };
    },
  );
}

/**
 * Resolves and renders one registered pipeline.
 *
 * @param specifier - Pipeline ID, full name, slug, or unambiguous search.
 * @param mode - Shallow, shallow with arguments, or SignalFlow YAML.
 * @returns A typed pipeline diagram command envelope.
 */
export async function pipelineDiagram_handle(
  specifier: string,
  mode: PipelineDiagramMode,
): Promise<CommandEnvelope> {
  const result: Result<PipelineDiagram> = await pipelineDiagram_get(specifier);
  if (!result.ok) {
    const problem: { message: string } | undefined = errorStack.stack_pop();
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(problem?.message ?? 'Pipeline not found.')}\n`);
  }

  const graph: PipelineDiagram = result.value;
  const roots: DiagramNode[] = pipelineDiagramNodes_build(graph);
  if (mode === 'signalflow') {
    const doc: SfDoc = signalflowDoc_build(roots, {
      subject: 'pipeline',
      subjectID: graph.pipelineID,
      title: graph.name,
    });
    const yaml: string = yamlDump(doc, { lineWidth: -1, noRefs: true });
    return envelope_ok(yaml, {
      kind: 'pipeline.diagram',
      data: { pipelineID: graph.pipelineID, name: graph.name, dialect: 'signalflow', nodes: graph.nodes.length },
    });
  }

  const walk: DiagramTreeWalk = diagramTree_walk(roots, 0, mode === 'shallow-withargs');
  const header: string = `${chalk.bold(`pipeline ${graph.pipelineID}`)} ${chalk.gray(`"${graph.name}"`)} — ${graph.nodes.length} nodes`;
  return envelope_ok(`${header}\n${walk.rendered}\n`, {
    kind: 'pipeline.diagram',
    data: { pipelineID: graph.pipelineID, name: graph.name, dialect: 'shallow', nodes: graph.nodes.length },
  });
}
