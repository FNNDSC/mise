/**
 * @file The browser-safe protocol surface of the wire contract.
 *
 * This barrel exports only the protocol subtree: message schemas, envelope
 * schema, boundary validation, and the contract version. Nothing here touches
 * `ws`, Node builtins, or the daemon host, so a browser surface (argus) can
 * import the published contract through the `@fnndsc/calypso/protocol`
 * subpath without dragging server-side dependencies into its bundle. The main
 * package index remains the daemon-side entry point.
 *
 * @module
 */
export { CONTRACT_VERSION, version_isCompatible } from './version.js';
export {
  commandEnvelopeSchema,
  envelopeModelSchema,
  envelopeStatusSchema,
  stackMessageSchema,
  resolutionTraceSchema,
  type WireEnvelope,
} from './envelope.js';
export {
  attachMessageSchema,
  executeMessageSchema,
  completeRequestSchema,
  cancelMessageSchema,
  clientMessageSchema,
  serverMessageSchema,
  attachedMessageSchema,
  resultMessageSchema,
  sessionMessageSchema,
  outputMessageSchema,
  progressMessageSchema,
  type ProgressMessage,
  promptLineMessageSchema,
  promptContextSchema,
  errorMessageSchema,
  type ClientMessage,
  type ServerMessage,
  type PromptContext,
  type ProgressEvent,
} from './messages.js';
export {
  clientMessage_parse,
  serverMessage_parse,
  attach_parse,
  type ParseResult,
} from './validate.js';
