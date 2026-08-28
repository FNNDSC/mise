/**
 * @file The mise wire contract.
 *
 * What a command returns, what a session exchanges, and the vocabularies both
 * narrow to. Nothing here touches `ws`, Node builtins, or a daemon host, so a
 * browser surface loads it as readily as the engine does — which is the point:
 * a surface author depends on the contract, not on the daemon that happens to
 * serve it.
 *
 * @module
 */
export {
  PROC_PROMPT_STATES,
  procPromptState_get,
  type ProcPromptState,
  type ProcPromptProgress,
} from './proc.js';
export {
  PROGRESS_OPERATIONS,
  PROGRESS_KINDS,
  PROGRESS_PHASES,
  PROGRESS_UNITS,
  PROGRESS_STATUSES,
  type ProgressOperation,
  type ProgressKind,
  type ProgressPhase,
  type ProgressUnit,
  type ProgressStatus,
} from './progress.js';
export { CONTRACT_VERSION, version_isCompatible } from './version.js';
export {
  commandEnvelopeSchema,
  envelopeModelSchema,
  envelopeStatusSchema,
  stackMessageSchema,
  resolutionTraceSchema,
  type WireEnvelope,
  type CommandEnvelope,
  type EnvelopeStatus,
  type EnvelopeModel,
  type StackMessage,
  type ResolutionTrace,
} from './envelope.js';
export {
  channelSchema,
  surfaceCapabilitiesMessageSchema,
  attachMessageSchema,
  executeMessageSchema,
  cancelMessageSchema,
  completeRequestSchema,
  promptAnswerMessageSchema,
  promptErrorMessageSchema,
  pipeResultMessageSchema,
  pipeErrorMessageSchema,
  shellResultMessageSchema,
  shellErrorMessageSchema,
  editResultMessageSchema,
  editErrorMessageSchema,
  deliverResultMessageSchema,
  deliverErrorMessageSchema,
  clientMessageSchema,
  attachedMessageSchema,
  resultMessageSchema,
  completeReplySchema,
  outputMessageSchema,
  progressOperationSchema,
  progressKindSchema,
  progressPhaseSchema,
  progressUnitSchema,
  progressStatusSchema,
  progressMessageSchema,
  sessionMessageSchema,
  errorMessageSchema,
  promptMessageSchema,
  promptContextSchema,
  promptLineMessageSchema,
  pipeMessageSchema,
  shellMessageSchema,
  editMessageSchema,
  deliverMessageSchema,
  serverMessageSchema,
  telemetryMessageSchema,
  SERVER_MESSAGE_TYPES,
  type ClientMessage,
  type ServerMessage,
  type ProgressMessage,
  type ProgressEvent,
  type PromptContext,
  type FileDeliverRequest,
  type FileDeliverResult,
} from './messages.js';
export {
  clientMessage_parse,
  serverMessage_parse,
  clientMessage_fromJson,
  attach_parse,
  type ParseResult,
} from './validate.js';
export {
  dagNodeCoreSchema,
  dagArgumentSchema,
  pipelineDiagramNodeSchema,
  pipelineDiagramModelSchema,
  DAG_NODE_STATUSES,
  dagNodeStatusSchema,
  dagNodeMetricsSchema,
  feedDagNodeSchema,
  feedDagModelSchema,
  DAG_MODEL_KINDS,
  type DagNodeCore,
  type PipelineDiagramNode,
  type PipelineDiagramModel,
  type DagNodeStatus,
  type DagNodeMetrics,
  type FeedDagNode,
  type FeedDagModel,
} from './dag.js';
