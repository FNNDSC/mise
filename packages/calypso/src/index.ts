/**
 * @file CALYPSO: public surface.
 *
 * calypso is the session host that serves a brasa engine to surfaces over a
 * WebSocket: the daemon and its launch path, boundary token handling, and
 * identity-keyed local berth discovery. Natural-language intent assistance is
 * future work built above this deterministic session boundary.
 *
 * The wire contract itself is no longer here. It lives in `@fnndsc/menu`, so
 * that a surface author depends on the contract rather than on the daemon that
 * happens to serve it. The contract's names are re-exported below because most
 * of the stack has always reached them at this address; new code should import
 * `@fnndsc/menu` directly.
 *
 * @see docs/calypso.adoc for the governing design.
 * @see docs/menu.adoc for the contract package.
 * @module
 */
export { CONTRACT_VERSION, version_isCompatible } from '@fnndsc/menu';
export {
  envelopeStatusSchema,
  stackMessageSchema,
  envelopeModelSchema,
  resolutionTraceSchema,
  commandEnvelopeSchema,
  type WireEnvelope,
} from '@fnndsc/menu';
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
} from '@fnndsc/menu';
export {
  clientMessage_parse,
  serverMessage_parse,
  clientMessage_fromJson,
  attach_parse,
  type ParseResult,
} from '@fnndsc/menu';
export { type HostedEngine, type CompletionResult } from './daemon/engine.js';
export { token_generate, token_writeFile, token_matches } from './daemon/token.js';
export { CalypsoDaemon, type DaemonOptions, type EditOutcome } from './daemon/server.js';
export { RequestBroker } from './daemon/broker.js';
export { daemon_launch, daemonSurface_create, DaemonSink, type DaemonLaunchInfo } from './daemon/launch.js';
export {
  face_start,
  face_boot,
  face_ready,
  face_suspend,
  face_resume,
  face_stop,
  face_isActive,
  face_frameCompose,
  uptime_format,
  FaceLogRing,
  type FaceInfo,
  type FaceTelemetry,
  type FaceOptions,
  type FaceFrame,
} from './daemon/face.js';
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
