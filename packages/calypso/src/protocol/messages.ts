/**
 * @file The wire-contract message schemas.
 *
 * Two discriminated unions, one per direction, keyed on a `type` tag:
 * {@link clientMessageSchema} (surface → daemon) and
 * {@link serverMessageSchema} (daemon → surface). Every request carries a
 * correlation `id` so its reply and any streamed output can be matched to
 * it, and output events carry the sink channel they belong to. These schemas
 * are the single source of truth for the protocol; the human-readable
 * description in `docs/calypso.adoc` is checked against them.
 *
 * @module
 */
import { z } from 'zod';
import { commandEnvelopeSchema } from './envelope.js';

/** The sink channel an output event belongs to. */
export const channelSchema = z.enum(['data', 'err', 'status']);

// --- Surface → daemon ------------------------------------------------------

/** Attach to a session: declares the contract version and the attach token. */
export const attachMessageSchema = z.object({
  type: z.literal('attach'),
  protocolVersion: z.number().int(),
  token: z.string(),
  session: z.string().optional(),
});

/** Execute one input line, correlated by `id`. */
export const executeMessageSchema = z.object({
  type: z.literal('execute'),
  id: z.string(),
  line: z.string(),
});

/** Request completion candidates for a partial line, correlated by `id`. */
export const completeRequestSchema = z.object({
  type: z.literal('complete'),
  id: z.string(),
  prefix: z.string(),
});

/** Answers a prompt the daemon requested during a command, correlated by `promptId`. */
export const promptAnswerMessageSchema = z.object({
  type: z.literal('promptAnswer'),
  promptId: z.string(),
  answer: z.string(),
});

/** Returns the output of a pipeline segment the daemon asked the surface to run, correlated by `pipeId`. */
export const pipeResultMessageSchema = z.object({
  type: z.literal('pipeResult'),
  pipeId: z.string(),
  output: z.string(),
});

/** Returns a pipeline-segment failure to the daemon, correlated by `pipeId`. */
export const pipeErrorMessageSchema = z.object({
  type: z.literal('pipeError'),
  pipeId: z.string(),
  reason: z.string(),
});

/** Returns the edited content from a local-edit the daemon requested, correlated by `editId`. */
export const editResultMessageSchema = z.object({
  type: z.literal('editResult'),
  editId: z.string(),
  content: z.string(),
  changed: z.boolean(),
});

/** Any message a surface may send to the daemon. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  attachMessageSchema,
  executeMessageSchema,
  completeRequestSchema,
  promptAnswerMessageSchema,
  pipeResultMessageSchema,
  pipeErrorMessageSchema,
  editResultMessageSchema,
]);

/** A message a surface sends to the daemon. */
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// --- Daemon → surface ------------------------------------------------------

/** Acknowledges a successful attach. */
export const attachedMessageSchema = z.object({
  type: z.literal('attached'),
  session: z.string(),
  protocolVersion: z.number().int(),
});

/** The final result of one executed line: one envelope per command. */
export const resultMessageSchema = z.object({
  type: z.literal('result'),
  id: z.string(),
  envelopes: z.array(commandEnvelopeSchema),
});

/** The reply to a completion request. */
export const completeReplySchema = z.object({
  type: z.literal('complete'),
  id: z.string(),
  prefix: z.string(),
  candidates: z.array(z.string()),
});

/** A streamed output event on one channel, correlated to its command. */
export const outputMessageSchema = z.object({
  type: z.literal('output'),
  id: z.string(),
  channel: channelSchema,
  chunk: z.string(),
});

/** The operation producing structured progress. */
export const progressOperationSchema = z.enum(['upload', 'download', 'pull', 'workflow']);

/** Broad class of progress producer. */
export const progressKindSchema = z.enum(['transfer', 'retrieve', 'workflow']);

/** Lifecycle phase of a progress operation. */
export const progressPhaseSchema = z.enum(['scanning', 'transferring', 'watching', 'retrying', 'complete', 'failed']);

/** Unit used by the primary progress counter. */
export const progressUnitSchema = z.enum(['files', 'bytes', 'series', 'jobs', 'nodes']);

/** State of the operation or item being reported. */
export const progressStatusSchema = z.enum(['running', 'done', 'unconfirmed', 'stalled', 'timeout', 'error', 'unknown']);

/** A structured progress event correlated to a command. */
export const progressMessageSchema = z.object({
  type: z.literal('progress'),
  id: z.string(),
  operation: progressOperationSchema,
  kind: progressKindSchema.optional(),
  phase: progressPhaseSchema,
  label: z.string().optional(),
  itemId: z.string().optional(),
  current: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional(),
  percent: z.number().min(0).max(100).optional(),
  unit: progressUnitSchema.optional(),
  status: progressStatusSchema.optional(),
});

/** The progress payload before command correlation is added by the daemon. */
export type ProgressEvent = Omit<z.infer<typeof progressMessageSchema>, 'type' | 'id'>;

/** A session-bus broadcast: an envelope tagged with its originating surface. */
export const sessionMessageSchema = z.object({
  type: z.literal('session'),
  surface: z.string(),
  envelope: commandEnvelopeSchema,
});

/** A boundary error: a refused attach, a malformed message, correlated when possible. */
export const errorMessageSchema = z.object({
  type: z.literal('error'),
  id: z.string().optional(),
  reason: z.string(),
});

/**
 * A prompt request the daemon raises during a command: the surface that
 * submitted the command must answer it (with `promptAnswer`) before the
 * command can proceed. `hidden` requests no-echo entry (password).
 */
export const promptMessageSchema = z.object({
  type: z.literal('prompt'),
  promptId: z.string(),
  message: z.string(),
  hidden: z.boolean(),
});

/**
 * The engine-known facts a prompt reflects, independent of any theme.
 *
 * The daemon knows the session context but not how a given surface renders it,
 * so it ships these facts and each surface themes them with its own settings.
 * Rendering inputs a surface owns (theme, segments, terminal width) are not
 * carried here.
 */
export const promptContextSchema = z.object({
  user: z.string(),
  uri: z.string(),
  cwd: z.string(),
  pacsserver: z.string().nullable(),
  physicalMode: z.boolean(),
  lastExitCode: z.number(),
  lastCommandDurationMs: z.number(),
  procWarmup: z.object({ loaded: z.number() }).optional(),
});

export type PromptContext = z.infer<typeof promptContextSchema>;

/**
 * The prompt context, pushed by the daemon with each result and on any context
 * change. The daemon knows the session context; each surface renders it with
 * its own theme, so prompt themes are a per-surface choice rather than the
 * daemon's.
 */
export const promptLineMessageSchema = z.object({
  type: z.literal('promptline'),
  context: promptContextSchema,
});

/**
 * Asks the surface to run a pipeline segment on its own machine (never on the
 * daemon host) and return the output. `input` and the reply's `output` are
 * base64, since segment data is arbitrary bytes.
 */
export const pipeMessageSchema = z.object({
  type: z.literal('pipe'),
  pipeId: z.string(),
  command: z.string(),
  input: z.string(),
});

/**
 * Asks the surface to open content in its local editor (never on the daemon
 * host) and return the edited result.
 */
export const editMessageSchema = z.object({
  type: z.literal('edit'),
  editId: z.string(),
  content: z.string(),
  extension: z.string().optional(),
});

/** Any message the daemon may send to a surface. */
export const serverMessageSchema = z.discriminatedUnion('type', [
  attachedMessageSchema,
  resultMessageSchema,
  completeReplySchema,
  outputMessageSchema,
  progressMessageSchema,
  sessionMessageSchema,
  errorMessageSchema,
  promptMessageSchema,
  promptLineMessageSchema,
  pipeMessageSchema,
  editMessageSchema,
]);

/** A message the daemon sends to a surface. */
export type ServerMessage = z.infer<typeof serverMessageSchema>;
