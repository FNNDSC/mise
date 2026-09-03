/**
 * @file The DAG model vocabulary: compute graphs as typed envelope payloads.
 *
 * ChRIS is a data-state machine and the execution DAG is its central object:
 * nodes are plugin (instances), edges are data states flowing between their
 * directories. Two commands project that object onto the wire — a registered
 * pipeline's authored template (`pipeline.diagram`) and a feed's live
 * instance graph (`feed.dag`) — and both share one structural core so a
 * renderer owns a single traversal and layout path.
 *
 * Models carry topology, addresses, status, and metrics — never layout.
 * How a graph is drawn (ranked tiers, a force-settled molecule, a header
 * miniature) is a surface concern; the model must serve them all.
 *
 * @module
 */
import { z } from 'zod';

/**
 * The structural core every DAG node shares: identity, a label, and its
 * incoming edges. `parentIds` carries the primary data-flow edges;
 * `joinParentIds` carries additional (topological join) edges, drawn
 * differently but traversed the same.
 */
export const dagNodeCoreSchema = z.object({
  id: z.string(),
  label: z.string(),
  parentIds: z.array(z.string()),
  joinParentIds: z.array(z.string()),
});

/** One stored default argument on an authored pipeline node. */
export const dagArgumentSchema = z.object({
  name: z.string(),
  value: z.unknown(),
});

/** A node in a registered pipeline's authored template. */
export const pipelineDiagramNodeSchema = dagNodeCoreSchema.extend({
  pluginName: z.string(),
  pluginVersion: z.string().optional(),
  arguments: z.array(dagArgumentSchema).optional(),
});

/**
 * The `pipeline.diagram` model: a registered pipeline's authored DAG.
 * Static — it describes what would run, not anything running.
 */
export const pipelineDiagramModelSchema = z.object({
  name: z.string(),
  pipelineId: z.number().optional(),
  nodes: z.array(pipelineDiagramNodeSchema),
});

/**
 * A live node's execution state. Open-world: an unrecognized status from a
 * newer daemon degrades to 'unknown' rather than failing the parse.
 */
export const DAG_NODE_STATUSES = [
  'created',
  'waiting',
  'scheduled',
  'started',
  'registeringFiles',
  'finishedSuccessfully',
  'finishedWithError',
  'cancelled',
  'unknown',
] as const;

export const dagNodeStatusSchema = z.enum(DAG_NODE_STATUSES).catch('unknown');

/**
 * Roll-up of an isomorphic ×N group collapsed behind one rendered node.
 * Present only when `count > 1`; error visibility is not optional — a group
 * carrying failures lists its first anomalous members for jump-to-error.
 */
export const dagNodeTallySchema = z.object({
  count: z.number(),
  done: z.number(),
  error: z.number(),
  running: z.number(),
  other: z.number(),
  anomalies: z.array(z.object({ id: z.string(), status: dagNodeStatusSchema })).optional(),
});

export type DagNodeTally = z.infer<typeof dagNodeTallySchema>;

/** Per-node measurables that scale a molecule rendering. */
export const dagNodeMetricsSchema = z.object({
  computeSeconds: z.number().optional(),
  dataBytes: z.number().optional(),
});

/**
 * A node in a feed's live instance graph. `vfsPath` is the node's data
 * space — the same address the terminal and the files panel navigate, which
 * is what makes "fly into a node" a `cd` rather than a new machine.
 */
export const feedDagNodeSchema = dagNodeCoreSchema.extend({
  instanceId: z.number(),
  pluginName: z.string(),
  pluginVersion: z.string().optional(),
  status: dagNodeStatusSchema,
  vfsPath: z.string(),
  metrics: dagNodeMetricsSchema.optional(),
  tally: dagNodeTallySchema.optional(),
  /** Where the job ran; `mixed` for a group whose members ran on different resources. */
  computeResource: z.string().optional(),
});

/**
 * The `feed.dag` model: one feed's live execution graph. Topology arrives
 * once on the command envelope; status changes ride the typed progress
 * channel rather than re-sending the graph.
 */
export const feedDagModelSchema = z.object({
  feedId: z.number(),
  feedName: z.string(),
  nodes: z.array(feedDagNodeSchema),
});

export type DagNodeCore = z.infer<typeof dagNodeCoreSchema>;
export type PipelineDiagramNode = z.infer<typeof pipelineDiagramNodeSchema>;
export type PipelineDiagramModel = z.infer<typeof pipelineDiagramModelSchema>;
export type DagNodeStatus = z.infer<typeof dagNodeStatusSchema>;
export type DagNodeMetrics = z.infer<typeof dagNodeMetricsSchema>;
export type FeedDagNode = z.infer<typeof feedDagNodeSchema>;
export type FeedDagModel = z.infer<typeof feedDagModelSchema>;

/** The envelope model kinds this vocabulary defines. */
export const DAG_MODEL_KINDS = {
  pipelineDiagram: 'pipeline.diagram',
  feedDag: 'feed.dag',
} as const;

/** One feed in the titled chooser list, from the process cache. */
export const feedListEntrySchema = z.object({
  id: z.number(),
  title: z.string(),
  owner: z.string(),
  status: z.string(),
  createdAt: z.string(),
  /** Total output bytes across the feed's nodes; absent until its topology is resident. */
  sizeBytes: z.number().optional(),
  /** Wall span in seconds, first node start to last node end (or now, while running); absent until resident. */
  wallSeconds: z.number().optional(),
});

/**
 * The `feed.list` model: the cache-resident feed roster — id, title, and
 * derived status, with no CUBE round-trip. The DAG pane's chooser reads it;
 * the terminal reads the same command's rendered lines.
 */
export const feedListModelSchema = z.object({
  feeds: z.array(feedListEntrySchema),
});

export type FeedListEntry = z.infer<typeof feedListEntrySchema>;
export type FeedListModel = z.infer<typeof feedListModelSchema>;

/** The chooser model's envelope kind. */
export const FEED_LIST_MODEL_KIND = 'feed.list' as const;
