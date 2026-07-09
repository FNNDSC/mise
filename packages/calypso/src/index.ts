/**
 * @file The CALYPSO wire contract: public surface.
 *
 * calypso is the fifth mise package: the session daemon that hosts a chell
 * engine and serves it to surfaces over a WebSocket. This first slice is the
 * wire contract — the typed protocol schemas and the boundary validation
 * that every message crosses. The daemon, session bus, and remote client
 * build on it.
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
