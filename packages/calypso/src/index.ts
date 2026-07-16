/**
 * @file The CALYPSO wire contract: public surface.
 *
 * calypso is the session host that serves a brasa engine to surfaces over a
 * WebSocket. Its public API includes the typed wire contract and boundary
 * validation, the daemon and launch path, structured session messages, and
 * identity-keyed local berth discovery. Natural-language intent assistance is
 * future work built above this deterministic session boundary.
 *
 * @see docs/calypso.adoc for the governing design.
 * @module
 */
export { CONTRACT_VERSION, version_isCompatible } from './protocol/version.js';
export {
  envelopeStatusSchema,
  stackMessageSchema,
  envelopeModelSchema,
  resolutionTraceSchema,
  commandEnvelopeSchema,
  type WireEnvelope,
} from './protocol/envelope.js';
export {
  channelSchema,
  attachMessageSchema,
  executeMessageSchema,
  completeRequestSchema,
  pipeResultMessageSchema,
  pipeErrorMessageSchema,
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
  serverMessageSchema,
  type ClientMessage,
  type ProgressEvent,
  type ServerMessage,
} from './protocol/messages.js';
export {
  clientMessage_parse,
  serverMessage_parse,
  clientMessage_fromJson,
  attach_parse,
  type ParseResult,
} from './protocol/validate.js';
export { type HostedEngine, type CompletionResult } from './daemon/engine.js';
export { token_generate, token_writeFile, token_matches } from './daemon/token.js';
export { CalypsoDaemon, type DaemonOptions, type EditOutcome } from './daemon/server.js';
export { daemon_launch } from './daemon/launch.js';
export { discovery_read, discovery_write, discovery_path, type Discovery } from './daemon/discovery.js';
export {
  identity_normalise,
  identity_forSession,
  DISCONNECTED_IDENTITY,
  berthKey_compute,
  berthDir_path,
  berth_path,
  berth_write,
  berth_read,
  berthAll_read,
  berth_remove,
  berthUrl_isAlive,
  LocalBerthResolver,
  type Berth,
  type BerthResolver,
  type BerthLivenessProbe,
} from './daemon/berth.js';
